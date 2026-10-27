# T9 dd5fe7a Native 재개 실패 — 별도 수정 후보

**동결 후보 dd5fe7a의 FAIL은 보존한다.** 이 문서는 `workspace/t9-dd5-mac-recovery-fix`의 검토용 변경이며 원본 최종 후보에 병합하지 않았다. 제품 수정 커밋은 **`f31dbc050109831c3286d17fdfab9608b5d3c728`**이다. **Workspace Release: NOT READY.**

## 문제와 변경

실제 Native Worker SIGKILL 후 Codex 재개가 `Custom tool call output is missing` 및 `macOS descendant cleanup could not be verified`로 실패했다. 합성 시험 기록에서 해당 tool-call의 output 부재를 확인했다. 원본 checkpoint catch가 예외를 버려 추적 실패의 구체 원인은 미확정이다. 대화 오류와 추적 실패 사이의 인과를 단정하지 않는다.

1. `src/server.mjs`: 기존 worktree·부분 diff 검토 gate 뒤, **STALE Codex의 명시적 resume에만** `session_id=null`을 저장한다. 새 provider 대화는 현재 task 목표와 보존한 파일로 작업한다. 로그인 쿠키나 인증 체계를 바꾸는 변경이 아니다. PAUSED Codex·STALE Claude의 대화 연속성은 유지한다.
2. `src/provider.mjs`: process-helper의 종료/signal/error와 checkpoint 예외를 bounded·redacted 오류로 보존한다. 프로세스 추적 실패는 계속 자식을 죽이고 성공/승인을 거부한다. timer·kill·PID identity·정리 검사는 유지한다.
3. 신규 회귀와 `OPERATIONS.md`: 동작 범위·부분 파일/시작 baseline 보존·잘못된 검토 없는 resume 거부 및 EIO 주입 시 fail closed를 검증한다.

제품 diff는 server/provider 두 파일이다. 신뢰 의존성·Gradle·프로필·마운트·브라우저 인증·백업·FE/BE를 바꾸지 않는다. 새 AI 엔진이나 Workspace는 만들지 않았다. 기존 실패 task는 검증 원본으로 보존하며 이 변경으로 자동 재실행하지 않았다.

## 검증

| 검사 | 결과 | 증거 |
|---|---|---|
| thread reset 회귀 수정 전 | 예상 FAIL 1개 | [before.txt](evidence/t9-dd5-recovery-fix/before.txt): 검토된 STALE Codex가 이전 thread를 유지함. |
| 추가 집중 회귀 | PASS 4개 | [focused-final.txt](evidence/t9-dd5-recovery-fix/focused-final.txt): STALE Codex reset, PAUSED Codex/STALE Claude 유지, Mac checkpoint EIO 주입 시 SIGKILL·실패·원인 보존. EIO는 시험 주입이며 원래 실패 원인이라는 뜻이 아니다. |
| 실제 Native SIGKILL·검토 후 재개 | PASS | [native-kill.txt](evidence/t9-dd5-recovery-fix/native-kill.txt), [native-resume.txt](evidence/t9-dd5-recovery-fix/native-resume.txt): 동일 worktree·부분 파일·attempt 2·Node 검사 통과. |
| 실제 fresh thread 확인 | PASS | [thread-reset-observation.json](evidence/t9-dd5-recovery-fix/thread-reset-observation.json): 중단 thread에 output 없는 call 1개, 재개 thread ID 변경, AWAITING_APPROVAL. |
| `f31dbc0` 전체 opt-in | **56 PASS / 0 FAIL / 1 NOT_RUN**, 총 57개 | [full-automated.txt](evidence/t9-dd5-recovery-fix/full-automated.txt), [HEAD·명령·시각](evidence/t9-dd5-recovery-fix/full-automated-result.json). 네 Mac 실제 실행 플래그 모두 활성화. |
| `f31dbc0` 실제 Gradle Worker crash/review/resume | PASS | [gradle-kill.txt](evidence/t9-dd5-recovery-fix/gradle-kill.txt), [gradle-resume.txt](evidence/t9-dd5-recovery-fix/gradle-resume.txt): guest namespace 정리, 같은 worktree attempt 2·Gradle 검사. |
| 수정 후보 Windows | **NOT_RUN** | 새 후보를 기존 동결 후보의 Windows 수치로 대체하지 않는다. |

1 NOT_RUN은 Mac에서 제외되는 `macOS dependency commands refuse to run on other platforms` 분기다. 전체 실행은 commit `f31dbc0`에서 했다. 실제 Native 두 실행은 commit 전 같은 수정 작업트리에서 수행해 metadata의 당시 base HEAD는 dd5로 남겼다. [실행 context와 소스 해시](evidence/t9-dd5-recovery-fix/execution-context.json)에 이를 명시하며 동결 후보 PASS로 계산하지 않는다.

재검증은 새 worktree와 별도 프로필/키/DB/fixture에서 다음 기존 명령을 사용한다. 실제 실행 argv와 DB 경로는 개별 result JSON에 있다.

```sh
node --test tests/stale-codex-session.test.mjs tests/mac-checkpoint-diagnostic.test.mjs
node tests/worker-kill.integration.mjs
node tests/resume-killed.integration.mjs <printed-native-database>
node --test tests/*.test.mjs
node tests/worker-kill.integration.mjs
node tests/resume-killed.integration.mjs <printed-gradle-database>
```

전체 opt-in에는 `RUN_PROVIDER_INTEGRATION`, `RUN_MAC_DEPENDENCY_INTEGRATION`, `RUN_MAC_MOUNT_INTEGRATION`, `RUN_MAC_GRADLE_INTEGRATION`을 1로 설정했다. Gradle Worker에는 기존 controlled fixture 전용 `WORKSPACE_TEST_GRADLE_CRASH=1` 환경을 사용한다. 신규 의존성을 승인하지 않는다.

## 한계와 다음 판단

원래 Mac checkpoint 예외의 상세 원인은 여전히 미확정이다. 새 진단은 같은 조건이 다시 생겼을 때 원인을 보존하며, 이 변경이 모든 추적 실패를 해결했다는 근거는 아니다. Windows 교차 검증·변경 검토 및 기존 BE 승인/정식 검사 등 출시 조건이 남는다. 정책을 완화하거나 원래 실패를 숨기지 않았고 운영 배포·자동 병합을 하지 않았다. 이 후보는 검토 자료이며 최종 승인이나 출시 READY 판정이 아니다.

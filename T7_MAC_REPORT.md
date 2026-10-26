# T7-Mac 실제 macOS 검증 — 2026-10-26 KST

후속 실행과 최신 FE main 기준 판정은 [T7_MAC_FOLLOWUP_REPORT.md](T7_MAC_FOLLOWUP_REPORT.md)에 있다. 아래는 `2eeff69` 시점의 증거다.

**T7-Mac: PARTIAL. Workspace Release: NOT READY.**

기존 T7 `10d835a`에서 `workspace/t7-macos-validation` 브랜치와 별도 worktree를 만들어 검증했다. 원본 Workspace `/Users/kjh/Momentory/momentory-ai-workspace`는 깨끗한 `main`, HEAD `10d835a` 그대로다. `dev` 기준 `fd9cdcc`와 후보 원격 브랜치가 로컬에 존재해 가져오기나 전송이 필요하지 않았다. FE 및 BE 소스에는 쓰지 않았다. 실제 제품의 구조 디자인 승인, main/dev 병합, push, 배포는 하지 않았다. 테스트의 승인 처리는 합성 sample 데이터베이스와 worktree에 한정된다.

## 환경과 신뢰 기준

| 항목 | 실제 확인 |
| --- | --- |
| OS | macOS 26.6.2 / build 25G83 / arm64 |
| 최초 셸 Node/npm | 24.19.0 / 11.17.0; T7의 Mac Node 22.x 요구와 불일치 |
| 검증 런타임 | 기존 설치 Node 22.23.2 / npm 10.9.8 |
| 실제 CLI | Codex 0.163.0 / Claude Code 2.1.296; 기존 로그인 사용 |
| 격리 | 기존 Codex POSIX 프로필과 macOS sandbox; root deny 유지 |
| 프로필 위치 | 검증 전용 `/Users/kjh/.local/share/momentory-t7-mac-validation/codex`; 사용자 Codex config는 수정하지 않음 |
| 브라우저 | 기존 Playwright 1.63.0 / 설치된 Chromium 재사용; 390px 에뮬레이션 |
| Java | 설치된 JDK 없음; `java_home -V` 실패 |

실행 파일은 canonical 절대 경로, task/Workspace 외부 위치, root/현재 사용자 소유, 부모 경로까지 group/other 쓰기 금지, 파일 SHA-256으로 확인했다. Codex는 npm JS launcher 대신 실제 native binary를 pin했다. Node/Codex/Claude의 `codesign --verify --strict`도 성공했다. 이는 로컬 설치와 지정된 서명 요구 확인이며, 별도의 배포본 재설치나 공급망 전체에 대한 검증을 뜻하지 않는다.

4개 경로와 SHA-256, 버전 명령은 [environment.json](evidence/t7-mac/environment.json), [환경 로그](evidence/t7-mac/environment-check.txt)에 있다. 로그인 파일 내용은 출력하거나 저장소로 복사하지 않았다. 검증용 CODEX_HOME은 저장소 밖의 기존 로그인 파일 참조를 사용했다.

검토된 npm fixture는 추적된 `tests/mac-dependency.test.mjs`의 고정 manifest/lockfile을 합성 Git 저장소에 커밋한 것이다. `is-number@7.0.0`의 공식 registry metadata와 실제 tarball SHA-512를 독립 대조했다. fixture Git HEAD, lockfile SHA-256, 승인 digest와 실행 명령은 [설치 로그](evidence/t7-mac/mac-dependency.txt), 출처·tarball 해시는 [lock-provenance.json](evidence/t7-mac/lock-provenance.json)에 있다. 기존 FE lockfile을 검토했다거나 FE 전체 설치를 검증했다고 주장하지 않는다.

## 실제 결과

전체 기존 `node --test tests/*.test.mjs`를 Mac에서 실행한 최종 결과는 **34 PASS / 0 FAIL / 1 SKIP (35 tests)**다. `RUN_PROVIDER_INTEGRATION=1`, `RUN_MAC_DEPENDENCY_INTEGRATION=1`로 실제 CLI와 설치 케이스도 포함했다. SKIP 1개는 다른 OS에서 Mac 전용 함수를 거부하는 테스트로, Mac에서 실행할 대상이 아니다. Windows의 29 PASS를 이 수치에 합산하지 않았다.

마지막 process-table 형식 검사 guard를 추가한 뒤 관련 `core.test.mjs`를 다시 실행해 **19 PASS / 0 FAIL**을 확인했다. 이는 전체 suite 수치에 더하지 않는 표적 재검증이다. [core-final.txt](evidence/t7-mac/core-final.txt).

| 검사 / 기존 진입점 | 결과 | 실제 증거 |
| --- | --- | --- |
| 전체 unit/HTTP/security/backup/storage/browser/provider tests | PASS: 34; SKIP: 1 | [unit-final.txt](evidence/t7-mac/unit-final.txt) |
| `verifyMacSetupBoundary` | PASS: 허용 읽기·쓰기, Workspace 데이터와 symlink 탈출 거부 | [setup-boundary-initial.txt](evidence/t7-mac/setup-boundary-initial.txt) |
| `mac-dependency.test.mjs` opt-in 설치 | PASS: 실제 `npm ci --ignore-scripts`, lifecycle 미실행, 설치 index/마커 검사·재사용, 변조·탈출 거부 | [mac-dependency.txt](evidence/t7-mac/mac-dependency.txt) |
| 실행 파일/PATH/Git 환경 조작 | PASS: 누락 pin, 파일 교체, writable 파일/부모, 링크, task shim, Git shim/`GIT_DIR` 거부 | [unit-final.txt](evidence/t7-mac/unit-final.txt) |
| 프로필 변조 | PASS: 변경된 프로필은 실행 전 거부; 전용 원본 복구 | [profile-integrity.txt](evidence/t7-mac/profile-integrity.txt) |
| Codex 프로젝트 접근과 격리 | PASS: 실제 AI의 허용 읽기·쓰기; 동일 프로필의 직접 sandbox 검사에서 다른 합성 Git 프로젝트/Workspace 데이터 read/write 및 dependency/Gradle cache write 거부 | [codex-boundary-final.txt](evidence/t7-mac/codex-boundary-final.txt) |
| Claude 프로젝트 접근과 도구 제한 | PASS: 실제 Read/Edit, 다른 프로젝트와 바깥 파일 Read/Edit 거부, Bash 미제공 | [claude-boundary-final.txt](evidence/t7-mac/claude-boundary-final.txt) |
| 허용되지 않은 commit / 외부 연결 | PASS: `.git/index.lock` 생성 실패, DNS를 우회한 직접 HTTPS 연결도 실패; 합성 repo HEAD 유지 | [command-boundary.txt](evidence/t7-mac/command-boundary.txt) |
| Codex 실제 취소 / 30초 timeout | PASS: 두 실행 모두 제어된 셸·sleep 자식 종료 | [codex-cancel.txt](evidence/t7-mac/codex-cancel.txt) |
| SIGTERM 무시 / 분리된 프로세스 그룹 | PASS: timeout 후 detached Node 자식 강제 종료 | [unit-final.txt](evidence/t7-mac/unit-final.txt) |
| Claude 실제 취소 / 1ms startup timeout / 새 세션 | PASS; startup timeout은 모델 작업 중 timeout의 증거가 아님 | [claude-lifecycle.txt](evidence/t7-mac/claude-lifecycle.txt) |
| 두 CLI의 잘못된 resume / 새 세션 복구 | PASS: 존재하지 않는 세션은 exit 1, 이후 새 인증 세션 응답 성공 | [invalid-session-recovery.txt](evidence/t7-mac/invalid-session-recovery.txt) |
| 실제 sample 작업과 승인 대기 | PASS: Codex 수정·격리 checks·AWAITING_APPROVAL; 검증 후 변조 승인 거부, check의 소스 변경은 UNVERIFIED | [local-integration-final.txt](evidence/t7-mac/local-integration-final.txt) |
| 두 CLI 작업 / 사람 작업 / 후속 작업 | PASS: 두 실제 CLI 실행 중 사람 작업 생성, 합성 결과 승인 후 후속 작업과 검증된 파일 상속 | [collaboration.txt](evidence/t7-mac/collaboration.txt) |
| 실제 Codex pause/resume | PASS: 같은 worktree를 보존해 attempt 2에서 AWAITING_APPROVAL | [pause.txt](evidence/t7-mac/pause.txt) |
| 상속·diff·lease/server 재시작·격리 checks | PASS: 기존 integration 4개, 각 exit 0 | [regression-integration.txt](evidence/t7-mac/regression-integration.txt) |
| 로그 마스킹 / 암호화 백업·복원 | PASS: fixture credential 이벤트·diff 마스킹, 암호화/변조 거부/원자적 복원/실패 롤백 | [unit-final.txt](evidence/t7-mac/unit-final.txt) |
| macOS Gradle 기능 | **BLOCKED / NOT_IMPLEMENTED**; 거부 guard 테스트 성공은 기능 PASS가 아님 | [gradle-blocked.txt](evidence/t7-mac/gradle-blocked.txt) |

Codex 모델의 “8개 명령을 실행했다”는 텍스트는 실행 증거로 사용하지 않았다. 실제 기록에는 AI command execution이 2개만 있으므로, 나머지 거부는 같은 audited profile을 사용하는 **직접 sandbox 검사** 결과로 분리했다. Claude 경계는 restricted CLI의 도구 정책 검증이며 모든 임의 코드에 대한 OS 격리 증명으로 확대하지 않는다.

## 수정한 차단 원인

1. npm user/global config를 모두 `/dev/null`로 지정하면 npm 10이 double-loading 오류로 종료했다. 매 실행 private cache 안에 빈 user config를 따로 만들고 정리한다. [최초 오류](evidence/t7-mac/npm-install-initial.txt).
2. 격리 안에서 Node가 기본 `/System/Library/OpenSSL/openssl.cnf` 읽기에 실패했다. host OpenSSL 설정·engine/CA 주입 변수를 제거하고 `OPENSSL_CONF=/dev/null`을 사용한다. TLS 인증서 검증을 끄거나 시스템 디렉터리 접근을 확대하지 않았다. 이 최초 오류는 대화의 첫 opt-in 설치 출력에 남아 있으며 이후 동일 경로의 재실행이 성공했다.
3. POSIX AI 프로필이 `.gradle` 캐시 쓰기를 허용했다. `.gradle`, `build`, `out`을 읽기 전용으로 제한하고 정확한 이전 프로필에서의 갱신만 허용한다. [수정 전 재현](evidence/t7-mac/gradle-cache-boundary-initial.txt), 수정 후는 boundary 로그 참조.
4. 실제 Codex 취소 후 별도 그룹의 셸과 sleep이 남았다. 종료 전 하위 PID·시작시각·실행 경로·그룹을 기록하고 동일 identity에만 signal을 보낸다. 종료 callback에서도 강제 정리하며 watchdog은 SIGKILL로 승격한다. [최초 실패](evidence/t7-mac/codex-cancel-initial.txt), 수정 후 실제 취소·timeout과 SIGTERM 저항 테스트가 통과했다. 최초 실패의 제어된 자식도 테스트가 정리했다.
5. npm 사전 검토의 Git을 Mac에서는 `/usr/bin/git`로 고정하고 Git 환경 주입, fsmonitor/hook, 외부 diff/textconv를 제한했다. 설치 index의 version/resolved/integrity/link가 검토된 lockfile과 일치해야 승인 마커를 재사용한다. dependency tree의 다른 device도 거부한다.
6. 기존 테스트의 `/var`→`/private/var` canonical 경로 가정, Mac의 pin 기반 Claude 해석, 고정 sample 경로를 수정했다. Playwright는 기존 설치를 지정할 수 있게 해 FE 파일 변경·새 설치 없이 브라우저 테스트를 실행했다. 긴 이벤트 JSON의 잘린 summary 대신 크기 제한·마스킹된 command/exit/output 증거를 별도로 제공한다.

초기 전체 실행은 **25 PASS / 4 FAIL / 1 SKIP**였다. 실패는 Mac pin을 고려하지 않은 Claude 테스트, canonical 임시 경로, 실제 FE 경로 미설정에 따른 HTTP fixture 실패, Playwright 해석 실패였다. [baseline-unit.txt](evidence/t7-mac/baseline-unit.txt)에 보존했다. Codex boundary의 초기 실패에는 허용 쓰기의 newline 가정과 관측되지 않은 AI 밖 경계 명령을 요구한 assertion도 있었다. 보안을 완화하지 않고 입력/관측 방식을 수정하고 직접 거부 증거를 추가했다. 일시적 네트워크 오류로 분류할 근거는 없었다.

## Gradle 판단과 남은 범위

`projects.json`의 Momentory BE는 `executeTask → setup → prepareMacDependency`에서 `./gradlew dependencies --configuration testRuntimeClasspath --no-daemon` 준비가 필요하고, 이후 `./gradlew test`를 수행한다. 따라서 Gradle은 실제 BE 작업의 필수 경로다. FE/sample 작업에는 필요하지 않다.

이 Mac에는 JDK가 없다. 실제 BE Wrapper는 Gradle 9.1.0 공식 services URL을 사용하지만 `distributionSha256Sum`이 없고 `gradle/verification-metadata.xml`도 없다. 빌드 configuration/plugin 자체가 코드를 실행하므로, Windows의 Java 경로·systemd·network namespace 전제를 Mac에 그대로 복사할 수 없다. 현재 조건에서 검증된 JDK/Wrapper/배포본, 플러그인·의존성 출처 고정, 설치·빌드 스크립트 위험 평가, Mac 네트워크·파일 경계와 offline cache 정책을 안전하게 구현·검증하지 못했다. 기능은 **NOT_IMPLEMENTED**, BE Mac 흐름은 **BLOCKED**로 유지했다.

다음은 PASS로 처리하지 않았다:

- 실제 마운트/volume 교체 공격: **SKIP**, 장치 마운트 실험은 하지 않음. device 거부 코드는 있으나 실제 mount 시나리오는 미검증.
- Worker 자체를 SIGKILL한 뒤 Mac orphan을 재시작에서 자동 수거하는 경로: **SKIP / 미검증**. 기존 worker-kill/orphan integration은 Windows 전용이며, 이번 process identity map은 메모리에만 존재한다. provider 취소·timeout과 lease 복구 성공이 이를 대신하지 않는다.
- 전체 Momentory FE / Design Lab 의존성 설치·렌더·typecheck/lint/Jest: **SKIP**. 고정 npm fixture와 sample 프로젝트까지 검증했다.
- 실제 iOS/Android 기기, Tailscale 별도 네트워크·화면 잠금, 24시간 백업 주기: **SKIP**, 이번 Mac 실행 범위에서 검증하지 않음.
- 변경된 코드에 대한 Windows 재실행: **SKIP**. 기존 Windows 결과는 역사적 증거다.

## 변경 및 재현

변경은 `src/macDependency.mjs`, `src/provider.mjs`, `src/engine.mjs`, `src/wslChecks.mjs`, `src/codexProfile.mjs`, POSIX 프로필 2개, 기존 테스트 6개와 연결 문서·증거다. `src/macTrust.mjs`의 pin/권한 기준은 완화하지 않았다. `git diff --check`는 통과했다.

실행 명령과 환경 로딩은 [COMMANDS.md](evidence/t7-mac/COMMANDS.md), 각 결과/로그는 [results.json](evidence/t7-mac/results.json)에 있다. 원본 실행 로그는 이 worktree의 ignored `data/t7-mac-evidence/`에 있고, 비밀 패턴을 검사하고 줄 끝 공백만 정규화한 사본을 `evidence/t7-mac/`에 커밋한다. [SHA256SUMS.txt](evidence/t7-mac/SHA256SUMS.txt)는 보존한 로그의 무결성 목록이다. 생성된 합성 DB·백업·작업 worktree는 ignored 상태로 보존한다.

Gradle과 나머지 미검증 출시 조건이 남으므로 전체 출시 상태는 **NOT READY**다.

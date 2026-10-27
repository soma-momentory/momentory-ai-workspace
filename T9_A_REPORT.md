# T9-A 통합 후보 검증 보고서

**판정: PARTIAL. Workspace Release: NOT READY.** Windows T8 `a8664a3`와 Mac T7-H `aefb7b4`를 별도 `workspace/t9-integration` worktree에 병합했다. 이 보고서는 병합 후보의 Windows 검증과 T7-H 원본 브랜치에 남은 Mac 증거를 구분한다.

## 기준선과 통합

| 대상 | 확인한 상태 |
| --- | --- |
| 원본 Workspace | `C:\SWM\ai-dev-workspace`, `dev@fd9cdcc`, 깨끗함. 4195 서버 PID 53164 유지. |
| Windows T8 | `C:\SWM\awt8`, `workspace/t8-mobile-e2e@a8664a3`, 깨끗함. 4178 서버 PID 70384 유지. |
| Mac T7-H | `origin/workspace/t7-h-be-dependency-trust-review@aefb7b4`. 공통 조상은 `fd9cdcc`. |
| 통합 후보 | `C:\SWM\awt9`, `workspace/t9-integration`. T7 기본선 병합 `ee96964`, T7-H 병합 `3ea7fef`. 원본 브랜치 병합·push·배포 없음. |

처음에는 원격에 T7-H가 없어 T7 기본선 `10d835a`만 통합했으나, 재확인 후 `aefb7b4`를 fetch하여 같은 후보에 추가 병합했다. T7-H 병합에서 내용 충돌은 `src/engine.mjs`의 import 한 곳이었다. T8의 `sealTaskBaseline`과 작업별 승인 기준을 유지하고 T7-H의 `trackMacProcess`, `verifyMacProcessSupport`를 함께 가져왔다. `src/git.mjs`, `tests/core.test.mjs`, `tests/mobile.test.mjs`는 Git 자동 병합 후 테스트했다. 보안 검사나 승인 검사를 제거하지 않았다.

T8의 작업별 diff 및 승인 hash, 로그아웃·세션 무효화, Windows WSL Git 복제, 모바일 검토 UI, Windows 실행기를 보존했다. T7-H의 신뢰된 macOS 실행 파일·의존성 검증, sandbox 프로필, Gradle 컨테이너 격리, 프로세스 추적·고아 프로세스 정리, BE 의존성 검토 자료를 가져왔다. 플랫폼별 실행 경로는 기존 운영체제 조건을 유지한다. **BE 승인 대기 제안과 FE 디자인 변경은 제품 저장소에 적용하지 않았다.**

T7-H에는 `evidence/` 아래 927개 파일이 포함되며 로그 15개, 스크린샷, 공개 서명키와 검토 자료가 있다. 추적된 `.env`, DB, 백업 파일은 발견되지 않았고 일반적인 토큰·Bearer·개인키 패턴의 파일명 검색에서도 탐지되지 않았다. 이는 모든 비밀정보 부재를 보증하는 검사가 아니다. T9 실행 로그는 무시된 `C:\SWM\awt9\data`에 저장했다.

## 통합 후보에서 직접 실행한 검사

| 검사 | 판정 | 증거와 범위 |
| --- | --- | --- |
| 병합 충돌, 문법, 변경 공백 | PASS | 미해결 충돌 0개, `node --check src/engine.mjs`, 소스·테스트 `git diff --check`. |
| Windows 전체 자동 테스트 | PASS | 43개 중 35 통과, 0 실패, 8 건너뜀. [로그](data/t9-full-source-npm-test.log). Mac 전용 실행 및 실제 provider 통합 테스트는 건너뜀. |
| 작업 lease·재개·중복 후속 작업 | PASS | [복구 통합 로그](data/t9-recovery-integration.log). 별도 fixture에서 낡은 nonce와 검토 불가능한 diff를 거부. |
| 승인된 부모 변경 상속·변조 방지 | PASS | [상속 통합 로그](data/t9-approved-inheritance.log). 승인 후 변조와 연결된 목적지 거부. |
| 승인 diff 검토 가능성 | PASS | [diff 통합 로그](data/t9-diff-reviewability.log). 잘림·대용량·마스킹·무시된 경로·연결된 mount 거부. |
| FE 구조적 디자인 계약 | PASS | 깨끗한 구조 디자인 worktree를 읽기 전용으로 참조한 11개 schema parity 사례. [로그](data/t9-design-schema-parity-after-t7h.log). 실제 FE 빌드나 렌더링의 통과를 뜻하지 않는다. |
| 실제 Claude CLI | PASS | 병합 후보에서 읽기 전용 `probeProvider` 성공, 세션 ID 및 응답 marker 확인. [로그](data/t9-claude-probe.log). 실제 작업 생성·수정·승인 검사는 아니다. |
| 실제 Codex CLI | NOT_RUN | T9 전용 WSL 격리 프로필 검증이 `missing or changed`를 반환했다. 공유 프로필을 재설정하면 실행 중인 T8의 격리 설정을 바꿀 수 있어 실행하지 않았다. |
| 통합 후보의 실제 작업 생성·취소·승인 E2E와 Worker 강제 종료 | NOT_RUN | 전용 T9 실행기·Codex 프로필·fixture가 준비되지 않았다. 기존 T8 실기동 증거를 T9 통과로 대체하지 않았다. |
| 실제 macOS sandbox·Gradle·전체 테스트 | NOT_RUN | 현재 호스트는 Windows이며 병합 후보를 Mac에서 실행하지 않았다. |
| FE 전체 타입 검사·린트·Jest·Design Lab 렌더링 | NOT_RUN | T9에서 schema parity만 실행했다. 원본 FE main의 기존 미커밋 변경은 건드리지 않았다. |
| 기존 DB를 사용한 병합 후보 백업·복원, 장시간 운영 | NOT_RUN | 자동 테스트의 fixture 백업·복원은 통과했지만 기존 데이터의 주기·재시작·복원 검증으로 확장하지 않았다. |

T7-H **원본 Mac 브랜치**의 `evidence/t7-h/automated-tests.log`에는 39개 중 38 통과, 0 실패, 1 건너뜀이 기록되어 있다. `evidence/t7-h/automated-tests-result.json`은 Mac 전용 플래그와 실제 provider 검사를 켠 명령의 종료 코드 0을 기록한다. 이 기록은 T7-H 소스의 검증 근거이며 `3ea7fef` 병합 후보의 Mac 통과 근거는 아니다. `evidence/t7-h/formal-be-gate.json`에는 BE 준비와 검사가 승인되지 않아 BLOCKED로 기록되어 있다. `be-test-summary.UNAPPROVED.json`의 503개 중 266개 실행, 237개 건너뜀, 실패 0개는 승인 전 격리 검토 결과다.

## 보호 상태 및 T9-B 잔여 조건

4195와 4178은 조사 후에도 각각 기존 PID에서 수신 중이다. 원본 `dev`와 T8 worktree는 깨끗하다. 4195 DB를 읽기 전용으로 비교한 결과 작업 7건의 ID·상태와 승인 대기 1건의 ID·상태가 `C:\SWM\awt8\data\t8c-original-before.json` 기준 스냅샷과 같다. 서버 종료, 승인·의존성 승인, FE/BE 쓰기, 원본 DB 변경, push, 배포를 하지 않았다.

T9-B 전에는 병합 후보를 **실제 Mac**에서 sandbox·Gradle·실제 Claude/Codex·취소·복구·자동 테스트로 다시 검증하고, Windows에는 T9 전용 격리 프로필과 데이터 경로를 준비하여 실제 Codex 작업·승인·Worker 복구를 실행해야 한다. FE 전체 검사 및 디자인 승인, BE 의존성 626개 검토와 건너뛴 검사 237개, Windows `fetch failed`의 미확정 원인, 신규 stale-state 복구, WSL Git worktree 경로, 장시간 운영과 백업 주기 증거도 남아 있다. T8에서 확인된 개별 통과를 T9 통과로 표시하지 않는다.

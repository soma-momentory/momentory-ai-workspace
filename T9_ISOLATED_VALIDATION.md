# T9 Windows 독립 실행·복구 검증

**Windows 독립 실행 검증: PASS. Workspace Release: NOT READY.** 기준선은 `workspace/t9-integration@ea1dfd9`이며, 이 검증에서 발견한 Windows checkout 문제와 Worker 경합을 T9 후보에서만 수정했다. Mac에서 병합 후보를 실행한 결과는 없다.

## 독립 환경

| 경계 | T9 검증 환경 |
| --- | --- |
| 서버 | `127.0.0.1:4279`. Tailscale Serve와 연결하지 않음. |
| 데이터·백업·스크린샷 | `C:\SWM\awt9\data\t9-isolated-20261027` 아래의 별도 SQLite, `.awbackup`, screenshots. |
| 프로젝트 | 위 디렉터리의 `projects.json`에 안전한 `sample/app` 한 개만 등록. 저장소는 `sample-app`; Momentory FE/BE 미등록. |
| Workspace 인증 | 전용 `instance.env`의 무작위 사용자·Worker 토큰과 백업 키. 값은 보고서와 Git에 포함하지 않음. |
| Codex 인증·프로필 | `C:\Users\kjhkm\.codex-t9-integration`의 독립 `CODEX_HOME`. 소유 사용자·SYSTEM·Administrators만 허용. T9용 인증 복사본은 이 경로에만 유지. |
| Worker 파일 | `C:\SWM\awt9\data\worker-*.lock`, 작업 worktree는 `C:\SWM\awt9\worktrees\sample`. T8/원본의 파일과 별개. |

재실행할 때에는 4279가 비어 있는지 확인한 뒤 아래 명령을 **T9 worktree**에서 실행한다. `instance.env`를 출력하거나 Git에 추가하지 않는다.

```powershell
$envFile = 'C:\SWM\awt9\data\t9-isolated-20261027\instance.env'
foreach ($line in [System.IO.File]::ReadAllLines($envFile)) {
  if ($line -match '^([A-Z_][A-Z_0-9]*)=(.*)$') {
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
  }
}
Set-Location C:\SWM\awt9
node src/local.mjs
```

종료는 이 명령을 실행한 콘솔에서 `Ctrl+C`를 사용한다. T9를 검증 후 정상 종료했으며 4178과 4195는 계속 유지했다.

## 실제 검증

| 항목 | 결과 | 증거 |
| --- | --- | --- |
| 격리 경계 | PASS | T9 전용 프로필 설치·WSL 경로 변환·작업 공간 읽기/쓰기·외부 쓰기 거부 preflight. 첫 배치에서 `CODEX_HOME`을 T9 `data` 아래에 둔 경우 외부 쓰기 검사가 실패하여 실행이 차단됐다. 인증 복사본을 별도 개인 경로로 옮긴 뒤 통과했고, 이전 복사본은 제거했다. |
| 실제 Codex 구현·승인 | PASS | 작업 `f9405805…`가 `index.mjs` 한 파일의 `Hi → Hello` 변경, `node --check`와 `node --test` 성공, 64자 변경 hash 및 작업 연결 승인 요청을 생성했다. 승인 후 `APPROVED`, 중복 승인은 HTTP 409. [E2E 결과](data/t9-isolated-20261027/e2e-result.json). |
| 실제 Codex 구현·거절 | PASS | 독립 작업 `488a256c…`의 `index.mjs`와 `review-probe.txt` diff 및 검사 통과를 확인한 뒤 `REJECTED`. 두 작업 모두 샘플 원본 저장소를 바꾸지 않았다. [E2E 결과](data/t9-isolated-20261027/e2e-result.json). |
| 인증·Origin·로그아웃 | PASS | 미인증 작업 조회 401, 다른 Origin의 작성 403, 로그아웃 뒤 세션·작업 조회·작성·승인 401. [E2E 결과](data/t9-isolated-20261027/e2e-result.json). |
| Worker 강제 종료·고아 Codex 복구 | PASS | 별도 fixture의 실행 중 Worker를 종료해 작업 `a055497a…`가 `STALE`로 남았고, 재시작 Worker가 고아 scope를 정리했다. 부분 파일과 시도 횟수 보존. [로그](data/t9-isolated-20261027/logs/worker-kill.log). |
| 실행기 자동 복구 | PASS | 활성 작업 0건을 확인한 뒤 T9 Codex Worker PID `72464 → 43968`, T9 서버 PID `61248 → 67352`로 각각 복구. [실행기 이벤트](data/desktop-control-events.jsonl). |
| 정상 종료·재시작·이력 | PASS | 4279의 서버와 Worker 2개가 정상 종료하고 잠금 파일이 사라졌다. 재시작 뒤 API에서 첫 작업 `APPROVED`, 둘째 `REJECTED`, Worker 2개를 확인했다. 전용 백업 3개 생성. |
| 실제 Claude·Codex CLI 인증·스트리밍 | PASS | 전용 `CODEX_HOME`에서 opt-in provider 통합 테스트 1/1 통과. [로그](data/t9-isolated-20261027/logs/providers.log). |
| 전체 자동 테스트 | PASS | 기본 프로젝트 설정과 전용 `CODEX_HOME`, `RUN_PROVIDER_INTEGRATION=1`로 **43개 중 36 통과, 0 실패, 7 SKIP**. [로그](data/t9-isolated-20261027/logs/npm-test-default-projects.log). Core 파일은 3회 반복해 매회 18 통과·1 Mac SKIP. |

첫 실제 Codex 시도는 Windows checkout의 `scripts/wsl-codex.sh`가 CRLF라 WSL Bash에서 중단됐다. `.gitattributes`에 `*.sh text eol=lf`를 추가한 `0544c9c` 이후 재검증했다. 이후 T9 `data` 내부의 `CODEX_HOME`이 외부 쓰기 경계 검사를 통과하지 못했으며, 이 실패도 안전하게 `UNVERIFIED`로 기록됐다. 개인 경로로 분리한 뒤 preflight와 실제 작업이 통과했다. 이 실패 과정에서 늦게 돌아온 heartbeat가 이미 해제된 전역 controller를 참조해 Worker가 한 차례 종료됐다. 작업별 controller를 캡처하도록 `src/worker.mjs`를 수정했고, 이후 실제 작업 두 건·복구·전체 테스트를 통과했다.

샘플 프로젝트 **한 개만** 등록한 실행 환경 변수를 전체 자동 테스트에 그대로 전달한 첫 시도는 43개 중 4개가 실패했다. 세 건은 테스트가 요구하는 `momentory` 프로젝트가 없어 발생했다. 나머지 한 건은 Windows 임시 SQLite 파일 삭제의 `EBUSY`였다. 기본 프로젝트 설정으로 재실행한 전체 테스트는 실패 0건이고 Core 테스트 3회 반복에서도 `EBUSY`가 재현되지 않았다. 이 일시 오류의 원인은 **UNKNOWN_CAUSE**로 남긴다. [첫 시도 로그](data/t9-isolated-20261027/logs/npm-test-provider-enabled.log).

## 기존 SKIP 8건 분류

기준 `ea1dfd9`의 Windows 기본 테스트는 43개 중 35 통과·8 SKIP이었다. 이번에 실제 provider opt-in 한 건을 실행하여 36 통과·7 SKIP으로 바뀌었다.

| 기존 SKIP | 이유와 현재 상태 |
| --- | --- |
| macOS timeout detached child 정리 | `process.platform !== 'darwin'` 조건. Windows에서 실행하지 않음. |
| macOS 신뢰 실행 파일 교체·PATH·링크 거부 | macOS 전용 조건. Windows에서 실행하지 않음. |
| macOS Gradle 정책 부재 시 차단 | macOS 전용 조건. Windows에서 실행하지 않음. |
| 실제 macOS 잠금 npm 준비·marker 검증 | macOS 및 `RUN_MAC_DEPENDENCY_INTEGRATION=1` 필요. Windows에서 실행하지 않음. |
| 실제 macOS mount·symbolic link 차단 | macOS 및 `RUN_MAC_MOUNT_INTEGRATION=1` 필요. Windows에서 실행하지 않음. |
| 미승인 Gradle 제안의 실행 차단 | macOS 전용 조건. Windows에서 실행하지 않음. |
| 실제 macOS 격리 Gradle Worker·악성 입력 | macOS 및 `RUN_MAC_GRADLE_INTEGRATION=1` 필요. Windows에서 실행하지 않음. |
| 실제 Claude·Codex CLI 인증·스트리밍 | 기본값은 `RUN_PROVIDER_INTEGRATION` 미설정으로 SKIP. 이번 T9 전용 환경에서 `=1`로 실행하여 PASS. |

## 보호 상태와 남은 조건

검증 전후 4178은 PID 70384, 원본 4195는 PID 53164로 유지됐다. 원본 DB의 작업 7건과 승인 대기 1건의 ID·상태가 T8-C 기준 스냅샷과 동일하다. 원본 `dev`와 T8 작업 트리는 깨끗하며 FE/BE, 승인 대기 건, main/dev, 운영 환경을 변경하지 않았다. T9 검증용 DB와 백업은 원본과 별개다.

병합 후보를 실제 Mac에서 재검증하는 일, FE/BE 출시 차단 조건, 장시간 운영·백업 주기, Windows의 별도 `fetch failed` 원인과 이번 `EBUSY`의 원인 확인은 남아 있다. 이 Windows 결과를 Workspace 정식 출시 판정으로 사용하지 않는다.

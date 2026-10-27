# T9 Security Fix — 복원 후 세션 재인증 방지

2026-10-28 KST. **수정 후보의 macOS 검사 PASS / Windows 검증 NOT_RUN.** 기존 **T9-B-Mac FAIL / Workspace Release NOT READY**는 유지한다. 이번 작업은 백업 복원 후 브라우저 세션 재활성화 결함만 수정했다.

## 기준과 재현

- 작업 시작과 종료에 `git ls-remote origin refs/heads/workspace/t9-integration`로 원격 HEAD **`ee1d498beb65cf71a0a3d2c6246e49fb69dea571`**을 확인했다.
- 독립 worktree: `/Users/kjh/Momentory/momentory-ai-workspace-t9-session-fix`, 브랜치 **`workspace/t9-session-restore-fix`**.
- 제품 수정 커밋: **`30f8c5044df1bd76e6a4ac0571bfec1e94cb566b`**.
- CLI·다른 DB 동시 사용 검사를 포함한 **Mac 재검증 대상 커밋: `d0c9b00d2068b6435352362a0376ffa372a12a91`**.
- 실제 환경: macOS 26.6.2 (25G83) arm64, Node 22.23.2. Windows 실행 환경은 제공되지 않았다. Mac 결과를 Windows PASS로 처리하지 않았다.

제품 코드를 고치기 전에 독립 합성 DB·무작위 로그인/Worker/백업 키·동적 loopback 포트를 사용하는 `tests/session-restore.test.mjs`를 작성했다. 최신 통합 제품 코드에서 첫 회귀 사례를 실행해 **1 FAIL**을 확인했다. [수정 전 로그](evidence/t9-session-fix/before-reproduction.txt): 로그아웃/재시작 후 401이던 쿠키와 다른 활성 쿠키가 복원 후 각각 **200 / 200**이었다.

## 근본 원인과 수정

기존 HMAC·세션 ID·DB 세션 행 확인 방식은 정상 동작했으나 전체 DB 백업이 `browser_sessions` 행도 저장했다. 로그아웃으로 행을 삭제한 뒤 과거 DB를 복원하면 그 행이 되살아났다. 현재 로그인 키는 기본 정책에 따라 보존되어 과거 쿠키의 서명도 유효했으므로 서버가 다시 인증했다.

수정은 기존 세션·백업 기능을 사용한다.

1. **공개 전 무효화:** 복호화·무결성 검사를 통과한 임시 복원 DB에서 모든 `browser_sessions` 행을 삭제하고 transaction을 commit한다. 이 DB만 실제 경로로 설치한다. 임시 연결은 DELETE journal을 사용해 삭제 결과가 임시 main DB 파일에 반영된 후 닫히도록 한다. 과거 세션 테이블이 없는 백업도 허용한다.
2. **서버/복원 동시 사용 차단:** 서버 수명과 복원 전체에 같은 DB별 SQLite sidecar의 `BEGIN EXCLUSIVE` 잠금을 유지한다. 임시 파일이 생기기 전부터 잠금을 잡으므로 시작 전 파일 검사·포트 검사 사이의 경쟁 상태도 막는다. 복원은 설치·rollback·cleanup이 끝나야 잠금을 해제한다. 다른 DB의 서버는 계속 사용 가능하다.
3. **실패 안전성:** 세션 삭제 실패는 설치 전에 중단한다. 설치 도중 예외는 기존 rollback 경로로 원래 DB와 현재 인증 상태를 돌린다. 복원 프로세스가 강제 종료되면 SQLite의 OS 잠금은 해제되지만 기존 `.restore-`/`.rollback-` 검사 때문에 부분 상태의 서버 시작은 거부된다.

잠금 파일 `<database>.lifecycle-lock.sqlite`는 실제 DB 교체와 별개로 유지하며 삭제하거나 복원하지 않는다. 로그인·Worker 토큰이나 백업 키를 담지 않는다. SQLite의 EXCLUSIVE/rollback journal 및 OS 잠금 동작을 사용했다. [SQLite transaction 설명](https://www.sqlite.org/lang_transaction.html), [파일 잠금 설명](https://www.sqlite.org/lockingv3.html). Windows에서 같은 코드가 실제 동작하는지는 별도 실행 검증이 필요하다.

`src/store.mjs`와 세션 쿠키 형식·라우트·HMAC 구현은 변경하지 않았다. 세션 저장소의 기존 조회·삭제 방식이 복원 후 빈 테이블을 정상 처리한다. FE·BE·격리 정책·승인 상태를 변경하지 않았다.

## 호환성과 인증 자격 영향

- 백업 format/schema는 **1** 그대로다. 현재 gzip/envelopeVersion 2와 과거 비압축 envelope를 기존 복호화 경로로 읽는다.
- 세션 테이블과 `approval_base_head`가 없는 구형 DB를 복원하고 기존 Store migration을 통해 새 로그인에 성공하는 시험을 통과했다.
- 기본값은 현재 `.env` 자격 보존이다. 명시적 `--restore-credentials` 및 파일 부재 시 기존 자격 복원 정책도 유지한다. **두 정책 모두 기존 브라우저 세션은 무효화**한다.
- 기본 복원 전후 로그인/Worker/백업 자격 파일 SHA-256이 같다. Worker 인증은 복원 후에도 성공한다. 명시적 자격 복원에서도 과거 쿠키는 401, 새 로그인은 200이다.
- 작업·승인·거부·변경 이벤트·Worker·후속 작업 등 업무 테이블은 복원 대상 snapshot과 일치한다. 기존 백업 파일 자체는 변경하지 않는다.
- 업그레이드 전에 이전 버전의 서버와 Worker를 모두 정지해야 한다. 이전 바이너리는 새 DB 수명 잠금에 참여하지 않는다. 기존 복원 CLI의 포트 검사도 유지했다.

## 실제 검증 결과

| 항목 | macOS 결과 | 증거 |
|---|---|---|
| 최신 통합 코드 수정 전 재현 | FAIL 확인 | [before-reproduction.txt](evidence/t9-session-fix/before-reproduction.txt), 복원 후 200/200 |
| 커밋된 수정 후보의 실제 서버·복원 E2E | PASS: 8개 | [committed-session-e2e.txt](evidence/t9-session-fix/committed-session-e2e.txt), [커밋·명령·시간](evidence/t9-session-fix/committed-session-e2e-result.json) |
| 전체 자동 테스트 최종 실행 | PASS: **46 PASS / 0 FAIL / 5 NOT_RUN**, 총 51개 | [full-automated-cli-final.txt](evidence/t9-session-fix/full-automated-cli-final.txt), [실행 명세](evidence/t9-session-fix/full-automated-cli-final-result.json) |
| 승인·거부·로그아웃·중복 승인 거부 | PASS | 전체 suite의 실제 HTTP/Git 시험, synthetic Worker 결과 사용 |
| 390px 기존 UI 회귀 | PASS | 전체 suite의 실제 Chromium, 독립 인증/DB·합성 작업 사용 |
| Windows 전체 자동·실제 서버 E2E | **NOT_RUN** | 현재 Mac 호스트에서 실행 불가 |
| Windows 원본 4178·4195 보호 상태 실측 | **NOT_RUN** | Windows 호스트에 접근하지 않음. Mac 보호 포트는 전후 listener 없음 |
| 실제 Codex를 사용하는 `test:windows-release` | **NOT_RUN** | 이번 작업에서 실제 사용자 계정 사용 금지. 복원 후 재로그인 기대값과 시험용 confirm 처리만 수정, 구문 검사 통과 |

추가 8개 사례는 다음을 검증한다.

1. 로그인 두 개 → 백업 → 한 세션 로그아웃 → 정상/SIGKILL 재시작 후 401 유지 → 복원 후 **과거 두 세션 모두 401** → 새 로그인 **200**. 같은 백업 두 번 복원해 새로 만들었던 세션도 다시 무효화한다. 올바른 서명이어도 만료되거나 DB 행과 불일치한 쿠키는 401이다.
2. 실제 DB 설치 직전 임시 DB에 세션이 **0개**이고 업무 이력이 보존된 것을 확인한다.
3. 손상 ciphertext, staging 실패, 세션 삭제 실패, DB 설치 후 replacement 실패를 각각 주입한다. 현재 업무 이력·자격 파일·로그아웃 상태를 보존하며, 실패 전 활성 세션은 계속 유효하다. 이후 정상 복원은 해당 활성 세션도 무효화한다.
4. 명시적인 자격 파일 복원도 과거 쿠키를 무효화한다.
5. 실제 서버가 실행 중일 때 복원 함수와 CLI 모두 거부한다. **CLI에 틀린 빈 포트를 설정해도** DB 소유 잠금을 우회하지 못한다. 병행 요청 12개는 현재 상태로 정상 처리된다. 정지 후 실제 CLI 복원·재시작·새 로그인을 확인한다.
6. 첫 임시 파일 작성 **이전**에 복원을 멈춘 상태에서 서버 시작과 두 번째 복원이 거부되는 것을 확인한다. 다른 DB의 활성 세션과 이력은 유지된다.
7. 구형 비압축 백업·세션 테이블 부재·이전 DB migration을 검증한다.
8. 정리 전 부분 복원에서 restorer를 SIGKILL한다. 잠금이 풀려도 부분 복원 marker 때문에 복원 재시도와 서버 시작이 거부된다.

전체 suite의 5 NOT_RUN은 실제 AI 계정 probe, 이번 수정 범위 밖의 npm 설치·마운트·Gradle 실제 통합 시험, 다른 OS에서 macOS 명령 거부를 확인하는 분기다. Windows 전용 WSL 내부 조건부 실행도 Mac PASS로 간주하지 않는다. 기존 격리 코드·프로필은 기준 커밋과 동일하며 이번 결과를 T9 전체 재검증 완료로 확대하지 않는다.

최초 전체 실행은 독립 sample 경로가 없어 HTTP claim과 모바일 sample 작업에서 **44 PASS / 2 FAIL / 5 NOT_RUN**이었다. 기존 `examples/sample-template`을 ignored test 경로에 복사해 별도 Git fixture를 만들고 `WORKSPACE_REPO_SAMPLE_APP`을 지정했다. 제품 코드를 바꾸거나 assertion을 삭제하지 않고 최종 46/0/5를 확인했다. 최초 로그도 보존했다.

## 정확한 재현·재검증 명령

기준 `ee1d498`이 존재하는 저장소에 후보 commit/branch를 전달한 뒤 기존 dev/main과 다른 새 worktree를 사용한다.

Windows 전달용 incremental Git bundle도 별도로 생성한다. bundle은 `ee1d498`을 prerequisite으로 사용하고 추적된 후보 커밋만 포함하며 DB·env·cache·사용자 계정 파일은 포함하지 않는다. 전달받은 bundle의 digest를 확인한 뒤 다음과 같이 별도 ref로 가져올 수 있다.

```sh
git bundle verify <bundle-path>
git fetch <bundle-path> refs/heads/workspace/t9-session-restore-fix:refs/remotes/t9-fix/workspace/t9-session-restore-fix
```

```sh
git worktree add -b workspace/t9-session-restore-verify <new-checkout-path> d0c9b00d2068b6435352362a0376ffa372a12a91
cd <new-checkout-path>
node --version
node --test tests/session-restore.test.mjs
```

Node 22.13 이상이 필요하다. 추가 npm 의존성·실제 계정·FE/BE·고정 포트 없이 8개 사례를 실행한다. 시험이 임시 디렉터리에 새 DB·키·백업·프로젝트 설정을 만들고 정리한다. 포트는 OS가 정하며 4178/4195를 사용하지 않도록 assert한다. 기대 출력은 **8 PASS / 0 FAIL**, 복원 후 `revoked:401, active:401`, 새 로그인 200이다.

수정 전 실패를 다시 보려면 별도 baseline worktree를 `ee1d498`에서 만들고 후보의 `tests/session-restore.test.mjs` **한 파일만** 복사한다. 제품 파일은 복사하지 않는다.

```sh
node --test --test-name-pattern="restored backups never" tests/session-restore.test.mjs
```

기대 출력은 `Revoked cookie was reactivated ...`, 실제값 200, **1 FAIL**이다. baseline 시험도 실제 사용자 DB를 사용하지 않는다.

전체 suite는 검토된 기존 Playwright package/browser와 별도 sample fixture 경로를 필요로 한다. Mac에서 사용한 공개 설정은 [검증 명세](evidence/t9-session-fix/validation.json)에 있다. Windows에서는 같은 세 환경변수를 그 호스트의 **별도 검증 사본** 경로로 지정한다. 새 package 버전 설치나 FE/BE 변경은 필요하지 않다.

```powershell
$env:WORKSPACE_TEST_PLAYWRIGHT_PACKAGE_JSON = '<reviewed-playwright-package>\package.json'
$env:WORKSPACE_REPO_MOMENTORY_FE = '<read-only-fe-validation-copy>'
$env:WORKSPACE_REPO_SAMPLE_APP = '<independent-sample-fixture>'
node --test tests/session-restore.test.mjs
npm test
```

이번 작업에서 실제 AI probe를 실행하지 않도록 `RUN_PROVIDER_INTEGRATION`을 설정하지 않는다. sample fixture는 기존 `examples/sample-template`의 두 파일을 별도 경로에 복사하고 Git init/commit한 것이다. 운영 환경 `.env`, DB, 쿠키를 복사하지 않는다.

## 변경 파일과 남은 차단

제품 수정은 `src/backup.mjs`, `src/server.mjs`, `src/databaseLock.mjs` 세 파일이다. 회귀 시험은 `tests/session-restore.test.mjs`, 기존 브라우저 시험의 복원 후 인증 기대값은 `tests/windows-release.integration.mjs`, 운영 설명은 `OPERATIONS.md`에 있다. 이 보고서와 `evidence/t9-session-fix/`에는 수정 전후 로그·명령·해시를 보존했다. [파일·SHA 목록](evidence/t9-session-fix/changes.json), [증거 digest](evidence/t9-session-fix/SHA256SUMS.txt).

원본 Workspace main은 `10d835a`·clean을 유지한다. 이전 T9 Mac 검증 `74a6b91`, T7 후보, 원본 FE/BE 및 새 BE 후보를 변경하지 않았다. FE의 기존 미커밋 작업도 건드리지 않았다. 보호 포트에 서버를 띄우거나 종료하지 않았으며 기존 운영 DB를 열어 migration하거나 복원하지 않았다. [보존·포트·승인 inventory 기록](evidence/t9-session-fix/preservation.json). 실제 사용자 계정·쿠키를 쓰지 않았고 암호화 키·인증 파일·DB는 증거에 포함하지 않았다.

**남은 사항:** Windows 실제 전체 자동·세션/복원 E2E 및 보호 인스턴스 확인, 이 후보의 독립 T9 Mac 교차 판정, 기존 BE 의존성 승인·정식 BE 검사·237개 미실행 검사 등 이전 출시 조건. 이번 수정은 그 승인이나 결과를 바꾸지 않는다. **T9-B-Mac FAIL / Workspace Release NOT READY 유지.**

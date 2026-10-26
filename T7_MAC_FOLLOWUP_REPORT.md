# T7-Mac 후속 검증 — 2026-10-26 KST

**T7-Mac: PARTIAL. 정식 Workspace Release: NOT READY.**

Workspace `2eeff69`의 기존 엔진·테스트를 재사용했다. 구현 브랜치는 `workspace/t7-macos-release-blockers`, worktree는 `/Users/kjh/Momentory/momentory-ai-workspace-t7-followup`이다. 원본 Workspace `main=10d835a`와 이전 검증 브랜치 `2eeff69`는 깨끗한 상태로 보존했다. main/dev 병합, push, 운영 배포, 제품 구조 디자인 승인은 하지 않았다.

## 최신 FE 기준

사용자 요청에 따라 **`git fetch origin main`을 실제 실행**했다. 오래된 remote tracking ref `f783378`이 `e6f88ce528a0bdb270aee9b152bb47090f226ca5`로 갱신됐다. 최신 main에는 기존 Workspace가 요구하는 `src/design/studioApproved.json`과 Studio 화면이 있었다. 따라서 초기의 파일 부재 판정은 최종 차단 항목에서 제외했다.

최종 FE 검증 경로는 `/Users/kjh/Momentory/momentory-fe-t7-mac-main`, 브랜치는 `workspace/t7-mac-latest-main`, HEAD는 **`711f4e31f023320b469cffc7513b13e0aaa6badc`**다. 최신 main 위의 후보 변경은 Design Lab 설정 5개 파일뿐이다. 후보 커밋은 `a9307fb`, `00fcc41`, `9649028`, `711f4e3`이며 병합하지 않았다.

원본 `/Users/kjh/Momentory/momentory-fe`는 `feat/p4-weather-sticker-assets`, HEAD `4c80a94`와 기존 미커밋 작업을 보존했다. 중간에 검증한 원본 작업 사본도 별도 worktree에 남겼고 최신 main에 섞지 않았다. [스냅샷 해시](evidence/t7-mac-followup/fe-current-snapshot.json)와 최종 환경 기록으로 추적할 수 있다. **초기 `f783378`/미커밋 사본 결과는 최신 main의 PASS로 합산하지 않았다.**

처음에는 FE 경로 override를 테스트 프로세스에만 적용해 일반 실행 설정에는 최신 main 경로가 남지 않았다. 후속 확인 후 현재 Workspace와 T7 후속 worktree의 Git ignored `.env`에 `WORKSPACE_REPO_MOMENTORY_FE=/Users/kjh/Momentory/momentory-fe-t7-mac-main`을 저장했다. 기존 setup 스크립트로 서로 다른 로컬 인증 값을 만들고 파일 권한은 0600으로 유지했다. 두 checkout 모두 환경 override 없이 기존 `settings()` → `repository()` → `repoStatus()`로 FE `711f4e3`을 읽는 것을 확인했다. `app/`, `src/`, `expo-lab/` 및 승인 JSON이 원격 main과 동일하다는 [연결 증거](evidence/t7-mac-followup/frontend-main-binding.json)를 남겼다. 원본 Workspace의 추적 파일은 변경하지 않았다.

## 실제 macOS 결과

호스트는 macOS 26.6.2 / build 25G83 / arm64다. Node 22.23.2, npm 10.9.8, Codex 0.163.0, Claude Code 2.1.296을 유지했다. 프로세스 식별에는 설치된 Apple Python 3.9.6과 Darwin libproc을 사용했다. 사용자 Codex 설정 대신 별도 CODEX_HOME을 사용했고 로그인 파일 내용은 출력하거나 저장소에 복사하지 않았다.

| 항목 | 최종 판정 | 명령·증거 |
| --- | --- | --- |
| Workspace 자동 테스트 | **PASS 36 / FAIL 0 / NOT_RUN 1** | [final-unit.txt](evidence/t7-mac-followup/final-unit.txt). 실제 provider·npm·mount opt-in 포함. Node의 SKIP 1개는 다른 OS에서 Mac 함수를 거부하는 케이스다. |
| 기존 보안·복구 integration 9개 | **PASS**, 전부 exit 0 | [integration-summary.txt](evidence/t7-mac-followup/integration-summary.txt). Codex/Claude 경계, 취소·timeout, 실제 sample 작업, lease 복구, diff·상속, 격리 checks, pause/resume. |
| 실제 마운트 및 링크 | **PASS** | [final-mount-regression.txt](evidence/t7-mac-followup/final-mount-regression.txt). 실제 HFS+ 이미지 attach 후 device 차이를 확인하고 실행 전 거부, 링크만 있는 다른 project에서도 mounted alias 거부, detach 확인. |
| 실행 중 mount broker 공격 | **PASS** | [runtime-mount-attack.txt](evidence/t7-mac-followup/runtime-mount-attack.txt). 실제 잠긴 Codex sandbox에서 외부 합성 이미지 읽기와 project 내부로의 `hdiutil attach` 모두 실패. canary 노출·마운트 없음. |
| 승인된 npm workspace 링크 | **PASS** | 같은 로그. Git 추적 workspace manifest와 lockfile의 정확한 링크만 허용. manifest 변경·외부 링크 대체·설치 index 불일치는 거부. |
| Worker SIGKILL / orphan / 복구 | **PASS** | [worker-crash-and-resume.txt](evidence/t7-mac-followup/worker-crash-and-resume.txt). 종료 전 checkpoint, 종료 직후 살아 있는 shell/sleep, 재시작 후 제거, `STALE`·부분 파일·attempt 1 유지, 검토 없는 resume 409, 검토 hash로 같은 worktree 복구 후 attempt 2에서 `AWAITING_APPROVAL`. |
| PID 재사용·exec·손상된 checkpoint | **PASS** | [orphan-security.txt](evidence/t7-mac-followup/orphan-security.txt). exec 후 identity 유지, 살아 있는 owner 보존, 다른 시작 identity의 PID는 신호를 보내지 않음, 손상 metadata는 중단. |
| 최종 process helper 회귀 | **PASS 19 / FAIL 0** | [core-final.txt](evidence/t7-mac-followup/core-final.txt). detached SIGTERM 저항 자식의 timeout 정리 포함. 전체 테스트 수와 중복 합산하지 않음. |
| 최신 FE 후보 typecheck / lint / Jest | **PASS** | [fe-final-checks.txt](evidence/t7-mac-followup/fe-final-checks.txt): **127 suites / 1,625 tests**. Node/npm 검사 모두 기존 Mac check sandbox 안에서 실행. |
| Design Lab 기본 타입 검사 / 연속 build 2회 / lint | **PASS** | [lab-final-checks.txt](evidence/t7-mac-followup/lab-final-checks.txt). 의존성 읽기 전용 유지. |
| Design Lab 출력 링크 공격 | **PASS** | [lab-output-link-attack.txt](evidence/t7-mac-followup/lab-output-link-attack.txt). project 내부 target을 가리키는 dist 링크도 build가 거부하고 canary는 보존. 링크 제거 후 정상 build 통과. |
| Design Lab 기본 dev 명령과 화면 | **PASS** | [final-design-lab-runtime.txt](evidence/t7-mac-followup/final-design-lab-runtime.txt). loopback 14173, 390px, 내용 543자, overflow 0, browser error 0. [화면](evidence/t7-mac-followup/screenshots/design-lab-390.png). |
| 기존 Workspace → Expo Lab → Studio 캡처 | **PASS** | [final-design-capture.txt](evidence/t7-mac-followup/final-design-capture.txt), 최종 FE `711f4e3`. 375/390/402/430px, 많은 일정·긴 글자(1.5배) 모두 overflow 0. baseline/candidate 해시가 다름. 승인 JSON은 변경하지 않음. |
| Lab 소유권 / 구조 schema parity | **PASS / NOT_RUN** | [final-design-boundaries.txt](evidence/t7-mac-followup/final-design-boundaries.txt). 미소유 loopback 서버 거부는 PASS. main에 `home.hero.structure`이 없어 해당 구조 branch 전용 parity 검사는 NOT_RUN이며 승인을 만들어 넣지 않음. |
| JDK·Gradle 배포본·Wrapper·고정 Maven 자료 검증 | **PASS** | [출처](evidence/t7-mac-followup/tool-provenance.json), [다운로드 해시](evidence/t7-mac-followup/tool-download.txt), [Maven checksum](evidence/t7-mac-followup/maven-provenance.json), [변조·출처 거부](evidence/t7-mac-followup/gradle-material-security.txt). 이것은 BE 빌드 PASS가 아니다. |
| macOS Gradle dependency resolution / BE checks | **BLOCKED** | [최소 fixture 실행](evidence/t7-mac-followup/gradle-final-block.txt), [실제 BE 입력 검사](evidence/t7-mac-followup/be-gradle-current-block.txt). 상세 사유는 아래와 같다. |
| Gradle 실제 악성 build script 실행 및 BE 정상 테스트 | **NOT_RUN** | 준비가 차단돼 build script·BE test를 실행하지 않음. 사전 입력·자료 변조 거부와 구분한다. |
| Windows 재검증 / 네이티브·물리 기기 / Tailscale·화면 잠금·24시간 주기 | **NOT_RUN** | Mac Web·fixture 결과로 대체하지 않음. |

## 해결한 원인과 변경

- **Mac 파일 경계:** 실행 전 canonical project tree를 검사하고 다른 device, 외부 symlink, 특수 파일, 과도한 깊이/항목을 거부한다. npm workspace는 lockfile에 명시된 내부 링크와 Git 추적 manifest를 검증하고 그 내용까지 승인 digest에 묶는다. 기존의 임의 외부 링크 거부를 해제하지 않았다.
- **강제 종료:** 기존 provider/check/setup 경로에 원자적인 `data/mac-processes/*.json` checkpoint를 추가했다. owner와 자식의 Darwin 시작 시각(마이크로초)을 사용해 exec와 PID 재사용을 구분한다. 기록에 argv·환경변수를 넣지 않는다. Worker는 claim 전 dead-owner 프로세스를 정리하고, 남은 checkpoint는 해당 worktree 재실행을 막는다. 손상된 metadata를 자동 삭제하지 않는다. 프로세스 정보 수집 자체가 불가능하면 실행 전 실패한다.
- **FE/Lab:** 신뢰된 lockfile 설치가 실제 workspace 링크를 지원하도록 수정했다. FE 후보에서 TS incremental 정보는 `.cache`로, Vite 최적화 캐시는 실행별 canonical 임시 디렉터리로 옮겼다. Vite config runner를 사용해 `node_modules/.vite-temp` 쓰기를 없앴다. 반복 build에서는 generated `dist`의 일반 파일을 sandbox 안에서 정리하고 빈 디렉터리는 보존한다. 링크가 있는 출력은 거부한다. root deny·읽기 전용 의존성·외부 접근 제한을 넓히지 않았다.
- **출처 확인:** private 경로에 Temurin **21.0.13+9**, Gradle **9.1.0**을 준비했다. 공식 배포 checksum, archive와 설치 tree, 고정 native Java/Gradle 실행 파일, Wrapper JAR, artifact별 HTTPS URL·SHA-256을 검사한다. 다운로드는 Gradle build 코드와 분리된 제한된 resolver만 수행하며 checksum 불일치·미승인 origin·cache 대체·user-home script는 거부한다. 성공한 dependency resolution만 marker를 발급한다.

자료 검증용 정책은 테스트 fixture용이다. 이를 Momentory BE 승인 정책으로 간주하지 않는다. 정책/실행 파일 pin이 없으면 Mac Gradle은 계속 중단한다. 기존 Worker/AI 엔진과 테스트 진입점을 확장했으며 별도 Workspace나 하네스를 만들지 않았다.

## 남은 Gradle 차단

`projects.json`의 BE setup은 `./gradlew dependencies --configuration testRuntimeClasspath --no-daemon`, 이후 check는 `./gradlew test`다. 따라서 **Gradle은 BE 작업의 필수 경로**이며 FE/sample에는 필요하지 않다.

1. 실제 BE Wrapper JAR은 공식 9.1.0 checksum과 일치하지만 Wrapper properties에는 `distributionSha256Sum`이 없다. BE build/plugin/의존성 전체에 대한 승인된 검증 metadata도 없다. 실제 원본 BE에 쓰거나 미승인 build 입력을 승인하지 않고 중단했다.
2. 출처와 checksum을 모두 갖춘 별도 최소 Gradle fixture도 현재 **network=false sandbox에서 `FileLockContentionHandler` 생성 중 `SocketException: Operation not permitted`**로 종료했다. [Gradle 9.1.0 구현](https://github.com/gradle/gradle/blob/v9.1.0/platforms/core-execution/persistent-cache/src/main/java/org/gradle/cache/internal/locklistener/DefaultFileLockCommunicator.java)은 lock 통신용 UDP socket을 생성한다. `--offline --no-daemon`만으로 이 IPC 요구가 사라지지 않았다.
3. 통신을 계속 거부하는 중첩 Seatbelt 대안도 `sandbox_apply: Operation not permitted`로 중단됐다. 이 안은 채택하지 않았고 최종 프로필은 **network=false**다. 무제한 네트워크·host Gradle 실행으로 우회하지 않았다. 성공 marker도 발급하지 않았다.

검증된 도구와 자료 준비는 구현했지만, 정상 Gradle dependency resolution과 test-worker IPC를 기존 경계에 맞게 제공하는 경로는 완성하지 못했다. 실제 BE 전체 artifact 검토, cache 보호, 정상·악성 build 실행 검증도 남는다. 이 때문에 **정식 출시는 불가**다. [Gradle Wrapper 검증](https://docs.gradle.org/current/userguide/gradle_wrapper.html)과 [dependency verification](https://docs.gradle.org/current/userguide/dependency_verification.html)의 요구를 생략한 PASS를 부여하지 않았다.

## 실패 조사와 증거 보존

초기 FE 설치는 정상 npm workspace 링크를 탈출로 처리해 실패했다. 고정 링크/manifest 검증을 추가한 뒤 새 locked install로 통과했다. 오래된 FE ref에는 Studio 파일이 없었으나 원격 main fetch로 해결했다. Lab 기본 타입 검사는 `node_modules/.tmp` 쓰기, dev는 최적화 cache rename, 반복 build는 생성 디렉터리 삭제에서 실패했다. 앞의 실패 로그를 보존하고 각각 실제 최종 명령을 재실행했다. 예전 실패 cache 때문에 생성 JS가 lint 대상이 된 경우도 조사해 해당 실험 cache만 정리했다. 테스트 assertion을 삭제하거나 정책을 넓혀 통과시키지 않았다.

최종 evidence는 [결과 목록](evidence/t7-mac-followup/results.json), [변경 파일·해시·FE 커밋](evidence/t7-mac-followup/changes.json), [실행 명령](evidence/t7-mac-followup/COMMANDS.md), [SHA-256 목록](evidence/t7-mac-followup/SHA256SUMS.txt)에 있다. 원본 로그는 ignored `data/t7-followup/`에 보존하고, 비밀 패턴을 검사한 후 줄 끝 공백만 정리한 사본과 최종 revision의 PNG를 커밋한다. 설치 archive·계정 파일·합성 DB와 worktree는 커밋하지 않는다.

Mac 프로세스 검증은 실제 checkpoint에 저장된 제어된 자식과 재시작 시나리오의 증거다. 이것을 VM 수준 격리나 모든 임의 native 프로그램의 수명에 대한 증명으로 확대하지 않는다. 최신 FE Web 캡처도 네이티브·물리 기기 QA를 대신하지 않는다.

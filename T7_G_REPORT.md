# T7-G — macOS Secure Gradle Execution

검증 기간: 2026-10-26~27 KST. **T7-G: PARTIAL / Workspace Release: NOT READY.**

macOS의 소켓 차단은 별도의 네트워크 namespace를 가진 기존 Colima/Docker에서 해결했다. 최소 fixture의 정상 실행·공격 거부·취소·타임아웃·실제 Worker 강제 종료/복구는 통과했다. 실제 BE는 검토 모드에서 오프라인 해석과 `clean check`를 수행했으나, 626개 의존성 자료의 승인 기준이 없어 **정식 신뢰 준비/BE acceptance는 BLOCKED**다. 생성한 메타데이터를 승인으로 승격하지 않았다.

## 기준과 보존

- 실행 전 후보: `workspace/t7-macos-release-blockers`, `5372d41c9e74048a9ebc0a8f7e06d11c8c25c52a`, 작업 트리 clean.
- Workspace 변경: 같은 기존 worktree의 새 브랜치 `workspace/t7-g-secure-gradle`. 이전 후보와 원본 main `10d835a`는 보존했다.
- 실제 BE 기준: 원본 `main=ca3bc87f9d679ea6edd37fffa5e5390e307952b8`, clean. 후보는 `/Users/kjh/Momentory/momentory-be-t7-g`, `workspace/t7-g-gradle-checksums`, **`b2be605ecacc2fc2fe1427b7f6437ccabb534e78`**다. 변경은 Wrapper properties의 distribution SHA-256 한 줄뿐이다.
- 원본 FE/BE, Workspace main/dev를 수정하거나 병합하지 않았다. push·배포·구조 디자인 승인은 하지 않았다. 기존 AI 엔진·준비 함수·검사 함수·Worker·checkpoint·테스트를 확장했다.

## IPC 원인과 방식 선택

[Gradle 9.1.0 파일 잠금 구현](https://github.com/gradle/gradle/blob/v9.1.0/platforms/core-execution/persistent-cache/src/main/java/org/gradle/cache/internal/locklistener/DefaultFileLockCommunicator.java)은 DatagramSocket 생성 시 포트 0에 wildcard bind하고 UDP 송수신으로 잠금 해제를 알린다. [InetAddressFactory](https://github.com/gradle/gradle/blob/v9.1.0/platforms/core-runtime/messaging/src/main/java/org/gradle/internal/remote/internal/inet/InetAddressFactory.java)는 wildcard와 로컬 통신 주소를 구분한다. [TCP connector](https://github.com/gradle/gradle/blob/v9.1.0/platforms/core-runtime/messaging/src/main/java/org/gradle/internal/remote/internal/inet/TcpIncomingConnector.java)와 [TestWorker](https://github.com/gradle/gradle/blob/v9.1.0/platforms/software/testing-base-infrastructure/src/main/java/org/gradle/api/internal/tasks/testing/worker/TestWorker.java)도 별도 JVM 통신을 사용한다. `--offline --no-daemon`이어도 single-use daemon과 Worker의 IPC는 필요하다.

실제 C syscall probe에서 기존 `network=false`는 IPv4/IPv6 모두 **socket()은 성공하고 wildcard bind()는 errno 1(EPERM)**로 거부했다. 따라서 Java의 DatagramSocket 생성자 오류는 그 안의 자동 bind 단계와 부합한다. [native-syscalls.json](evidence/t7-g/native-syscalls.json)에 socket/bind/listen/send/receive 결과를 분리해 기록했다.

| 방식 | 실측·평가 | 채택 |
| --- | --- | --- |
| A. 기존 Seatbelt + managed proxy, 외부 domain allow 없음, 로컬 바인딩 | IPv4/IPv6 외부 TCP/UDP EPERM. 로컬 UDP wildcard 송수신과 TCP 가능. JVM 자식까지 IPv4 설정을 전달하고 실행별 임시 캐시/출력을 사용하면 최소 fixture 실행도 성공했다. 그러나 **무관한 호스트 loopback 서비스 접근도 성공**해 project 경계 요구에 부적합했다. | 거부 |
| B. 이미 실행 중인 Colima VZ VM의 Docker `--network none` | 네트워크 namespace 안의 IPC를 사용한다. 실제 fixture에서 로컬 TCP/UDP, Test Worker, Worker API가 동작하면서 외부 IPv4/IPv6 TCP/UDP와 활성 호스트 loopback 서비스 접근이 실패했다. | 채택 |
| C. 구현할 수 없을 때 BLOCKED | v2 정책·검토된 자료·로컬 런타임이 없거나 정리를 확인할 수 없으면 실행/재사용을 중단한다. | 안전한 실패 경로 유지 |

A는 별도 실험 프로필로만 실행했다. [OpenAI 권한 문서](https://learn.chatgpt.com/docs/permissions)의 proxy 활성화와 로컬 통신 설정을 검토했고, 설치된 Codex 0.163.0의 source tag 및 실제 소켓 동작을 대조했다. 이 프로필은 마지막에 삭제했다. 기존 제품 프로필의 `network=false`는 바꾸지 않았다. 외부 네트워크를 전부 허용하는 대체 실행은 하지 않았다.

## 채택한 실행 경계

[Docker의 none driver](https://docs.docker.com/engine/network/drivers/none/)를 사용하며 실행 전 실제 container 설정을 검사한다. 이미 설치된 Colima VM을 사용하고 새 VM/AI 엔진/Workspace를 만들지 않았다. Mac 호스트에서 Gradle을 직접 실행하지 않는다. Gradle은 VM 안의 Linux arm64에서 동작한다. **네이티브 macOS Gradle PASS로 표현하지 않는다.**

- 고정한 Docker 실행 파일 SHA-256, 로컬 소유 0600 Colima Unix socket, 비어 있는 전용 Docker 설정만 사용한다. Homebrew Cellar의 group-write ancestor 때문에 기존 신뢰 검사가 거부한 파일은 정책을 완화하지 않고 동일 SHA의 전용 사본으로 고정했다.
- Ubuntu arm64 이미지는 manifest digest와 image ID를 함께 고정한다. `--pull=never`, root filesystem read-only, UID/GID 65532, 모든 capability 제거, no-new-privileges, 기본 seccomp, `docker-default` AppArmor, 별도 PID/IPC/cgroup namespace, 2 CPU/2 GiB/256 PID 제한을 확인한다.
- `.git`, 기존 `.gradle`/build/out, `.env*`, PEM/key/credentials 및 도구 인증 디렉터리를 제외한 source snapshot만 읽기 전용으로 mount한다. snapshot의 symlink·다른 device·특수 파일·과도한 크기/깊이는 거부한다. 파일당 64 MiB, 총 256 MiB 상한으로 호스트 복사도 제한한다. Gradle이 요구하는 쓰기는 container 내부 `/work` 사본과 tmpfs 캐시/빌드 출력에서만 수행한다.
- JDK·Gradle·Maven 자료·init script도 읽기 전용이다. 호스트 소스, Workspace 데이터, 다른 project, Docker socket, 사용자 캐시/계정/환경 비밀을 container에 제공하지 않는다. 실행별 캐시는 폐기하고 재사용하지 않는다.
- Gradle은 offline·strict verification으로만 실행한다. 준비 단계는 dependency report의 종료 코드만 믿지 않고 compile/test configuration의 실제 파일 해석까지 강제한다. marker는 해당 성공·재검증·정리가 모두 끝난 뒤 발급한다.
- container 생성 **전** 기존 Mac registry에 원자적 checkpoint를 저장한다. 재시작 시 이름만 믿지 않고 Workspace/worktree/실행 label과 전체 ID를 확인해 소유 container만 제거한다. daemon/tool 접근 불가나 label 불일치는 checkpoint를 남기고 재사용을 막는다. 다른 소유 container는 삭제하지 않는다. container 내부 timeout도 별도로 둔다.

Linux Temurin **21.0.13+9** archive SHA는 `e3522e707fc7dbe2a72c30746b1e7068301a0213ecd213d4491f35a14eb55578`이며 공식 release asset과 checksum 파일에 일치했다. archive의 내부 legal symlink 205개는 canonical target의 동일 바이트 일반 파일로 바꿔 설치 tree를 pin했다. Gradle **9.1.0** 배포 SHA는 `a17ddd85a26b6a7f5ddb71ff8b05fc5104c0202c6e64782429790c933686c806`, Wrapper JAR 공식 SHA는 `76805e32c009c0cf0dd5d206bddc9fb22ea42e84db904b764f3047de095493f3`다. 기존 Mac JDK pin도 보존했다. 자세한 pin은 [runtime-provenance.json](evidence/t7-g/runtime-provenance.json)에 있다.

## 실제 검증

| 항목 | 결과 | 증거 |
| --- | --- | --- |
| 최소 fixture 준비·오프라인 해석 | PASS | [container-fixture-prepare.txt](evidence/t7-g/container-fixture-prepare.txt) |
| fixture `clean check`, 실제 Test Worker 5개, 별도 Worker API | PASS / FAIL 0 / NOT_RUN 0 | [container-fixture-check.txt](evidence/t7-g/container-fixture-check.txt) |
| 악성 build script, IPv4/IPv6 TCP·UDP, 활성 호스트 loopback, project 비밀, 외부 파일, source/tool/artifact 쓰기 | PASS: 거부 확인 | 위 로그 및 [최종 Gradle 회귀](evidence/t7-g/final-gradle-regression.txt). private build 사본의 정상 쓰기는 허용되고 호스트 소스는 변하지 않음. |
| metadata/artifact/marker 변조·미승인 캐시·미승인 origin·다른 container 소유권 | PASS: 거부 확인 | [final-gradle-regression.txt](evidence/t7-g/final-gradle-regression.txt) |
| 실행 취소·타임아웃·fresh check 복구 | PASS | 같은 로그. 실제 sleep 자식이 시작한 후 취소하고 namespace/checkpoint 제거 확인. |
| 실제 Worker SIGKILL·자식 잔존·재시작 정리·검토된 재개 | PASS | [worker-gradle-kill.txt](evidence/t7-g/worker-gradle-kill.txt), [worker-gradle-resume.txt](evidence/t7-g/worker-gradle-resume.txt). Worker 하나만 종료; JVM/sh/sleep 잔존을 관찰한 뒤 namespace 제거. 같은 worktree, 부분 변경 보존, 미검토 resume 409, attempt 2에서 Gradle test 후 AWAITING_APPROVAL. |
| 기존 자동 테스트 | PASS 38 / FAIL 0 / NOT_RUN 1 | [final-unit.txt](evidence/t7-g/final-unit.txt), provider/npm/mount/Gradle opt-in 포함. Node SKIP 1개는 다른 OS 전용 거부 검사다. |
| 추가 Gradle/기존 npm·mount 집중 회귀 | PASS 10 / FAIL 0 / NOT_RUN 1 | [final-gradle-regression.txt](evidence/t7-g/final-gradle-regression.txt). 전체 suite와 중복 합산하지 않음. |
| 기존 보안/복구 integration 10개 | PASS, 모두 exit 0 | [integration-summary.json](evidence/t7-g/integration-summary.json): Codex/Claude 경계, cancel/timeout, local/recovery, diff/상속, sandbox, pause, orphan. |
| 기존 AI 프로필 보존 | PASS | [ai-profile-preservation.json](evidence/t7-g/ai-profile-preservation.json). v2는 native Gradle 프로필 설치를 요구하지 않음. |
| 실제 BE Wrapper checksum 후보 | PASS | [be-wrapper-review.json](evidence/t7-g/be-wrapper-review.json), BE `b2be605` |
| 실제 BE 오프라인 **검토용** dependency 해석 | PASS for discovery only | [be-metadata-review.json](evidence/t7-g/be-metadata-review.json). 626개 자료, 승인 발급 없음. |
| 실제 BE **검토용** `clean check` | exit 0, 266 통과 / FAIL 0 / NOT_RUN 237; 신뢰 acceptance는 BLOCKED | [be-check-UNAPPROVED.json](evidence/t7-g/be-check-UNAPPROVED.json), [suite별 집계](evidence/t7-g/be-test-summary.UNAPPROVED.json). 승인되지 않은 cached bytes의 격리된 진단 실행이다. |
| 실제 BE의 폐기 가능한 검토 사본에 삽입한 악성 build script | PASS: 11개 접근 거부; 의존성 승인과 별개 | [be-malicious-review.json](evidence/t7-g/be-malicious-review.json), [삽입 코드](evidence/t7-g/be-malicious-build-addon.txt). Workspace/다른 project/비밀 파일 읽기, host source/tool/artifact 쓰기, IPv4/IPv6 TCP·UDP, 활성 host loopback 거부. 원본 BE와 checksum 후보는 수정하지 않음. |
| BE 정식 신뢰 준비/승인된 의존성으로 전체 검사 | BLOCKED | 승인 기준 미확보. 검토 초안으로 정상 setup/check를 호출하면 거부함. |
| BE DB·실서비스·challenge 조건 검사 | NOT_RUN 237 | 기존 Docker 조건 234, 실제 API 인증정보 조건 2, challenge 파일 존재 assumption 1. 원래 조건을 유지했다. |
| FE/Lab 재구축·Windows·물리 기기·24시간 운영 | NOT_RUN in T7-G | 관련 source를 바꾸지 않았다. 이전 Mac 결과를 이번에 다시 실행했다고 주장하지 않음. |

## 실제 BE 의존성 검토와 남은 차단

사용자에게 기존 승인 metadata/hash 기준을 확인했으나 제공된 기준이 없었다. DB PEM 키와는 관계없는 자료이며 운영 DB 키나 비밀번호를 요청하거나 사용하지 않았다.

기존 호스트 Gradle 캐시 756개를 **미승인 quarantine**으로 복사했다. 원본 캐시는 변경하지 않았다. 네트워크 없는 같은 container에서 실제 BE 입력을 해석해 626개 사용 자료의 [UNAPPROVED XML](evidence/t7-g/be-verification-metadata.UNAPPROVED.xml)과 [검토 목록](evidence/t7-g/be-proposed-artifacts.json)을 만들었다. 나머지 130개를 승인 목록에 섞지 않았다. 검토 기능은 `reviewOnly=true`인 별도 pinned 정책만 받고, 그 정책은 제품 setup/check에서 거부한다. BE 후보에는 이 XML을 적용하지 않았고 BE 승인 marker도 만들지 않았다.

[게시 checksum 비교](evidence/t7-g/be-publisher-comparison.json)에서 282개가 SHA-256/512에 일치했다. 강한 checksum sidecar가 없던 344개 중 343개는 현재 Maven Central 바이트의 SHA-256과 일치했다. 나머지 1개는 Spring Boot plugin marker POM이었다. [조사](evidence/t7-g/plugin-marker-origin-review.json)에서 공식 Plugin Portal의 680바이트가 cached SHA에 일치하고 Central의 1,727바이트와 형식·설명 metadata가 다름을 확인했다. 두 POM은 같은 `spring-boot-gradle-plugin:4.1.0`을 가리킨다. 미확인 변조로 단정하지 않았으며 다른 origin의 checksum으로 자동 교체/승인하지 않았다. 다운로더는 exact Maven Central/Plugin Portal URL과 pinned SHA만 받고 redirect는 거부한다.

현재 HTTPS 바이트가 같다는 사실이나 Gradle 자동 생성 XML만으로 기존 승인 기준을 만들어 내지 않았다. **626개에 대한 검토/승인된 기준 확정 → 승인된 자료만 별도 immutable repository로 구성 → Git 추적 verification XML과 v2 정책을 함께 pin → 정식 준비/검사**가 남는다. [Gradle 공식 설명](https://docs.gradle.org/current/userguide/dependency_verification.html)도 생성 metadata의 별도 검토를 요구한다.

237개 미실행 조건도 남는다. Docker control socket을 build에 노출하면 현재 경계가 깨지므로 Testcontainers를 통과시키기 위해 mount하지 않았다. DB 테스트를 위한 별도의 안전한 방식과 실서비스/challenge 조건의 승인된 검증은 완료하지 않았다. 다른 기기/장기 운영 조건까지 미완료이므로 정식 출시는 불가하다.

## 실패 조사와 재현 자료

최초 container 시도에서 Colima에 공유되지 않는 Mac 임시 경로, 접근 불가 mask 파일, Gradle의 쓰기 가능한 project 요구를 각각 확인했다. 생성 전 checkpoint, 공유되는 private control 디렉터리, secret 제외 snapshot과 VM 내부 사본으로 수정하고 재실행했다. BE 공격 프로브의 첫 Kotlin DSL은 `java` extension과 package 이름 충돌로 컴파일되지 않았다. 명시적 import alias로 고친 뒤 11개 거부를 실제 실행했다. 권한·assertion·기존 skip 조건을 완화하지 않았다. 초기 실패 로그도 증거에 포함했다.

[실행 명령](evidence/t7-g/COMMANDS.md), [분류 결과](evidence/t7-g/results.json), [변경 파일/해시](evidence/t7-g/changes.json), [증거 SHA-256](evidence/t7-g/SHA256SUMS.txt), [최종 보존/정리 상태](evidence/t7-g/final-state.json)를 함께 기록했다. 설치 archive/캐시/JAR/이미지/계정/DB/인증 값은 커밋하지 않는다. Workspace commit은 이 보고서를 포함하는 `workspace/t7-g-secure-gradle`의 commit이다.

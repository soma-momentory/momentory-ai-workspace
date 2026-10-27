# T7-H — Momentory BE Dependency Trust Review

2026-10-27 KST. **T7-H 승인 준비: DONE. 의존성 승인: 대기. 정식 BE 준비·검사: BLOCKED. Workspace Release: NOT READY.**

626개 파일을 모두 조사해 승인자가 검토할 목록과 근거를 고정했다. A는 신뢰 근거 분류이며 승인 상태가 아니다. 모든 행의 승인 상태는 `PENDING_HUMAN_DECISION`이다. 운영 승인 마커, BE 검증 메타데이터, lockfile을 발급하거나 적용하지 않았다.

| 기준 | 값 |
|---|---|
| Workspace 기반 | `workspace/t7-g-secure-gradle` / `bccd7553da9ec9a4d2b4aed11b44f3290ef29dd4` |
| 검토 브랜치 | `workspace/t7-h-be-dependency-trust-review` |
| BE 후보 | `workspace/t7-g-gradle-checksums` / `b2be605ecacc2fc2fe1427b7f6437ccabb534e78` |
| 호스트 / 실행 | macOS 26.6.2 arm64 / 기존 Colima Linux aarch64 컨테이너 |
| Gradle / JDK | 9.1.0 / Temurin 21.0.13+9 |
| 검토 XML SHA-256 | `57c771118bc6cb167f2ea35de1794a7a73991603c208c903de87dcf0adaa3fb2` |
| Inventory SHA-256 | `6f9c701cab947ad243c444c27b7a976cd998c0c861815557c384ca52515e56d0` |

## 집계와 실제 그래프

기준은 T7-G의 [미승인 검증 XML](evidence/t7-g/be-verification-metadata.UNAPPROVED.xml)에 있는 **GAV + 실제 파일명 + SHA-256** 조합이다. [전체 CSV](BE_DEPENDENCY_INVENTORY.csv)는 이 집합과 정확히 일치한다.

| 집계 | 수 |
|---|---:|
| 고유 파일 | 626 |
| 고유 GAV | 387 |
| JAR / POM / Gradle Module Metadata | 207 / 275 / 144 |
| 실제 선택된 외부 GAV | 215 |
| 직접 선언으로 연결된 GAV | 21: 프로젝트 20 + 플러그인 marker 1 |
| 직접 선언 없이 전이로 연결된 선택 GAV | 194 |
| 선택 컴포넌트 밖의 모델·해석용 GAV | 172 |
| 실제 resolved JAR / 검증 XML의 JAR | 207 / 207, 누락·추가·해시 차이 0 |
| 빌드 classpath JAR | 23 |
| 버전 충돌 해결 사유가 기록된 선택 GAV | 33 |
| configuration 간 서로 다른 버전이 선택된 모듈 | 8 |
| 미해결 edge / 외부 SNAPSHOT / 선택된 동적 버전 요청 | 0 / 0 / 0 |

프로젝트의 자체 버전 `0.0.1-SNAPSHOT`은 외부 의존성 387개에 포함하지 않는다. BOM의 직접 constraint를 직접 선언으로 세지 않았다. 서로 다른 configuration에서 선택된 버전도 합치지 않았다. 예를 들어 Commons Lang은 애플리케이션에서 3.20.0, 빌드 classpath에서 3.16.0이다. 후자는 보안 권고 대상이다.

172개는 BOM, parent, 중간 버전의 모델 등 해석 중 필요한 메타데이터다. 이를 실행되는 런타임 라이브러리 172개로 해석하면 안 된다. CSV의 `model_role`, `model_references`, `selected_scopes`, `requested_selectors`, `selection_reasons`에 근거를 남겼다. POM의 속성 표현식은 Gradle이 해석했으며 원문 표현식 자체를 동적 버전으로 판정하지 않았다. `9+181-r4173-1` 같은 고정 버전 안의 `+`도 동적 selector가 아니다.

실제 BE 후보를 보존하고 별도의 일회용 clone에 그래프 출력 코드만 추가했다. 기존 `reviewMacGradleMetadata`를 통해 모든 resolvable 프로젝트 configuration과 buildscript classpath를 조사했다. [새 그래프](evidence/t7-h/resolved-graph.json), [실행 로그·격리 설정](evidence/t7-h/graph-review-run.json), [비교 결과](evidence/t7-h/metadata-graph-comparison.json)에서 새 검토 XML도 동일한 626개와 해시를 갖는 것을 확인할 수 있다. 기존 격리 실행 경로는 수정하지 않았다.

## 전체 신뢰 분류

| 분류 | 파일 | GAV | 판단 |
|---|---:|---:|---|
| A | 278 | 164 | 바이트 서명 유효 + Maven 저장소와 분리된 공식 발행자 자료에서 키·프로젝트 범위를 대조 |
| B | 287 | 180 | 기준 SHA-256 일치. 독립적인 발행자 신원 근거 부족 또는 서명 없음 |
| C | 61 | 43 | 약한 서명 해시, 만료 키에 대한 판단, 공개키 미확인 등 추가 조사 필요 |
| D | 0 | 0 | 실제 파일에서 확정된 해시 불일치·서명 바이트 검증 실패 없음 |
| 합계 | 626 | 387 | 승인된 항목 0 |

623개는 detached signature의 수학적 검증에 성공했고, 1개는 공개키 미확인, 2개는 서명이 없었다. **623개 서명 검증 성공은 623개 신뢰 승인이라는 뜻이 아니다.** 유효 서명 중 345개는 이 검토에서 발행자 신원을 독립적으로 연결하지 못했다. 이 수에는 B뿐 아니라 C도 포함한다. [서명 검증 원문](evidence/t7-h/signature-verification.ndjson), [키별 검토 색인](evidence/t7-h/signer-review-index.csv)을 제공한다.

| A의 독립적인 공식 근거 | 파일 |
|---|---:|
| [Spring 공개 fingerprint](https://spring.io/GPG-KEY-spring.txt), `org.springframework*`로 범위 제한 | 189 |
| [Jackson 공식 KEYS](https://github.com/FasterXML/jackson/blob/main/KEYS), Jackson 좌표로 범위 제한 | 25 |
| [Apache Commons KEYS](https://downloads.apache.org/commons/KEYS) | 28 |
| [HttpComponents KEYS](https://downloads.apache.org/httpcomponents/KEYS) | 9 |
| [Logging KEYS](https://downloads.apache.org/logging/KEYS) | 7 |
| [Tomcat 11 KEYS](https://downloads.apache.org/tomcat/tomcat-11/KEYS) | 6 |
| [Groovy KEYS](https://downloads.apache.org/groovy/KEYS) | 6 |
| [ActiveMQ KEYS](https://downloads.apache.org/activemq/KEYS) | 4 |
| [Cassandra KEYS](https://downloads.apache.org/cassandra/KEYS) | 2 |
| [Pulsar KEYS](https://downloads.apache.org/pulsar/KEYS) | 2 |

Spring fingerprint는 `48B086A7D843CFA258E83286928FBF39003C0425`, Jackson fingerprint는 `28118C070CB22A0175A2E8D43D12CA2AC19F3181`이다. 서명에서 확인한 전체 fingerprint 및 primary fingerprint를 기록했다. 하위 키는 primary의 binding signature도 확인했다. 키 서버의 UID 문자열이나 64-bit key ID만으로 발행자를 승인하지 않았다. 같은 Spring 키를 쓰더라도 명시적으로 확인한 프로젝트 범위 밖의 Micrometer·Reactor·별도 Gradle 플러그인 등에 A를 전파하지 않았다.

A는 공식 HTTPS 발행자 자료를 신뢰 기준으로 사용한 검토 분류다. reproducible build, 소스와 바이너리의 동일성, 모든 키 인증 경로의 증명을 뜻하지 않는다. 이 신원 기준의 조직 내 수용 여부도 승인자가 결정해야 한다. [Apache 검증 지침](https://apache.org/info/verification.html) 역시 체크섬과 키 가져오기만으로 작성자 신원이 증명되지 않는다고 설명한다.

T7-G의 같은 저장소 SHA-256/512 sidecar 일치 282개는 독립 검증으로 승격하지 않았다. Gradle 자체 저장소의 검증 keyring은 다른 소비자의 참고 근거로만 사용했다. [다운로드 결과](evidence/t7-h/signature-downloads.json), [공식 자료·키의 URL 및 해시](evidence/t7-h/key-sources.json), 원본 공개 서명·키를 보존했다.

플러그인 marker POM은 Plugin Portal의 680바이트 파일을 기준으로 한다. Maven Central의 같은 좌표 POM은 다른 바이트다. T7-G에서 출처 차이를 확인한 결과를 유지했고, Central의 체크섬·서명을 Portal 파일에 대입하지 않았다. Portal marker는 서명 부재로 B다. [기존 출처 대조](evidence/t7-g/plugin-marker-origin-review.json)를 참고한다.

## 위험 검토와 남은 출시 차단

신뢰 등급과 위험 우선순위를 별도 열로 제공한다. P0는 빌드 실행 코드 또는 보안 권고 관련 검토 우선순위이며 CVSS 점수가 아니다. 특히 Spring Boot 플러그인, 그 전이 classpath 23개 JAR, 주요 런타임, 인증·암호화·네트워크·입력 파서에 우선순위를 부여했다.

[OSV 공식 API](https://google.github.io/osv.dev/api/)에 387개 GAV의 정확한 버전을 모두 조회했다. 오류 0, 12 GAV / 24 파일에서 고유 권고 22개가 일치했다. [원문 응답과 수정 범위](evidence/t7-h/osv-results.json), [발행자 참고 자료 URL·해시](evidence/t7-h/advisory-sources.json), [예외 문서](BE_DEPENDENCY_EXCEPTIONS.md)에 상세 항목이 있다. 영향 버전 일치는 실제 서비스에서의 공격 가능성 입증과 구분한다.

추가로 [Tomcat 공식 보안 목록](https://tomcat.apache.org/security-11.html)의 제품 수준 영향 범위를 대조했다. 11.0.22가 포함되는 **31개 CVE 후보**를 확인했다. OSV가 반환한 Tomcat 3개보다 넓다. embedded core/websocket/EL별 적용 여부는 미확정이며, 이를 31개의 확정된 BE 취약점으로 세지 않았다. [발행자 보충 자료](evidence/t7-h/tomcat-publisher-supplement.json)를 따로 제공한다. OSV 조회 결과를 전체 취약점 목록으로 사용해서는 안 된다.

심각도도 출처별로 보존해야 한다. 예를 들어 Spring MVC 관련 OSV 기록은 CRITICAL을 표시하지만, 공식 발행자는 [CVE-2026-47890을 LOW](https://spring.io/security/cve-2026-47890/), [CVE-2026-47884를 MEDIUM](https://spring.io/security/cve-2026-47884/)으로 분류한다. 이 차이를 숨기거나 자동으로 비적용 처리하지 않았다. BE Java 소스에서 `XsltView`, `FragmentsRendering`, `SseEmitter`, `DigestAuthenticator`의 명시적인 사용은 검색되지 않았지만, 서비스 설정까지 포함한 비적용 결론은 내리지 않았다.

출처가 A인 Jackson·Spring MVC·Tomcat·빌드 도구에서도 보안 권고가 발견됐다. 패치 후보와 실제 노출 조건을 검토하고, BE 담당자와 보안 담당자가 수정 또는 근거 있는 위험 수용 여부를 결정해야 한다. 후보 버전을 이 작업에서 바꾸지 않았다. JUnit 4.13.2는 [공식 유지보수 모드 안내](https://github.com/junit-team/junit4)를 기록했으며 제거 가능성 판단을 남겼다.

## 재현성과 격리 검사

Dependency Locking은 **추가하는 것이 필요하다**. BOM 버전과 SHA-256 검증은 선택된 configuration별 그래프를 lock하는 기능과 다르다. 33개 충돌 해결과 8개 configuration 간 버전 차이를 명시적으로 고정할 필요가 있다. 프로젝트 configuration의 strict locking과 buildscript classpath의 별도 locking을 승인 후 후보에서 검토해야 한다. 현재 BE에는 lockfile이 없으며, 이번 작업에서 미승인 lockfile을 적용하지 않았다. [Gradle 9.1 locking](https://docs.gradle.org/9.1.0/userguide/dependency_locking.html), [verification](https://docs.gradle.org/9.1.0/userguide/dependency_verification.html)을 기준으로 한다.

격리 runner는 그대로 유지했다. `--offline`, `--dependency-verification strict`, `--network none`, 읽기 전용 입력, uid 65532, 전체 capability 제거, no-new-privileges, AppArmor, private IPC/cgroup, 새 tmpfs Gradle home을 재확인했다. 호스트 Docker socket과 사용자 home을 컨테이너에 연결하지 않았다. [현재 Colima 상태](evidence/t7-h/colima-status.json), [Docker 보안 설정](evidence/t7-h/docker-security.json) 및 실제 실행의 inspect 결과를 함께 보존했다.

Colima VM 자체에는 네트워크와 virtiofs 공유 기능이 있다. 외부 접근 차단의 경계는 기존 VM 안의 검증된 network-none 컨테이너다. VM 관리자와 Docker daemon은 신뢰 기반에 포함되며 VM 전체가 네트워크 단절됐다고 주장하지 않는다. 악성 build의 파일·네트워크 접근은 기존 통제 fixture에서 재검사했다.

검토용 cache는 756개 파일, 검토 대상은 그중 626개다. 나머지 130개를 승인 집합에 포함하지 않았다. 검토된 재료 재사용은 해시를 다시 확인하며, 컨테이너의 실행 cache는 매번 새로 만든다. 다른 Gradle cache를 재사용하는 경로는 거부한다.

| 실제 검사 | 결과 | 증거 |
|---|---|---|
| 626개 원본 해시·XML 집합·207개 resolved JAR 대조 | PASS | CSV, `metadata-graph-comparison.json` |
| 서명 바이트 검사 | 623 VALID / 1 공개키 미확인 / 2 서명 없음 | `signature-verification.ndjson` |
| 서명 양성 대조 + 변조 파일 거부 | PASS | `signature-controls.ndjson` |
| 기존 자동 테스트 | 38 PASS / 0 FAIL / 1 NOT_RUN | `automated-tests.log` |
| 보강 후 macOS 의존성 보안 회귀 | 10 PASS / 0 FAIL / 1 NOT_RUN, 위 suite와 중복 | `mac-dependency-final.log` |
| 기존 통합 테스트 10개 모듈 | 10 PASS | `integration-results.json`, `integration-*.log` |
| 실제 마운트·symlink, 네트워크·파일 경계 회귀 | PASS, 위 자동 테스트에 포함 | `automated-tests.log` |
| 검토 재료 재사용, 미승인 artifact 추가 차단 | PASS, 이번에 assertion 보강 | `automated-tests.log` |
| XML·artifact·승인 marker 변조, cache 오염, 출처 변경 거부 | PASS, 위 자동 테스트에 포함 | `automated-tests.log` |
| Worker SIGKILL 후 guest namespace 정리 | PASS | `worker-gradle-kill.log` |
| 부분 diff 검토 후 동일 worktree 복구 | PASS | `worker-gradle-resume-retry.log` |
| 정식 BE prepare/check의 reviewOnly 정책 거부 | BLOCKED, 의도한 승인 gate 유지 | `formal-be-gate.json` |
| 미승인 격리 환경의 BE 진단 `clean check` | exit 0, 503개 중 266 실행 성공 / 237 NOT_RUN | `be-check-UNAPPROVED.json` |
| 승인된 재료를 사용하는 정식 BE prepare/check | BLOCKED / NOT_RUN | 승인 결과와 정상 BE 정책 없음 |

자동 테스트의 NOT_RUN 1개는 Mac에서 의미가 없는 타 OS 거부 테스트다. BE 진단의 NOT_RUN은 기존 Testcontainers 조건 234개, 실서비스 환경변수 조건 2개, 기존 평가 fixture 부재에 따른 assumption 1개다. Docker socket과 실서비스 비밀정보를 제공하지 않았으며 테스트 조건을 변경하지 않았다. 진단 실행 결과는 정식 BE PASS로 집계하지 않는다.

증거 수집 중 KEYS 설명문의 legacy encoding 때문에 분석기가 중단된 것을 수정했고, 잘못된 subkey certification 후보를 binding 증명으로 사용하지 않도록 했다. Testcontainers의 압축된 PGP 메시지는 64 KiB 제한으로 풀어 실제 detached signature를 검증했다. 복구 검사 첫 호출은 필수 DB 인자가 빠져 시작되지 않았고, 인자를 지정한 재실행은 통과했다. 원래 호출 로그도 남겼다. 이 수집·호출 문제를 실제 artifact 변조 또는 제품 회귀 실패로 집계하지 않았다.

## 변경 범위와 승인 조건

필수 산출물은 [Inventory](BE_DEPENDENCY_INVENTORY.csv), 이 보고서, [예외](BE_DEPENDENCY_EXCEPTIONS.md), [승인 계획](BE_DEPENDENCY_APPROVAL_PLAN.md)이다. 추가 변경은 공개 증거, 분석 도구, 기존 보안 테스트의 재사용·미승인 artifact assertion이다. 제품 실행 코드 `src/`와 기존 실행 정책은 변경하지 않았다.

원본 Workspace main/dev, FE main, BE main 및 BE checksum 후보는 보존했다. 별도 그래프 출력 clone과 Worker 검사 worktree는 진단용이며 배포 후보가 아니다. 병합·원격 push·운영 배포를 수행하지 않았다. 커밋과 최종 상태는 이 브랜치의 Git 기록 및 `evidence/t7-h/final-state.json`에서 확인한다.

출시에는 626개 파일의 명시적인 사람 결정, B/C와 서명 정책 예외의 해소, 보안 권고 적용성·패치 결정, 잠금 정책, 승인 이후 strict/offline 정식 BE 검사, 미실행 통합 검사의 처리 결정이 남아 있다. 승인 준비 완료만으로 Workspace를 READY로 바꾸지 않는다.

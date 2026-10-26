# BE Dependency Exceptions — 미승인 상태

626개 모두 사람의 결정이 필요하다. 아래 항목은 추가 판단을 요구하며, 이 문서 자체가 예외 승인은 아니다. 전체 파일명·GAV·해시·범위·근거·결정 상태는 [CSV](BE_DEPENDENCY_INVENTORY.csv)에 있다.

| 예외 | 파일 수 | 미확인 사항 | 권장 조치와 사람의 결정 |
|---|---:|---|---|
| EX-IDENTITY | 345 | 서명 바이트는 유효하나 독립적인 발행자 신원과 해당 artifact 권한을 이 검토에서 연결하지 못함 | 공식 프로젝트 자료의 전체 fingerprint·프로젝트 범위 확인. UID나 키 서버 자료만으로 승인하지 않음 |
| EX-UNSIGNED | 2 | 서명 없는 Sonatype parent 7, Spring Boot plugin marker POM | 출처 고정과 독립적인 바이트 근거를 추가하거나, 정확한 SHA-256에 한정한 예외 여부 결정 |
| EX-WEAK-HASH | 39 | detached signature에 SHA-1 사용 | 강한 독립 근거 추가 또는 업그레이드 검토. SHA-256 파일 검증 성공과 구분해 예외 결정 |
| EX-EXPIRED-KEY | 22 | 현재 조회한 인증서의 유효기간이 지났음; 일부는 서명 시점도 유효기간 뒤 | 갱신·폐기·침해 이력 및 공식 발행자 설명 확인. 서명 당시 유효했다는 가정으로 자동 허용하지 않음 |
| EX-MISSING-KEY | 1 | `org.ow2:ow2:1.5.1` POM 서명 공개키 미확인 | 전체 fingerprint의 공식 발행자 근거와 공개키 확보 후 재검증 |
| EX-VULNERABILITY | 24 | 12 GAV에서 OSV 권고 22개 일치 | 실제 사용 조건, 발행자 권고와 수정 버전 호환성 검토; 변경 후보 재조사 또는 명시적인 위험 결정 |
| EX-PUBLISHER-COVERAGE | 6 | Tomcat 제품 수준 권고 후보 31개; embedded artifact별 적용성 미확정 | core/websocket/EL별 기능·설정 및 수정 범위 대조. OSV의 3개만으로 전체 대응 완료 판정 금지 |
| EX-VERSION-SELECTION | 90 | 33개 선택 GAV의 충돌 해결, 8개 모듈의 configuration 간 복수 버전 | 선택 사유·기능 호환성 검토 후 configuration별 lock. 서로 다른 classpath 버전을 임의로 통합하지 않음 |
| EX-MAINTENANCE | 2 | JUnit 4.13.2 JAR/POM의 공식 유지보수 모드 | 전이 경로 필요성과 제거·대체 가능성 판단 |

예외별 수는 중복된다. 신뢰 분류는 A 278 / B 287 / C 61 / D 0이며 합계 626개다. 약한 해시 39개와 만료 키 22개가 겹치는 파일이 있고, 공개키 미확인 1개까지 합친 C의 고유 파일 수는 61개다. B는 신원 공백 285개와 서명 부재 2개다. C에도 신원 공백이 남아 있다.

## 서명과 출처 특이 사항

미확인 OW2 서명의 선언 fingerprint는 `10F3C7A02ECA55E502BADCF3991EFB94DB91127D`다. 이것은 아직 검증된 발행자 fingerprint가 아니다. 키 서버 조회는 404였으며 파일 SHA-256은 고정된 후보와 일치했다. 서명을 검증하지 못한 것을 유효한 서명으로 세지 않았다.

서명 없는 두 파일은 다음과 같다.

- `org.sonatype.oss:oss-parent:7` / `oss-parent-7.pom`
- `org.springframework.boot:org.springframework.boot.gradle.plugin:4.1.0` / `org.springframework.boot.gradle.plugin-4.1.0.pom`

Plugin Portal marker의 SHA-256은 `5ef480aa5ef561b8a4d0e338fdd5a81fab8d14d42422581ad4ad403165b02d24`다. Maven Central의 같은 좌표 파일은 SHA-256 `c8ab823fd7e3ea54b34093a2467d8f092a61402b81a0e70999f6e62cbd5cad01`로 다른 파일이다. 서로 바꿔 승인하면 안 된다. [출처 차이 분석](evidence/t7-g/plugin-marker-origin-review.json)과 CSV의 정확한 URL을 따른다.

Testcontainers 12개 서명은 `PGP MESSAGE` armor 안에 압축된 detached signature다. 초기 형식 판별 이후 압축 내용을 제한된 크기로 해석해 바이트 검증에 성공했다. 이 12개는 SHA-1 서명으로 C이며, 형식 차이만으로 변조 실패 D로 판정하지 않았다.

## 보안 권고 해석

다음 표의 수정 버전은 저장된 OSV 범위와 공식 발행자 자료에서 검토할 **후보**다. 실제 BE 호환성, 전체 최신 권고 대응, 새로운 바이트의 신뢰 승인은 미완료다. 자동 업그레이드를 수행하지 않았다.

| GAV | 실제 범위 | 검토할 수정 버전 후보 | 권고 수 |
|---|---|---|---:|
| `com.fasterxml.jackson.core:jackson-core:2.21.4` | 런타임/테스트 | 2.21.7 | 2 |
| `com.fasterxml.jackson.core:jackson-databind:2.21.4` | 런타임/테스트 | 2.21.7 | 9 |
| `tools.jackson.core:jackson-core:3.1.4` | 빌드/런타임/테스트 | 3.1.7 | 2 |
| `tools.jackson.core:jackson-databind:3.1.4` | 빌드/런타임/테스트 | 3.1.7 | 7 |
| `org.apache.commons:commons-lang3:3.16.0` | 빌드 전용 | 3.18.0 이상을 포함하는 호환 후보 | 1 |
| `org.apache.httpcomponents.client5:httpclient5:5.6.1` | 빌드 전용 | 5.6.3 | 1 |
| `org.apache.httpcomponents.core5:httpcore5:5.4` | 빌드 전용 | 5.4.3 | 1 |
| `org.apache.httpcomponents.core5:httpcore5-h2:5.4` | 빌드 전용 | 5.4.3 | 1 |
| `org.apache.logging.log4j:log4j-api:2.25.4` | 런타임/테스트 | 2.25.5 | 1 |
| `org.apache.tomcat.embed:tomcat-embed-core:11.0.22` | 런타임/테스트 | 11.0.27 후보를 포함한 공식 추가 권고 재검토 | OSV 3 + 제품 권고 범위 별도 |
| `org.postgresql:postgresql:42.7.11` | 런타임/테스트 | 42.7.12 | 1 |
| `org.springframework:spring-webmvc:7.0.8` | 런타임/테스트 | 7.0.9 | 2 |

여러 GAV에 같은 권고가 걸리므로 표의 권고 수를 더한 값은 고유 권고 수가 아니다. 고유 OSV 권고는 22개다. Tomcat 공식 목록의 31개는 제품 수준 적용 후보이며 확정된 embedded BE 취약점 수와 합산하지 않는다. [OSV 원문](evidence/t7-h/osv-results.json)과 [Tomcat 보충 자료](evidence/t7-h/tomcat-publisher-supplement.json)를 함께 검토한다.

OSV 심각도와 발행자 심각도는 다를 수 있다. Spring의 공식 CVE-2026-47890은 LOW, CVE-2026-47884는 MEDIUM이다. 자동 응답의 CRITICAL 표시만으로 실제 BE 위험도를 확정하지 않았다. 반대로 소스 검색에서 특정 API 이름이 발견되지 않았다는 사실만으로 비적용을 승인하지도 않았다.

알려진 권고가 없다는 조회 결과는 신뢰 또는 안전 승인이 아니다. 유지보수 현황도 JUnit 4에서 확인한 사실을 넘어 모든 프로젝트의 지원 상태를 보증하지 않는다. 의존성 추가·변경 시 같은 검토와 보안 재조회가 필요하다.

## 실제 실패와 미실행 구분

실제 후보의 파일 SHA-256 불일치 0개, detached signature 바이트 검증 실패 0개다. OW2 1개는 공개키 미확인으로 검증을 완료하지 못했다. 서명 부재·키 만료·SHA-1·신원 공백은 별도 검토 사유이며 자동 승인하지 않는다. 합성 변조 파일은 검사기가 의도대로 `INVALID`를 반환했다.

정식 BE 준비·검사는 승인된 입력 집합과 정상 정책이 없어 BLOCKED다. 미승인 network-none 검토 실행의 266개 성공을 정식 BE PASS로 승격하지 않는다. 기존 테스트 237개는 Testcontainers 234, 실서비스 환경변수 조건 2, 평가 fixture 부재 1로 NOT_RUN이다. 이 미실행 항목과 보안 권고 조치가 남아 있어 Workspace Release는 NOT READY다.

## C 전체 43개 GAV

파일별 판정은 CSV를 따른다. 이 표의 조치는 모두 PENDING이다.

| GAV | 파일 | 추가 조사 사유 |
|---|---:|---|
| `biz.aQute.bnd:biz.aQute.bnd.annotation:7.1.0` | 2 | EX-WEAK-HASH |
| `com.google.protobuf:protobuf-bom:4.34.2` | 1 | EX-EXPIRED-KEY |
| `com.google.protobuf:protobuf-java:4.34.2` | 2 | EX-EXPIRED-KEY |
| `com.google.protobuf:protobuf-parent:4.34.2` | 1 | EX-EXPIRED-KEY |
| `com.querydsl:querydsl-bom:5.1.0` | 1 | EX-EXPIRED-KEY |
| `com.vaadin.external.google:android-json:0.0.20131108.vaadin1` | 2 | EX-WEAK-HASH |
| `io.netty:netty-bom:4.2.12.Final` | 1 | EX-WEAK-HASH |
| `io.netty:netty-bom:4.2.15.Final` | 1 | EX-WEAK-HASH |
| `io.prometheus:parent:0.16.0` | 1 | EX-EXPIRED-KEY |
| `io.prometheus:simpleclient_bom:0.16.0` | 1 | EX-EXPIRED-KEY |
| `io.rsocket:rsocket-bom:1.1.5` | 1 | EX-EXPIRED-KEY |
| `jakarta.inject:jakarta.inject-api:2.0.1` | 2 | EX-EXPIRED-KEY |
| `jakarta.platform:jakarta.jakartaee-bom:9.1.0` | 1 | EX-EXPIRED-KEY |
| `jakarta.platform:jakartaee-api-parent:9.1.0` | 1 | EX-EXPIRED-KEY |
| `org.antlr:antlr4-master:4.7.2` | 1 | EX-WEAK-HASH |
| `org.antlr:antlr4-runtime:4.7.2` | 2 | EX-WEAK-HASH |
| `org.eclipse.angus:angus-activation-project:2.0.3` | 1 | EX-EXPIRED-KEY |
| `org.eclipse.angus:angus-activation:2.0.3` | 2 | EX-EXPIRED-KEY |
| `org.eclipse.ee4j:project:1.0.6` | 1 | EX-WEAK-HASH |
| `org.eclipse.jetty.ee11:jetty-ee11-bom:12.1.10` | 1 | EX-WEAK-HASH |
| `org.eclipse.jetty.ee11:jetty-ee11-bom:12.1.7` | 1 | EX-WEAK-HASH |
| `org.eclipse.jetty:jetty-bom:12.1.10` | 1 | EX-WEAK-HASH |
| `org.eclipse.jetty:jetty-bom:12.1.7` | 1 | EX-WEAK-HASH |
| `org.hamcrest:hamcrest-core:3.0` | 2 | EX-EXPIRED-KEY |
| `org.hamcrest:hamcrest:3.0` | 2 | EX-EXPIRED-KEY |
| `org.jetbrains:annotations:13.0` | 1 | EX-EXPIRED-KEY, EX-WEAK-HASH |
| `org.jooq:jooq-bom:3.19.31` | 1 | EX-EXPIRED-KEY |
| `org.jooq:jooq-bom:3.21.5` | 1 | EX-EXPIRED-KEY |
| `org.objenesis:objenesis-parent:3.3` | 1 | EX-WEAK-HASH |
| `org.objenesis:objenesis:3.3` | 2 | EX-WEAK-HASH |
| `org.osgi:org.osgi.resource:1.0.0` | 2 | EX-WEAK-HASH |
| `org.osgi:org.osgi.service.serviceloader:1.0.0` | 2 | EX-WEAK-HASH |
| `org.ow2:ow2:1.5.1` | 1 | EX-MISSING-KEY |
| `org.slf4j:slf4j-api:1.7.36` | 2 | EX-WEAK-HASH |
| `org.slf4j:slf4j-parent:1.7.36` | 1 | EX-WEAK-HASH |
| `org.testcontainers:testcontainers-bom:2.0.4` | 1 | EX-WEAK-HASH |
| `org.testcontainers:testcontainers-bom:2.0.5` | 1 | EX-WEAK-HASH |
| `org.testcontainers:testcontainers-database-commons:2.0.5` | 2 | EX-WEAK-HASH |
| `org.testcontainers:testcontainers-jdbc:2.0.5` | 2 | EX-WEAK-HASH |
| `org.testcontainers:testcontainers-junit-jupiter:2.0.5` | 2 | EX-WEAK-HASH |
| `org.testcontainers:testcontainers-postgresql:2.0.5` | 2 | EX-WEAK-HASH |
| `org.testcontainers:testcontainers:2.0.5` | 2 | EX-WEAK-HASH |
| `org.webjars:swagger-ui:5.32.2` | 2 | EX-WEAK-HASH |

B의 전체 180개 GAV·287개 파일은 CSV에서 `trust_grade=B`로 확인할 수 있다. 전체 fingerprint별 담당 검토 묶음은 `evidence/t7-h/signer-review-index.csv`에 있으며, 묶음 확인만으로 해당 파일 전체를 승인하지 않는다.

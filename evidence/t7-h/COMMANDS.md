# T7-H 실제 실행 명령과 로그

2026-10-27 KST, macOS 26.6.2 arm64에서 실행했다. Gradle은 기존 Colima Linux aarch64 network-none 컨테이너에서 실행했다. Node는 `/Users/kjh/.local/share/fnm/node-versions/v22.23.2/installation/bin/node`를 사용했다. 필요한 도구 경로·해시는 기존 `data/t7-g/environment.json`의 테스트 전용 process environment로 주입했다. 비밀정보 값을 로그에 넣지 않았다.

| 실행 | 실제 호출과 설정 | 결과·로그 |
|---|---|---|
| 시작 상태 | `git status --short --branch`, `git rev-parse HEAD` | Workspace 기반 bccd755 clean, 새 검토 브랜치 생성 |
| 모든 artifact 해시 | Python `hashlib.sha256`, frozen inventory의 626개 실제 파일 읽기 | `baseline-integrity.json` |
| 서명 조회 | 각 frozen `artifact.url + '.asc'`에 HTTPS GET, redirect 수동·시간/크기 제한 | `signature-downloads.json`, `signatures/` |
| 공개키·공식 근거 | `key-sources.json`의 URL에 HTTPS GET, 최대 8 MiB | `key-sources.json`, `keys/` |
| 실제 그래프 | 기존 `reviewMacGradleMetadata(disposableClone)` | `graph-review-run.json`, `resolved-graph.json` |
| 검토 XML 대조 | Python ElementTree, DTD/entity 거부 후 GAV/파일/SHA 집합 비교 | `metadata-graph-comparison.json` |
| 정확한 버전 보안 조회 | `POST https://api.osv.dev/v1/querybatch`, `{package:{ecosystem:'Maven',name:'group:artifact'},version}` 387개; 권고별 `GET /v1/vulns/{id}` | `osv-results.json` |
| 공식 보안 근거 | 발행자 권고 URL HTTPS GET, Tomcat 11 공식 제품 범위 추가 대조 | `advisory-sources.json`, `tomcat-publisher-supplement.json` |
| 정식 gate | BE reviewOnly 정책으로 기존 `prepareMacGradle`, `runMacGradleCheck` 호출 | `formal-be-gate.json`: 두 경로 모두 BLOCKED |
| BE 진단 | 기존 `reviewMacGradleMetadata('/Users/kjh/Momentory/momentory-be-t7-g', undefined, {phase:'check'})` | `be-check-UNAPPROVED.json`, `be-test-summary.UNAPPROVED.json` |
| Colima·Docker 상태 | `colima status --json`, `colima list --json`, pinned Docker `info --format` | `colima-status.json`, `colima-profiles.json`, `docker-security.json` |

실제 graph 출력 clone은 `data/t7-h/be-graph-review`, 자체 진단 커밋은 `748f89d36ce998a32cc865e164153746ffddcb85`다. BE 후보 b2be605에서 `git clone --no-hardlinks`로 만들었고, `build.gradle.kts`에 `scripts/t7-h/graph-review.gradle.kts`와 필요한 Java import alias만 추가했다. 기존 빌드 입력 해시에 맞춘 별도 `reviewOnly:true` 정책을 사용했다. 그래프 JSON은 gzip/base64 marker로 stdout에 출력한 뒤 호스트에서 해제했다. BE 후보는 수정하지 않았다.

컨테이너에서 graph 검토는 `dependencies --configuration testRuntimeClasspath --write-verification-metadata sha256`, BE 진단은 `clean check --write-verification-metadata sha256`이다. 기존 runner가 두 호출에 `--offline --no-daemon --no-configuration-cache --no-build-cache --no-watch-fs --max-workers=2 --dependency-verification strict`와 고정된 init script를 추가한다. 이 **reviewOnly 메타데이터 작성 모드**는 미승인 바이트 관찰이며 정식 strict 검증 통과가 아니다. 정식 prepare/check는 별도로 reviewOnly 정책을 거부한다.

## 서명 바이트 분석

Temurin의 호스트 JDK로 자체 분석기만 실행했다. BE artifact는 서명 검증을 위한 데이터로만 읽었다. host Gradle 또는 BE JAR을 실행하지 않았다. 암호 라이브러리는 기존 고정된 Gradle 9.1.0 배포본의 Bouncy Castle 1.81을 재사용했다.

```sh
/Users/kjh/.local/share/momentory-t7-mac-followup/tools/jdk-21.0.13+9/Contents/Home/bin/javac \
  -cp '/Users/kjh/.local/share/momentory-t7-mac-followup/tools/gradle-9.1.0/lib/plugins/*' \
  -d data/t7-h scripts/t7-h/VerifySignatures.java
/Users/kjh/.local/share/momentory-t7-mac-followup/tools/jdk-21.0.13+9/Contents/Home/bin/java \
  -cp 'data/t7-h:/Users/kjh/.local/share/momentory-t7-mac-followup/tools/gradle-9.1.0/lib/plugins/*' \
  VerifySignatures data/t7-h/keys data/t7-h/signature-inputs.tsv \
  > data/t7-h/signature-verification.ndjson
```

TSV의 각 행은 `repository_path<TAB>실제_quarantine_file<TAB>signature_file`이다. `signature-downloads.json`의 signatureFile이 있는 624개 항목으로 만들었다. 서명 없는 2개는 CSV에 별도로 포함했다. 위 Java 명령의 TSV를 `signature-control-inputs.tsv`로 바꿔 원본 Spring Core JAR과 말미에 합성 변조 바이트를 추가한 복사본을 검사했다. 결과는 각각 VALID / INVALID다. 복사본은 `data/`에만 만들었고 quarantine 원본은 변경하지 않았다.

```sh
python3 scripts/t7-h/review-dependencies.py \
  --repository /Users/kjh/.local/share/momentory-t7-g/quarantine/maven
```

전체 CSV, `trust-summary.json`, `model-selector-observations.json`을 재현한다. 공식 발행자 범위 규칙은 이 스크립트의 `identity()`에 명시되어 있으며 어떤 결과도 APPROVED로 만들지 않는다. 재조회를 원하면 아래처럼 **새로운** data 디렉터리를 지정한다. 과거 기준과 다른 바이트를 자동 수용하지 않는다.

```sh
node scripts/t7-h/collect-public-evidence.mjs data/t7-h-public-recheck
```

## 자동·보안 회귀

```sh
# 위에 명시한 pinned Node와 기존 테스트용 도구 핀을 process environment로 사용
RUN_PROVIDER_INTEGRATION=1 RUN_MAC_DEPENDENCY_INTEGRATION=1 \
RUN_MAC_MOUNT_INTEGRATION=1 RUN_MAC_GRADLE_INTEGRATION=1 \
WORKSPACE_TEST_GRADLE_WORKTREE="$PWD/data/t7-g/container-fixture" \
node --test tests/*.test.mjs
```

실제 Node `spawn`에는 glob을 정렬해 펼친 파일 목록을 전달했다. 결과는 39개 중 38 PASS / 0 FAIL / 1 NOT_RUN이다. 로그는 `automated-tests.log`, 종료 코드는 `automated-tests-result.json`에 있다. 같은 suite 안의 Gradle fixture는 JUnit 5개, Gradle Worker API, IPv4/IPv6 TCP/UDP 외부·호스트 loopback 차단, 파일 경계, read-only 입력, source byte 제한, 메타데이터·artifact·marker·출처 변조 거부, 미승인 artifact 추가, cache 오염 거부, 취소·timeout·새 실행 복구를 검사했다.

미승인 artifact 추가를 `runMacGradleCheck` 진입점에서도 직접 거부하는 assertion을 보강한 뒤 같은 Mac 플래그로 `node --test tests/mac-dependency.test.mjs`를 재실행했다. 결과는 10 PASS / 0 FAIL / 1 NOT_RUN이며 `mac-dependency-final.log`, `mac-dependency-final-result.json`에 있다. 39개 suite의 일부를 재실행한 것이므로 합산하지 않는다.

다음 기존 통합 모듈을 순서대로 각각 `node tests/<name>.integration.mjs`로 실행했다. 종료 코드가 모두 0이며 `integration-results.json`과 각 `integration-<name>.log`에 기록했다.

- `codex-boundary`, `provider-boundary`, `codex-cancel`, `local`, `recovery`
- `diff-reviewability`, `approved-inheritance`, `sandbox-check`, `pause`, `wsl-orphan`

Worker 강제 종료는 기존 `data/t7-g/worker-environment.json`의 통제 fixture 설정과 `WORKSPACE_TEST_GRADLE_CRASH=1`로 실행했다.

```sh
node tests/worker-kill.integration.mjs
node tests/resume-killed.integration.mjs \
  /Users/kjh/Momentory/momentory-ai-workspace-t7-followup/data/worker-kill-e3e04b01-5610-4551-9555-094c7fa24f6c.sqlite
```

`worker-gradle-kill.log`에 Worker SIGKILL 전 JVM/sh/sleep, 종료 직후 살아 있는 컨테이너, 재시작 후 guest namespace 정리가 기록되어 있다. `worker-gradle-resume-retry.log`에는 같은 worktree, reviewed diff, attempt 2, AWAITING_APPROVAL 결과가 있다. 첫 resume 호출은 위 DB 인자 없이 실행돼 시작 단계에서 종료 코드 1이었다. 해당 원문 `worker-gradle-resume.log`와 호출 결과도 보존했다. 올바른 인자를 준 재실행의 종료 코드는 0이다.

## 증거 해석의 한계

실제 기능 경계에 대한 PASS는 위 실행에서 관찰한 범위다. 공개 서명·키·발행자 문서는 조회 시점의 증거이며 미래의 키 갱신·폐기나 새 취약점을 보증하지 않는다. 원본 공개 HTML 전체 대신 URL·조회 결과·SHA-256과 필요한 구조화된 사실을 보존했다. `key-sources.json`의 HTTP 404에는 최초 Tomcat KEYS 경로, Boot SECURITY 파일, 잘못 추정한 Gradle 소스 문서 경로, 미확인 OW2 공개키 조회가 포함된다. Tomcat 공식 키와 Gradle 9.1 공식 문서는 정상 대체 경로에서 확보했고 OW2 공개키는 여전히 미확인이다.

정식 BE 검사, 미승인 의존성 승인, FE/BE main 변경, Workspace main/dev 병합, 원격 push 및 운영 배포는 수행하지 않았다.

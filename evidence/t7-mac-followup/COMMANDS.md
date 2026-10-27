# 실행 명령과 재현 조건

Workspace 작업 위치: `/Users/kjh/Momentory/momentory-ai-workspace-t7-followup` (`2eeff69` 기반). 실제 Mac에서 기존 함수와 테스트를 호출했다. 독립된 새 하네스나 AI 엔진은 추가하지 않았다.

## Git / 환경

```sh
git -C /Users/kjh/Momentory/momentory-fe fetch origin main
git -C /Users/kjh/Momentory/momentory-fe rev-parse FETCH_HEAD
git -C /Users/kjh/Momentory/momentory-fe worktree add -b workspace/t7-mac-latest-main /Users/kjh/Momentory/momentory-fe-t7-mac-main e6f88ce528a0bdb270aee9b152bb47090f226ca5
sw_vers
uname -m
/usr/bin/python3 --version
```

FE 원본의 HEAD/미커밋 patch·untracked 파일 해시는 `fe-current-snapshot.json`에 있다. 최신 main 검증 사본에 원본의 미커밋 코드를 합치지 않았다. 최종 FE 후보는 `711f4e3`이고, 캐시 관련 5개 파일만 main과 다르다.

일반 실행에서도 최신 main을 읽도록 현재 Workspace와 후속 worktree의 ignored `.env`에 FE/BE 경로와 검증된 runtime pin을 저장했다. `.env`가 없을 때는 기존 `node scripts/setup.mjs`로 생성했고, 비밀 값은 출력하거나 증거에 복사하지 않았다. 각 checkout에서 외부 WORKSPACE_* override를 제거한 프로세스로 `settings(); repository('momentory','fe'); repoStatus('momentory','fe')`를 호출해 확인했다. `frontend-main-binding.json`에 결과가 있다.

```sh
git -C /Users/kjh/Momentory/momentory-fe-t7-mac-main merge-base --is-ancestor origin/main HEAD
git -C /Users/kjh/Momentory/momentory-fe-t7-mac-main diff --name-only origin/main HEAD -- app src expo-lab
```

두 번째 명령의 결과는 비어 있다. 최신 main 제품 코드를 유지하고 Lab 실행 설정만 후보 브랜치에서 수정했다.

Node는 `/Users/kjh/.local/share/fnm/node-versions/v22.23.2/installation/bin/node`를 사용했다. 아래 공통 환경 로딩은 실제 실행에 사용한 패턴이다. `environment.json`에는 경로·SHA-256만 있으며 계정 정보는 없다. 원본 로그/환경은 `data/t7-followup/`에 있다.

```sh
/Users/kjh/.local/share/fnm/node-versions/v22.23.2/installation/bin/node --input-type=module <<'JS'
import fs from 'node:fs';
Object.assign(process.env, JSON.parse(fs.readFileSync('data/t7-followup/environment.json')));
await import('./tests/codex-boundary.integration.mjs');
JS
```

다른 checkout/호스트에서는 자신의 canonical 경로와 해시를 검토하고 별도 CODEX_HOME에 기존 `installCodexProfiles()`를 실행해야 한다. 실행 파일 pin이나 설치 marker를 로그에서 복사해 승인으로 사용하지 않는다.

## 기존 자동 / integration 테스트

전체 suite는 공통 환경에서 `RUN_PROVIDER_INTEGRATION=1`, `RUN_MAC_DEPENDENCY_INTEGRATION=1`, `RUN_MAC_MOUNT_INTEGRATION=1`을 설정하고 아래 package script와 같은 명령을 실행했다:

```sh
node --test tests/*.test.mjs
```

실제로는 glob을 JS의 `fs.readdirSync('tests').filter(f=>f.endsWith('.test.mjs'))`로 확장해 pinned Node의 `spawnSync` 인자로 전달했다. timeout은 300000ms, stdout/stderr는 `final-unit.txt`에 저장했다.

아래 모듈은 공통 환경을 상속한 pinned Node로 각각 직접 실행했다. 각 timeout은 240000ms, 결과는 `integration-summary.txt`와 개별 `regression-*.txt`에 있다.

```sh
node tests/codex-boundary.integration.mjs
node tests/provider-boundary.integration.mjs
node tests/codex-cancel.integration.mjs
node tests/local.integration.mjs
node tests/recovery.integration.mjs
node tests/diff-reviewability.integration.mjs
node tests/approved-inheritance.integration.mjs
node tests/sandbox-check.integration.mjs
node tests/pause.integration.mjs
node tests/wsl-orphan.integration.mjs
node tests/worker-kill.integration.mjs
node tests/resume-killed.integration.mjs <worker-kill가-출력한-data/worker-kill-UUID.sqlite>
node tests/design-lab-boundary.integration.mjs
```

`wsl-orphan.integration.mjs`와 `worker-kill.integration.mjs`의 기존 Windows 경로를 보존하고 Mac 분기를 추가했다. Mac Worker에는 **SIGKILL을 Worker PID 하나에만** 보내 자식 잔존을 확인한 뒤 실제 재시작으로 정리했다. 마지막 두 단계의 전체 기록은 `worker-crash-and-resume.txt`에 있다. `design-schema-parity.integration.mjs`는 해당 FE 구조 필드가 있을 때만 실행할 수 있으며, 선행조건/분류는 `final-design-boundaries.txt`에 기록했다.

표적 추가 실행:

```sh
node --test tests/core.test.mjs
RUN_MAC_DEPENDENCY_INTEGRATION=1 RUN_MAC_MOUNT_INTEGRATION=1 node --test tests/mac-dependency.test.mjs
```

## 실제 마운트

기존 `mac-dependency.test.mjs` opt-in이 다음 명령을 자체 임시 fixture 디렉터리에 수행하고 `finally`에서 detach한다:

```sh
/usr/bin/hdiutil create -size 16m -fs HFS+ -volname WorkspaceBoundary <fixture>/boundary.dmg
/usr/bin/hdiutil attach -nobrowse -mountpoint <fixture>/node_modules <fixture>/boundary.dmg
/usr/bin/hdiutil detach <fixture>/node_modules
```

host/mount의 `stat.dev`가 다름을 확인하고 `dependencyLinksSafe`, `validateMacWorktree`, `prepareMacDependency`의 거부를 assert했다. 별도의 link-only project에는 이 mounted volume을 가리키는 symlink만 두어 링크 검사를 독립 검증했다. 운영 볼륨을 detach하지 않았다.

추가로 실제 잠긴 sandbox 안에서 mount broker를 호출했다. host에서 테스트 소유 HFS+ 이미지에 합성 canary 하나를 기록한 뒤 detach했다. project 밖의 해당 이미지를 읽고 project 내부 `mounted/`로 attach하려는 명령을 실행했다:

```sh
<pinned-codex> sandbox -p ai-dev-workspace-posix -P workspace-locked -C <runtime-mount-project> -- /bin/sh -c '<outside image read; hdiutil attach; canary read only if attach succeeds>'
```

정확한 argv와 stdout/stderr는 `runtime-mount-attack.txt`에 있다. 이미지 읽기 실패, attach exit 1, canary 미노출, 다른 device가 마운트되지 않았음을 assert했다. 30초 timeout과 소유 mount만 정리하는 finally를 사용했다.

## FE / Lab

최신 main에서 `repository('momentory','fe').setup`의 두 단계에 `prepareMacDependency()`를 호출했다. 실제 명령은 pinned Node/npm으로 실행되는 `npm ci --ignore-scripts --no-audit --no-fund`, Design Lab은 추가로 `--prefix design-lab`이다. root deny setup profile과 per-run private npm config/cache를 유지했다. FE 후보의 script manifest를 변경한 후에는 해당 Design Lab marker와 생성 dependency tree만 폐기하고 fresh locked install했다.

`verifyTask({project_id:'momentory',repo:'fe'}, FE)`와 `runCommand(FE, 'npm', args, 180000, undefined, {isolate:true})`로 아래 명령을 실행했다:

```sh
npm run typecheck
npm run lint
npm run test -- --ci --runInBand
npm run typecheck:lab
npm run typecheck:expo-lab
npm run build --prefix design-lab
npm run build --prefix design-lab
```

`fe-final-checks.txt`, `lab-final-checks.txt`에 전체 결과가 있다. 반복 build의 목적은 기존 output 디렉터리가 있어도 정상 동작하는지 확인하는 것이다.

Studio는 공통 환경에 다음 두 값을 추가하고 **기존** `tests/design.capture.mjs`를 실행했다:

```js
process.env.WORKSPACE_LAB_URL='http://localhost:18085';
process.env.WORKSPACE_PLAYWRIGHT_PACKAGE_JSON='/Users/kjh/CAPSTONE/CAPSTONE-SAI/package.json';
await import('./tests/design.capture.mjs');
```

기존 Playwright 1.63.0/Chromium을 재사용했다. FE의 Windows PNG를 Mac PASS로 사용하거나 baseline을 자동 갱신하지 않았다. 최종 source SHA, viewport별 파일과 hash는 `final-design-capture.txt`에 있다.

독립 Design Lab은 아래 argv를 pinned Codex에 전달해 `posix-lab` 안에서 실행하고 Playwright로 실제 페이지와 390px screenshot을 확인했다. browser error 0, 내용 존재, overflow 0을 assert한 뒤 제어된 프로세스를 정리했다.

```sh
<pinned-codex> sandbox -p ai-dev-workspace-posix-lab -P workspace-lab -C <FE> -- <pinned-node> <pinned-npm-cli> run dev --prefix design-lab -- --host 127.0.0.1 --port 14173 --strictPort
```

출력 링크 공격: generated `design-lab/dist` 안에 같은 project의 별도 canary 디렉터리로 향하는 symlink를 넣고 `npm run build --prefix design-lab`를 호출했다. build 거부·canary 보존을 assert하고 alias를 제거한 뒤 같은 명령의 정상 복구를 확인했다 (`lab-output-link-attack.txt`).

## Gradle 자료 / 차단

`tool-provenance.json`의 공식 Adoptium metadata와 Gradle 9.1.0 checksum URL을 조회했다. JDK/Gradle archive 다운로드 redirect는 검토된 공식 서비스/GitHub release host로 제한하고 SHA-256을 확인한 뒤 저장소 밖 private tools 디렉터리에 풀었다. 설치 tree와 실제 실행 파일도 pin했다. 시스템 JDK 등록이나 운영 프로젝트 수정은 하지 않았다.

```sh
<private-jdk>/bin/java -version
/usr/bin/codesign --verify --strict --verbose=2 <private-jdk>/bin/java
shasum -a 256 /Users/kjh/Momentory/momentory-be/gradle/wrapper/gradle-wrapper.jar
```

Maven 자료는 `maven-provenance.json`의 공식 Central URL과 publisher `.sha256`를 대조했다. Gradle fixture 정책의 artifact 목록은 annotations 26.0.2의 고정 JAR/POM 2개이며 실제 BE 의존성 전체를 승인한 목록이 아니다.

공통 환경에서 다음 기존 준비 진입점 / 새 자료 검증 helper를 호출했다:

```js
const {verifyMacGradleMaterials,runMacGradleCheck}=await import('./src/macGradle.mjs');
await verifyMacGradleMaterials(gradleFixture);
await prepareMacDependency(gradleFixture, {
  ifMissing:'.gradle/workspace-home',
  command:['./gradlew','dependencies','--configuration','testRuntimeClasspath','--no-daemon']
});
```

실제 runtime argv는 `codex sandbox -p ai-dev-workspace-posix-gradle -P workspace-gradle -C <fixture> -- <verified-gradle>/bin/gradle dependencies --configuration testRuntimeClasspath --offline --no-daemon --max-workers=2 -Dorg.gradle.jvmargs= --init-script <fixture>/.gradle/workspace-repositories.init.gradle`이다. **network=false**를 유지해 socket 단계에서 차단됐다 (`gradle-final-block.txt`).

`gradle-material-security.txt`는 정책 SHA 대체, JAR 대체, user-home init script 주입, 미승인 HTTPS origin을 각각 넣고 검증 실패를 assert한 기록이다. 각 원본 bytes와 환경값을 `finally`에서 복구했다. dependency marker 없는 `runMacGradleCheck`도 거부했다. 실제 BE에는 별도 입력 inventory를 대조했지만 Wrapper properties의 checksum 조건에서 중단했다 (`be-gradle-current-block.txt`).

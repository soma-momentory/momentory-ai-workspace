# T7-Mac 실행 명령

실행 위치: `/Users/kjh/Momentory/momentory-ai-workspace-t7-mac`, 브랜치 `workspace/t7-macos-validation`, 시작 커밋 `10d835a`. 아래는 별도 하네스 없이 기존 테스트와 함수에 사용한 진입점이다. 로그와 개별 명령은 `results.json` 및 각 `.txt`에 보존한다. `environment.json`은 경로·해시만 포함하며 로그인 정보는 없다. 다른 Mac에서는 자신의 canonical 설치 경로·해시·프로필 위치로 갱신해야 한다.

## 환경

```sh
sw_vers
uname -m
command -v node npm codex claude
node --version
npm --version
codex --version
claude --version
git status --short --branch
git rev-parse HEAD
git branch -a
git worktree list
git worktree add -b workspace/t7-macos-validation /Users/kjh/Momentory/momentory-ai-workspace-t7-mac 10d835a
```

검증 프로세스에는 `environment.json`의 Node 22.23.2, native Codex, npm CLI, Claude 경로 및 SHA-256을 전달했다. 전용 CODEX_HOME을 사용해 `installCodexProfiles()`를 호출했다. 기존 로그인은 저장소 밖에서 참조했다. 테스트용 sample Git 저장소는 기존 `examples/sample-template` 파일로 만들었고, 다른 프로젝트 경계에는 전용 CODEX_HOME의 형제 디렉터리에 만든 두 번째 합성 Git 저장소를 사용했다. Playwright는 이미 설치된 `/Users/kjh/CAPSTONE/CAPSTONE-SAI/node_modules/playwright`를 읽기만 했다.

## 기존 테스트 실행

실제 실행된 공통 패턴:

```sh
/Users/kjh/.local/share/fnm/node-versions/v22.23.2/installation/bin/node --input-type=module <<'JS'
import fs from 'node:fs';
Object.assign(process.env, JSON.parse(fs.readFileSync('data/t7-mac-evidence/environment.json')));
await import('./tests/local.integration.mjs');
JS
```

같은 패턴으로 다음 기존 모듈을 각각 실행했다. stdout/stderr를 표의 로그로 redirect했다.

| 모듈 | 로그 |
| --- | --- |
| `tests/codex-boundary.integration.mjs` | `codex-boundary-final.txt` |
| `tests/provider-boundary.integration.mjs` | `claude-boundary-final.txt` |
| `tests/codex-cancel.integration.mjs` | `codex-cancel.txt` |
| `tests/local.integration.mjs` | `local-integration-final.txt` |
| `tests/collaboration.integration.mjs` | `collaboration.txt` |
| `tests/pause.integration.mjs` | `pause.txt` |

설치 전용 테스트는 같은 환경에서 `process.env.RUN_MAC_DEPENDENCY_INTEGRATION='1'`을 설정한 뒤 `await import('./tests/mac-dependency.test.mjs')`로 실행했다. 실제 설치 명령은 `npm ci --ignore-scripts --no-audit --no-fund`이며 고정 native Codex의 `sandbox -p ai-dev-workspace-posix-setup -P workspace-setup -C <fixture> -- <pinned-node> <pinned-npm-cli> ...` 안에서 실행됐다.

최종 전체 테스트(`npm test`의 package script와 동일한 명령):

```sh
/Users/kjh/.local/share/fnm/node-versions/v22.23.2/installation/bin/node --input-type=module <<'JS'
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
Object.assign(process.env, JSON.parse(fs.readFileSync('data/t7-mac-evidence/environment.json')), {
  RUN_MAC_DEPENDENCY_INTEGRATION:'1', RUN_PROVIDER_INTEGRATION:'1'
});
const files=fs.readdirSync('tests').filter(f=>f.endsWith('.test.mjs')).map(f=>'tests/'+f);
const r=spawnSync(process.execPath,['--test',...files],{env:process.env,encoding:'utf8',timeout:240000});
process.stdout.write(r.stdout||''); process.stderr.write(r.stderr||''); process.exitCode=r.status??1;
JS
```

`regression-integration.txt`에는 위 환경에서 아래 각 명령을 `spawnSync(process.execPath, [...], {timeout:120000})`로 실행한 stdout/stderr와 exit code를 기록했다:

```sh
node tests/approved-inheritance.integration.mjs
node tests/diff-reviewability.integration.mjs
node tests/recovery.integration.mjs
node tests/sandbox-check.integration.mjs
```

마지막 process-table 형식 guard 이후 표적 재검증: `/Users/kjh/.local/share/fnm/node-versions/v22.23.2/installation/bin/node --test tests/core.test.mjs` → `core-final.txt` (19 PASS / 0 FAIL).

## 직접 함수 / sandbox 검사

이 절의 Node 함수는 공통 패턴처럼 `environment.json`을 먼저 로드하고 실행했다. 전용 경계 파일만 생성·제거했다.

```js
const {trustedMacRuntime}=await import('./src/macTrust.mjs');
const {verifyMacSetupBoundary,prepareMacDependency}=await import('./src/macDependency.mjs');
await verifyMacSetupBoundary(fixture, trustedMacRuntime(fixture));
```

`command-boundary.txt`는 고정 Codex binary에 다음 실제 인자를 전달한 기록이다. 정확한 경로·해석된 IP와 exit code도 로그에 있다. Git 전역 설정 읽기 실패에만 의존하지 않도록 global/system 설정을 비우고 실제 `.git/index.lock` 쓰기 거부를 확인했다. curl은 호스트에서 registry IP를 해석해 `--resolve`로 전달하므로 DNS 차단만 검사한 결과가 아니다.

```sh
<pinned-codex> sandbox -p ai-dev-workspace-posix -P workspace-locked -C <sample> -- /usr/bin/env GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null /usr/bin/git -c 'user.name=Workspace Test' -c user.email=workspace@example.invalid commit --allow-empty -m must-be-denied
<pinned-codex> sandbox -p ai-dev-workspace-posix -P workspace-locked -C <sample> -- /usr/bin/curl --resolve registry.npmjs.org:443:<resolved-ip> --connect-timeout 5 --max-time 5 --silent --show-error --head https://registry.npmjs.org/is-number
```

`profile-integrity.txt`: `verifyCodexProfile('posix-setup')` 성공 후 검증 전용 profile에 주석을 추가하고 같은 함수가 `/missing or changed/`로 실패함을 확인했다. `finally`에서 원래 bytes를 복구하고 재검증했다. 사용자 프로필은 대상이 아니다.

`gradle-blocked.txt`:

```js
const {repository}=await import('./src/projects.mjs');
const repo=repository('momentory','be');
await prepareMacDependency(repo.path, repo.setup[0]); // expected rejection; BLOCKED
```

`claude-lifecycle.txt`의 실제 `runProvider` 인자:

- 취소: provider `claude`, cwd sample, prompt `Read index.mjs carefully and explain every behavior in detail. Do not modify files.`, timeout 120000ms. `session` 이벤트에서 AbortController 중단.
- startup timeout: provider `claude`, cwd sample, prompt `Reply OK.`, timeout 1ms.
- 복구: `probeProvider('claude', sample)`.

`invalid-session-recovery.txt`: 각 provider `codex`, `claude`에 대해 `runProvider({provider,cwd:sample,prompt:'Reply OK.',sessionId:randomUUID(),readOnly:true,timeoutMs:30000})` 후 `probeProvider(provider,sample)`를 실행했다.

```sh
/usr/bin/codesign --verify --strict --verbose=2 <canonical-node>
/usr/bin/codesign --verify --strict --verbose=2 <canonical-native-codex>
/usr/bin/codesign --verify --strict --verbose=2 <canonical-claude>
/usr/libexec/java_home -V
git diff --check
```

`lock-provenance.json`은 Node `fetch`로 공식 metadata URL과 tarball URL을 읽고, `createHash('sha512')`의 base64 SRI를 metadata 및 고정 fixture 값과 비교한 기록이다. tarball을 실행하지 않았다.

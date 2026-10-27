# T7-G commands and conditions

All commands ran on macOS 26.6.2 arm64, 2026-10-26~27 KST. Workspace cwd: `/Users/kjh/Momentory/momentory-ai-workspace-t7-followup`, clean initial HEAD `5372d41`, implementation branch `workspace/t7-g-secure-gradle`. Existing scripts/engine/functions were reused.

## Initial inspection and isolated BE candidate

```sh
git status --short --branch
git rev-parse HEAD
git worktree list
sw_vers
uname -m
colima status --json
docker version --format '{{json .}}'
docker image ls --digests --format '{{json .}}'
git -C /Users/kjh/Momentory/momentory-be worktree add -b workspace/t7-g-gradle-checksums /Users/kjh/Momentory/momentory-be-t7-g ca3bc87f9d679ea6edd37fffa5e5390e307952b8
```

Official checksum URLs were fetched over HTTPS, compared with actual bytes and recorded in `be-wrapper-review.json`. Only the candidate Wrapper properties were changed and committed as `b2be605`.

## Native IPC investigation (rejected option A)

The installed pinned Codex 0.163.0 sandbox was invoked using an isolated experimental CODEX_HOME and the recorded profile. It had root-deny filesystem access, managed network proxy enabled, no allowed external domains, and local binding enabled. No full-network profile was used. Node probes tested raw IPv4/IPv6 TCP/UDP and a synthetic unrelated HTTP server on the host loopback. Exact argv/output are in `native-ipc-probe.txt`, `native-unrelated-loopback.txt` and the native fixture logs.

```sh
xcrun clang -Wall -Wextra -Werror tests/fixtures/mac-gradle-ipc.c -o data/t7-g/ipc-probe/syscalls
<pinned-codex> sandbox -p ai-dev-workspace-posix-gradle -P workspace-gradle -C <ipc-probe> -- <ipc-probe>/syscalls
<pinned-codex> sandbox -p ai-dev-workspace-t7-g-probe -P gradle-ipc -C <ipc-probe> -- <ipc-probe>/syscalls
```

The first run used the unchanged audited network=false profile. `native-syscalls.json` separates socket/bind/listen/send/receive. Experimental profiles were removed after investigation; `rejected-profile-cleanup.json` records the hash. The native fixture initially hit Java daemon dual-stack listening restrictions, then a protected project-cache rename. Passing `JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true` to descendants and using private temporary Gradle/project/build directories allowed that fixture, but the unrelated host service attack still excluded A from production use.

## Verified runtime materials

Linux Temurin archive, its official checksum and GitHub release digest were compared before extraction. Canonical internal legal links were materialized as identical ordinary files and the resulting tree was pinned. `linux-jdk-provenance.json` and `linux-jdk-normalized-links.json` contain the records. Host Mac JDK and Gradle pins were retained.

```sh
docker manifest inspect --verbose ubuntu:24.04
docker pull --platform linux/arm64 ubuntu@sha256:18b33ff3829707f31ada654a963b9ee35f2e6f0241b964bd17a22a9b330cb63d
docker image inspect ubuntu@sha256:18b33ff3829707f31ada654a963b9ee35f2e6f0241b964bd17a22a9b330cb63d
```

Subsequent execution uses a canonical private copy of the installed Docker binary with the same SHA, explicit local `--host unix://...` and empty private `--config`. It uses `--pull=never`. The normal engine calls `prepareMacDependency()` and `runCommand(...,{isolate:true})`; no host `gradlew` is executed.

## Existing tests and engine entry points

Pinned Node: `/Users/kjh/.local/share/fnm/node-versions/v22.23.2/installation/bin/node`. Runtime pin JSON was loaded into each fresh process with `Object.assign(process.env, JSON.parse(fs.readFileSync('data/t7-g/environment.json')))`. That file contains paths/hashes, no account tokens. Its policy is **fixture-only**, not BE approval.

```js
const setup = {ifMissing:'.gradle/workspace-home',command:['./gradlew','dependencies','--configuration','testRuntimeClasspath','--no-daemon']};
await prepareMacDependency(FIXTURE, setup);
await runCommand(FIXTURE, './gradlew', ['clean','check'], 180000, undefined, {isolate:true});
```

```sh
RUN_PROVIDER_INTEGRATION=1 RUN_MAC_DEPENDENCY_INTEGRATION=1 RUN_MAC_MOUNT_INTEGRATION=1 RUN_MAC_GRADLE_INTEGRATION=1 WORKSPACE_TEST_GRADLE_WORKTREE=<reviewed-fixture> node --test tests/*.test.mjs
RUN_MAC_DEPENDENCY_INTEGRATION=1 RUN_MAC_MOUNT_INTEGRATION=1 RUN_MAC_GRADLE_INTEGRATION=1 WORKSPACE_TEST_GRADLE_WORKTREE=<reviewed-fixture> node --test tests/mac-dependency.test.mjs
```

The actual runner expanded the test glob with `fs.readdirSync()` and used `spawnSync(pinnedNode, ['--test', ...files], ...)`, 300000ms overall timeout. The focused regression has 240000ms runner timeout. Its fixture clone uses the reviewed immutable artifact inventory and tests the five Java cases, actual Worker API, hostile build script, metadata/JAR/marker/origin/cache rejection, wrong-container ownership, cancellation of a live Gradle child, timeout and successful fresh recovery. It verifies an active host service as a positive control. It restores changed artifact bytes and removes only its owned fixtures/containers.

Existing integration modules ran sequentially with 240000ms timeout each:

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
```

`integration-summary.json` and individual `regression-*.txt` files record every exit.

For the actual Worker crash, the existing sample project config was supplied from a private test projects JSON, with the same fixture declared as stack=spring, the existing Gradle setup and `./gradlew test` check. Only its controlled `crash-mode` input was added to the fixture Git repository. The test uses real Codex and the real Worker/API.

```sh
WORKSPACE_TEST_GRADLE_CRASH=1 node tests/worker-kill.integration.mjs
WORKSPACE_TEST_GRADLE_CRASH=1 node tests/resume-killed.integration.mjs <printed-data/worker-kill-UUID.sqlite>
```

It waits for real Java/sh/sleep descendants, kills only the Worker PID with SIGKILL, confirms the container remains alive, restarts the Worker, confirms removal, rejects resume without a reviewed hash, then resumes the same worktree. Existing engine preapproval/result controls remain in effect. The recovery test removes its controlled crash marker before reviewing the resulting partial diff.

## Actual BE review, not dependency approval

After the normal fixture passed, 756 existing cache files were copied into a separate unapproved read-only Maven-shaped repository. No conflicting bytes for the same path were found. Source input hashes bind the actual BE checksum candidate. A separately pinned policy with `reviewOnly=true` permits only isolated discovery; normal setup/check functions reject it.

```js
await reviewMacGradleMetadata('/Users/kjh/Momentory/momentory-be-t7-g');
await reviewMacGradleMetadata('/Users/kjh/Momentory/momentory-be-t7-g', undefined, {phase:'check'});
```

Internally these use only `dependencies --configuration testRuntimeClasspath` or `clean check`, with `--write-verification-metadata sha256`, offline, no configuration/build cache and the same network-none boundary. The unapproved metadata and test suite headers are returned from the private container before cleanup; logs are bounded to 2MB and masked by the existing redactor. Generation does not confer trust. Results always remain `PENDING_REVIEW`, with `approvalIssued=false`, even when the diagnostic process exits 0. No marker is written and no XML is applied to the BE candidate.

The 626 used artifacts were compared against official checksum endpoints. Files lacking strong sidecars were compared against current HTTPS origin bytes. A POM difference was investigated at both official origins; original comparison and resolved-origin evidence were retained. `be-test-summary.UNAPPROVED.json` aggregates actual JUnit suite headers and maps existing skip conditions to source. Tests/assertions/conditions were not changed.

For actual BE adversarial execution, a disposable local clone of `b2be605` received only the controlled Kotlin DSL addon recorded in `be-malicious-build-addon.txt`. The original BE/checksum candidate stayed clean. Its changed build input hash was pinned only in a separate `reviewOnly=true` diagnostic policy. The same `reviewMacGradleMetadata(...,{phase:'check'})` operation ran it with an active synthetic host HTTP service as a positive control. The log records 11 denied accesses and no dependency approval. The initial Kotlin extension/package-name conflict and corrected import aliases are preserved in `be-malicious-kotlin-initial.json` and the final addon/log.

Promotion requires a separately reviewed approval baseline, exact tracked verification XML, an immutable repository containing only approved files and a newly pinned normal v2 policy. The quarantine policy/draft must not be promoted by merely removing `reviewOnly` or copying a log hash.

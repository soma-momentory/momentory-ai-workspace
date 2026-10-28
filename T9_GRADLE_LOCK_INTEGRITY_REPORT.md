# T9 Gradle lockfile input integrity

Baseline: frozen Workspace `f31dbc0`. Candidate: `workspace/t9-gradle-lock-integrity`. BE `d160c65` was inspected read-only; its root `gradle.lockfile` and `buildscript-gradle.lockfile` were not changed. This patch does not approve any BE dependencies or run the formal BE suite.

## Cause and policy

The macOS `buildPaths` inventory omitted both root lockfiles, so an otherwise reviewed policy could omit their bytes. Windows `prepareWslGradle` omitted them from its tracked-input check and preparation marker digest; `runWslCheck` did not bind execution to a lockfile marker. Both paths now require exact root paths, regular canonical files with no hard links, and SHA-256 of the bytes visible to Gradle. Mac checks the policy inventory and original checkout, the private copied snapshot, and the container's `/work` copy immediately before Gradle. Windows checks the tracked worktree and preparation marker, hashes the WSL-visible files immediately before setup/check, and checks host bytes again before issuing a marker or accepting a check. Old Mac policies and Windows markers without both hashes fail closed.

| BE `d160c65` file | Git blob SHA-256 / bytes | Windows checkout SHA-256 / bytes |
| --- | --- | --- |
| `gradle.lockfile` | `1b833fb1804eb5bf33ed075d9562ba67e425058d4027ad4ae707f1378f4e5285` / 25,094 | `2eea118ea909dacf35b1979d4cca94d75bdc9d9ff20723283b420dfadd1aa5ff` / 25,295 |
| `buildscript-gradle.lockfile` | `ff0f2be96aa1f80895a92b379b10a9d1828acd1684b6a06d4897847144e99fb2` / 1,472 | `c5dad351473f60ef84aeabfc97ea14779305083b4ff5faeef1fd0d0886dffe6e` / 1,501 |

Git did not specify an EOL attribute for either file. The reviewed hash must describe the actual execution checkout, not silently substitute a Git blob or normalize CRLF.

## Windows evidence

- `node --test tests/gradle-lock-integrity.test.mjs`: **15 PASS / 0 FAIL / 0 SKIP**. Synthetic Git fixtures reject tampering of each lock, deletion of each lock, older bytes, post-review changes, file symlink (checked on WSL's native filesystem), hard link, directory junction, Git LF versus CRLF mismatch, unchanged policy metadata with changed lock, omitted WSL inventory, and omitted Mac snapshot input. A positive pair passes.
- `WORKSPACE_TEST_GRADLE_WRAPPER_DIR=C:\SWM\t9-be-security-review node tests/gradle-lock-wsl.integration.mjs`: **PASS** in an isolated synthetic Gradle project and separate `CODEX_HOME`. Actual Gradle 9.1 preparation, marker reuse and offline `check` succeeded. Removing marker lock hashes and changing a lock after preparation each caused `runWslCheck` to reject before Gradle. This reused only the wrapper files from BE; it did not use BE dependencies or change BE.
- `node --test tests/session-restore.test.mjs`: **8 PASS / 0 FAIL / 0 SKIP**.
- `npm test`: **72 tests / 63 PASS / 0 FAIL / 9 SKIP** on the final edited code. Eight skips require macOS; one requires explicit real provider integration opt-in. STALE/PAUSED recovery, approval binding, logout, launcher and backup tests passed within this suite. The separate WSL Gradle integration is not included in `npm test` and was run explicitly above.

An initial isolated Gradle run stopped before setup because its global Codex profile differed from the candidate template. The fixture now creates a separate profile home. A later negative run exposed that a marker without lock hashes was rejected only at the inner preflight; `runWslCheck` now rejects it at its entry gate. The final rerun passed. The two failed synthetic fixtures remain under this candidate's ignored `data/` directory for diagnosis; they are not BE clones or product data.

## Remaining checks and release status

- **NOT_RUN on Mac:** candidate policy renewal with both Mac checkout hashes; actual Colima snapshot and `/work` lockfile replacement tests; strict offline Gradle regression. Windows helper tests do not count as Mac runtime evidence.
- **BLOCKED for BE:** `d160c65` file-by-file dependency trust approval remains **0/732**; formal BE checks and 237 previously unrun tests require the separate approval process. This Workspace patch does not change that decision.
- **Candidate promotion:** suitable for Mac cross-validation after this Windows pass. Keep frozen `f31dbc0` as the current product baseline until Mac validation and explicit candidate selection. Workspace Release remains **NOT READY**.

Protection check: original Workspace and BE worktrees remained clean; 4178 PID 70384 and 4195 PID 53164 remained listening. The original integration DB at `C:\SWM\ai-dev-workspace\data\mobile-qa-integration-20261026\workspace.sqlite` still had one `PENDING` decision in a read-only query. No approvals, merges, pushes or deployments were performed.

# T9-A integration candidate — provisional Windows validation

**T9-A: PARTIAL. Workspace release: NOT READY.** The requested Mac T7-H commit `aefb7b4` and branch `workspace/t7-h-be-dependency-trust-review` are absent from the Windows object database and from `origin` after `git fetch origin --prune`. This report covers the available Mac T7 baseline `10d835a` plus Windows T8 `a8664a3`. It does not claim that T7-H was integrated or tested.

## Sources and worktree

| Source | Head and state | Evidence |
| --- | --- | --- |
| Original Workspace dev | `fd9cdcc`, clean | `C:\SWM\ai-dev-workspace`; unchanged. |
| Windows T8 | `workspace/t8-mobile-e2e@a8664a3`, clean | `C:\SWM\awt8`; 4178 server left running. |
| Available Mac T7 baseline | `main` / `workspace/t7-macos-hardening@10d835a`, clean | `C:\SWM\awt7`; also `origin/main`. |
| Requested Mac T7-H | `aefb7b4`, unavailable | `git ls-remote --heads origin` and local `git cat-file` found no branch/object. |
| Separate integration candidate | `workspace/t9-integration@ee96964` | `C:\SWM\awt9`; merge parents `a8664a3` and `10d835a`. |

The common ancestor of available T7 and T8 is `fd9cdcc`. T7 baseline changed 19 files; T8 changed 25. The only overlapping source file was `src/engine.mjs`. The merge kept T8's `sealTaskBaseline` and `approval_base_head` for task-specific review while retaining T7's macOS trusted runtime, setup path and isolated check command. No security guard was removed to resolve the conflict.

T7 changes kept in the candidate: pinned macOS executable checks, POSIX sandbox profiles, dependency preparation checks, Design Lab sandbox integration, sanitized macOS subprocess environment and dependency link validation. T8 changes kept: task-specific diff/approval binding, logout/session revocation, Windows WSL self-contained Git clone, UI review improvements, and the 4178 desktop controller. T7 platform paths are guarded by `process.platform==='darwin'`; T8 Windows paths retain their existing guards. The requested T7-H Gradle and BE dependency review changes cannot be compared until their commit is available.

## Validation on this Windows host

| Check | Result | Evidence and limit |
| --- | --- | --- |
| Merge conflict and syntax | PASS | One `src/engine.mjs` import conflict resolved; `node --check` and `git diff --check` passed. |
| Targeted T7/T8 security tests | PASS | 8/8 passed: macOS dependency negative checks on Windows, approval baseline, logout/Origin, Windows WSL clone. `data/t9-targeted-test.log`. |
| Full automated suite | PASS | 34 tests, 33 passed, 0 failed, 1 existing skip. `data/t9-npm-test.log`. Includes encrypted backup restore, queue/lease recovery, approval scope, token redaction and mobile-sized browser test. The actual Claude/Codex CLI test is the skipped test. |
| FE structural schema parity | PASS | 11 read-only acceptance cases against the clean structural FE worktree; `data/t9-design-schema-parity.log`. No FE file changed. |
| Actual Codex/Claude execution on integrated candidate | NOT_RUN | A fresh T9 profile and isolated runtime were not prepared while the T8 4178 instance remains active. Earlier T8 real Codex evidence is not counted as a T9 execution. |
| Worker forced exit/orphan recovery, task create/cancel/resume E2E | NOT_RUN | The full unit suite covers queue and recovery logic, but no integrated live fault-injection or end-to-end AI task was run here. |
| macOS sandbox, Gradle container, BE dependencies, full macOS suite | NOT_RUN | This host is Windows, and the requested T7-H commit is unavailable. Windows negative tests do not establish a macOS pass. |
| FE full typecheck/lint/Jest and Design Lab rendering | NOT_RUN | Only read-only schema parity was run. Existing FE main has uncommitted work and was not used for write-capable checks. |
| Real 4178 stale-state recovery after final reservation change | NOT_RUN | T8's isolated 4179 fixture passed; the live 4178 state was not damaged to make it stale. |

`git ls-files` found no `.env`, database, backup, screenshot or runtime log under version control. `.gitignore` excludes `.env`, `data/`, `backups/`, `worktrees/` and `*.log`. The only tracked match for the broad `secret` search is a test source file. T9 runtime test logs are ignored in `C:\SWM\awt9\data`.

## Protected state and remaining T9-B gates

Ports 4195 and 4178 remained owned by their original servers throughout T9-A preparation; neither server was stopped. The original 4195 database and its one pending approval were not written. Momentory FE main had pre-existing uncommitted changes; T9-A did not modify FE or BE. No approval, dependency, merge to dev/main, push or deployment was performed.

Before T9-B: obtain and verify `aefb7b4`, inspect its new overlaps, merge it into this candidate, rerun both platforms' tests and real AI execution in separate safe runtimes. Keep unresolved: Windows intermittent `fetch failed` (`UNKNOWN_CAUSE`), newly stale live 4178 recovery, any remaining WSL Git worktree path issue, 626 BE dependency approvals, 237 unrun BE checks, pending FE design approval, long-running operation and backup-cycle evidence. None is marked complete here.

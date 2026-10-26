# Release Checklist

## Evidence classification (2026-10-26)

`VERIFIED` has identified test or inspection evidence at a stated revision. `IMPLEMENTED_NOT_VERIFIED` has code but its full operating scenario was not observed. `FAILED` means the latest relevant test failed. `BLOCKED_EXTERNAL` needs unavailable equipment or access. `NOT_IMPLEMENTED` has no required path. Historical checks below retain their original evidence dates.

| Release condition | Status | Evidence or next step |
| --- | --- | --- |
| Local owner login, session cookie, Host/Origin and CSRF checks, unauthenticated API denial | VERIFIED | Current HTTP negative tests; separate worker credential. |
| Project-qualified task dependencies and registered repository selection | VERIFIED | HTTP cross-project dependency denial. One owner intentionally controls all configured projects. |
| Actual Codex project path, Workspace data, and dependency isolation | VERIFIED | Current real `test:codex-boundary`, including another registered project. |
| Claude restricted Read/Edit tools and trusted executable | VERIFIED | Prior real `test:provider-boundary`; current launcher unchanged. Claude's OS account remains trusted. |
| Preapproval, result fingerprint, duplicate decision and follow-up controls | VERIFIED | HTTP, fingerprint and current recovery tests. |
| Encrypted SQLite/configuration/screenshot backup, schema and integrity verification, actual restore | VERIFIED | `backup.test.mjs` restores tasks/decisions and rejects tampering; actual Workspace backup restored 592 screenshots. |
| Daily backup cadence over an elapsed 24-hour run | IMPLEMENTED_NOT_VERIFIED | Launcher interval is present; elapsed-time observation remains. Initial backup and retention are tested. |
| Git repositories and uncommitted worktrees backed up separately | IMPLEMENTED_NOT_VERIFIED | Workspace backup excludes them; operator must arrange separate repository/worktree backup. |
| Real Claude/Codex parallel work, human planning, approved automatic follow-up | VERIFIED | Current collaboration integration: both AI sessions overlapped; new tasks were registered during execution; human task, follow-up and 95 events. |
| Real dashboard creation through code checks, approval, restart and mobile viewport | VERIFIED | Current `test:windows-release`: fresh project, real Codex, two checks, browser approval, 390px viewport, restart, and actual backup/restore. |
| Structural edit schema, persisted data/render parity and multi-size Web capture | VERIFIED | FE `ba34e0d`; current parity (11 cases) and capture at 375/390/402/430pt plus content states. |
| Independent design drafts, rendering, evaluation, selection and isolated FE apply | VERIFIED | Earlier full pipeline on FE `ba34e0d` reached `AWAITING_APPROVAL` after typecheck, lint and 127 Jest suites; no merge. |
| Lease loss, Worker kill, orphan cleanup, partial file review and safe resume | VERIFIED | Current recovery and worker-kill/resume tests. |
| Duplicate follow-up/approval and storage write failure consistency | VERIFIED | Current recovery, HTTP and storage-failure tests. |
| Installer, provider login, isolation setup and Windows update | VERIFIED | Clean same-host clone at old `0e585e9` was set up, updated to `f9898f5`, started/stopped, migrated schema 0 to 1, and preserved/restored its task. Different hardware remains untested. |
| Full CI stability and cross-repository integration conflicts | IMPLEMENTED_NOT_VERIFIED | Current checks pass, but one transient `npm test` failure had truncated diagnostics; FE/BE full suites and integration conflicts were last checked on recorded earlier revisions. |
| Trusted macOS populated dependency preparation and Mac sandbox | NOT_IMPLEMENTED | Mac path fails closed; implementation and real Mac acceptance needed. |
| Physical phone/Tailscale separate network, locked screen, network loss/recovery | BLOCKED_EXTERNAL | Follow `MANUAL_VALIDATION.md` on a phone and tailnet. |
| Native iOS and Android display and accessibility | BLOCKED_EXTERNAL | Physical devices and Mac/iOS tooling unavailable. Web viewport results do not substitute. |

No latest repeat is `FAILED`; the transient test failure remains an open stability observation. The final Windows status and release decision are in `TEST_REPORT.md` after validation.

**IN PROGRESS — NOT RELEASE READY.** A checked item has evidence in [TEST_REPORT.md](TEST_REPORT.md); historical checks do not imply the newest source revision passed the full flow.

- [x] Audit Git boundaries, Harness Core, Expo Lab, installed tools, and preserve user changes.
- [x] Build project-configured SQLite queue, authenticated API, responsive project switcher, local supervisor, and isolated worktrees.
- [x] Connect real Claude and Codex CLIs and verify basic streaming.
- [x] Run real Claude and Codex tasks concurrently with a human task and a dependent approved follow-up in a sample project.
- [x] Verify offline queue/API/mobile-viewport behavior and cross-project list isolation.
- [x] Verify server restart, new lease nonce on reclaim, rejection of old worker completion, and `STALE` preservation.
- [x] Kill an active Windows Worker process tree and restart it; confirm no automatic duplicate execution.
- [x] Manually resume the inspected clean worktree from that killed task and pass configured checks.
- [x] Pause and resume a real Codex run through the API, preserving its worktree and passing checks.
- [x] Run a representative Momentory FE documentation task and validate all configured checks.
- [x] Execute real Claude-led REVIEW with independent Codex review in the sample project.
- [x] Execute real Claude/Codex EXPLORE with four text proposals and independent evaluations; keep visual verification separate.
- [x] Capture Momentory home variants at 375/390/402/430pt plus ten-task and long-title/large-text states with baseline comparisons.
- [x] Generate Claude/Codex editable Studio drafts, capture/evaluate them, select one, apply an isolated FE patch, and pass full FE checks up to the approval gate on the previously validated revision.
- [x] Reproduce and reassess the intermittent `bodyRelease.test.tsx` timeout; pass full FE Jest on the selected design patch (126 suites, 1,664 tests). The precise intermittent cause remains unknown.
- [x] Start Expo Lab automatically on loopback for capture and close the owned process after capture.
- [x] Implement validated add/delete/reorder/nest/unnest/text blocks in the shared RN home hero and Studio, with JSON export, immediate preview, schema rejection, targeted Jest, Studio Playwright and Web visual regression. FE lint now excludes sandbox mount targets. Preserved in Momentory FE branch `workspace/structural-design-p0` at `ba34e0d`; no main merge.
- [x] Inject a partial Worktree write, force-kill the Worker, reap its orphan WSL scope, retain `STALE` without a duplicate claim, require a reviewed diff hash, then resume to verified approval. Browser-offline follow-up draft retention and server-restart idempotency also passed; a physical mobile network test remains below.
- [ ] Complete Tailscale Serve setup, separate-network phone workflow, phone approval/rejection, and locked-screen execution test.
- [ ] Verify macOS laptop operation and native iOS/Android app screens.
- [ ] Implement and validate trusted macOS dependency preparation with the marker required by approval; the current Mac path fails closed for populated Node/Design Lab dependencies.
- [x] Test Claude restricted Read/Edit denial and sandbox configured Windows verification commands, including the full FE checks.
- [x] Re-run Momentory BE `gradlew.bat test --rerun-tasks` on Windows; compilation and tests executed successfully.
- [x] Apply root-deny WSL2 confinement to actual Windows Codex AI sessions; real AI allowed read/write and outside read/write denial passed. Missing WSL/profile fails closed. The native Windows MXC `SYSTEMROOT` failure remains a platform limitation, not an active fallback.
- [x] Verify WSL Codex cancellation, orphan cleanup, CPU/memory/swap/task-count quotas and wall timeout. Sample Node and Momentory FE checks run in a stricter WSL profile; FE automatic pipeline recheck is recorded in `TEST_REPORT.md`.
- [x] Deny real Codex AI writes to installed Node and Gradle dependencies, fail closed when WSL status is unknown, and keep heartbeat active during WSL boundary probes.
- [x] Close the observed depth-10 secret-file read: audited scan depth 32, fail-closed Worktree depth bound, depth-10/23 denial and depth-40 launch rejection.
- [x] Deny tested WSL Windows interop routes, nested Design Lab dependency writes, and unreviewed Codex launch arguments.
- [x] Bind approval to the verified Worktree fingerprint, reject changed bytes at the API gate, and prevent changed approved parents from being inherited by dependent tasks.
- [x] Pass the latest structural design selection, isolated apply, full FE typecheck, lint, and Jest, then reach the final approval gate. The recovered run rendered two candidates and changed only src/design/studioApproved.json. Native screens remain unchecked below.
- [x] Recheck the structural design pipeline after provider hardening: two candidates rendered; the initial empty Expo mount false positive was corrected, and reviewed recovery passed typecheck, lint and 127 Jest suites / 1,666 tests with only Studio JSON changed. Task `e10ee032-1f28-4582-9079-75602d4298ba` remains at the approval gate.
- [x] Capture Web screenshots on the latest checked WSL Codex package path at 375/390/402/430pt and many/long-content states; all recorded overflow was zero and baseline/candidate hashes differed. Native screens remain pending.
- [x] Allow exact empty Expo/Design Lab mounts and verified installed dependencies; reject unprepared populated or linked fixtures (`test:diff-reviewability`).
- [x] Pass Spring/Gradle checks inside root-deny WSL with loopback-only network. `test:be-isolation` completed `BUILD SUCCESSFUL` and left its BE Worktree clean; `test:wsl-loopback` denied external egress. Docker-dependent tests still require separate integration evidence if Docker is needed.
- [x] Resolve the concrete Claude and Codex release-boundary findings; focused static re-reviews of `ad2ad53` returned PASS, with separate host execution tests recorded in `TEST_REPORT.md`.
- [x] Define the local single-owner authorization boundary and verify authenticated APIs, CSRF checks, separate Worker credential, project path isolation, and encrypted Workspace data backup/restore.
- [ ] Assess broader secret masking and command audit before handling highly sensitive repositories. The owner token intentionally reaches every configured project; it is not a multi-user role system.
- [ ] Validate all FE/BE CI suites and inspect code integration conflicts before release.

External setup required: Tailscale installation/sign-in on an authorized laptop and phone, HTTPS/tailnet policy, and access to a Mac/physical mobile devices for the stated tests. No cloud or paid infrastructure has been created. Release approval should be requested only after every required check passes.

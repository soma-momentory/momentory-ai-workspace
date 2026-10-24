# Release Checklist

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
- [x] Implement validated add/delete/reorder/nest/unnest/text blocks in the shared RN home hero and Studio, with JSON export, immediate preview, schema rejection, targeted Jest, Studio Playwright and Web visual regression. Preserved in Momentory FE branch `workspace/structural-design-p0` at `906a9da`; no main merge.
- [x] Inject a partial Worktree write, force-kill the Worker, reap its orphan WSL scope, retain `STALE` without a duplicate claim, require a reviewed diff hash, then resume to verified approval. Browser-offline follow-up draft retention and server-restart idempotency also passed; a physical mobile network test remains below.
- [ ] Complete Tailscale Serve setup, separate-network phone workflow, phone approval/rejection, and locked-screen execution test.
- [ ] Verify macOS laptop operation and native iOS/Android app screens.
- [x] Test Claude restricted Read/Edit denial and sandbox configured Windows verification commands, including the full FE checks.
- [x] Re-run Momentory BE `gradlew.bat test --rerun-tasks` on Windows; compilation and tests executed successfully.
- [x] Apply root-deny WSL2 confinement to actual Windows Codex AI sessions; real AI allowed read/write and outside read/write denial passed. Missing WSL/profile fails closed. The native Windows MXC `SYSTEMROOT` failure remains a platform limitation, not an active fallback.
- [x] Verify WSL Codex cancellation, orphan cleanup, CPU/memory/swap/task-count quotas and wall timeout. Sample Node and Momentory FE checks run in a stricter WSL profile; FE automatic pipeline recheck is recorded in `TEST_REPORT.md`.
- [x] Deny real Codex AI writes to installed Node and Gradle dependencies, fail closed when WSL status is unknown, and keep heartbeat active during WSL boundary probes.
- [ ] Pass the latest structural design selection → idempotent isolated apply → full FE checks → final approval gate flow. The reviewed interrupted Worktree previously reached `AWAITING_APPROVAL`; the fresh source-pinned rendering pipeline is being revalidated. Physical native screens remain unchecked below.
- [x] Pass Spring/Gradle checks inside root-deny WSL with loopback-only network. `test:be-isolation` completed `BUILD SUCCESSFUL` and left its BE Worktree clean; `test:wsl-loopback` denied external egress. Docker-dependent tests still require separate integration evidence if Docker is needed.
- [ ] Clear independent Claude and Codex review findings on the final revision, project-scoped human authorization, broader secret masking/command audit, and reliable backups.
- [ ] Validate all FE/BE CI suites and inspect code integration conflicts before release.

External setup required: Tailscale installation/sign-in on an authorized laptop and phone, HTTPS/tailnet policy, and access to a Mac/physical mobile devices for the stated tests. No cloud or paid infrastructure has been created. Release approval should be requested only after every required check passes.

# Release Checklist

**IN PROGRESS — NOT RELEASE READY.** A checked item has evidence in [TEST_REPORT.md](TEST_REPORT.md).

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
- [x] Generate Claude/Codex editable Studio drafts, capture/evaluate them, select one, apply an isolated FE patch, and pass full FE checks up to the approval gate.
- [x] Reproduce and reassess the intermittent `bodyRelease.test.tsx` timeout; pass full FE Jest on the selected design patch (126 suites, 1,664 tests). The precise intermittent cause remains unknown.
- [x] Start Expo Lab automatically on loopback for capture and close the owned process after capture.
- [ ] Expand the Studio's validated schema and actual shared app components to support distinct structural layouts and information hierarchy. Current editable proposals change style properties only.
- [ ] Verify recovery of a partially edited worktree, process-orphan cleanup, and real network interruption.
- [ ] Complete Tailscale Serve setup, separate-network phone workflow, phone approval/rejection, and locked-screen execution test.
- [ ] Verify macOS laptop operation and native iOS/Android app screens.
- [x] Test Claude restricted Read/Edit denial and sandbox configured Windows verification commands, including the full FE checks.
- [x] Re-run Momentory BE `gradlew.bat test --rerun-tasks` on Windows; compilation and tests executed successfully.
- [ ] Apply tested OS-level read confinement to actual Codex AI sessions; direct MXC probes pass but this CLI's `codex exec` fails in the custom profile before execution.
- [ ] Complete lease fencing and orphan cleanup, project-scoped human authorization, stronger secret masking, command audit, hard resource quotas, independent security review, and reliable backups.
- [ ] Validate all FE/BE CI suites and inspect code integration conflicts before release.

External setup required: Tailscale installation/sign-in on an authorized laptop and phone, HTTPS/tailnet policy, and access to a Mac/physical mobile devices for the stated tests. No cloud or paid infrastructure has been created. Release approval should be requested only after every required check passes.

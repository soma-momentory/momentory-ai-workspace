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
- [ ] Complete automatic design proposal to editable Studio draft to visual regression to approved source patch.
- [ ] Resolve or explicitly baseline the existing `bodyRelease.test.tsx` timeout and pass the full FE check on the selected design patch. The design application task is `UNVERIFIED`.
- [ ] Verify recovery of a partially edited worktree, process-orphan cleanup, and real network interruption.
- [ ] Complete Tailscale Serve setup, separate-network phone workflow, phone approval/rejection, and locked-screen execution test.
- [ ] Verify macOS laptop operation and native iOS/Android app screens.
- [ ] Add OS-level agent isolation, lease fencing and orphan cleanup, project-scoped human authorization, stronger secret masking, command audit, security review, and reliable backups.
- [ ] Validate all FE/BE CI suites and inspect code integration conflicts before release.

External setup required: Tailscale installation/sign-in on an authorized laptop and phone, HTTPS/tailnet policy, and access to a Mac/physical mobile devices for the stated tests. No cloud or paid infrastructure has been created. Release approval should be requested only after every required check passes.

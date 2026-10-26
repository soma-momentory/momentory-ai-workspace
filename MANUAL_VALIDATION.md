# Device acceptance checklist

These checks require equipment unavailable in the 2026-10-25 Windows run. Record the date, OS version, Workspace commit, task IDs, command output, and screenshots. Do not mark a check PASS from a browser viewport or simulated network alone.

## Physical phone over another network — PENDING_MANUAL_VALIDATION

1. Install Tailscale on an authorized laptop and phone, sign both into the same tailnet, and enable tailnet HTTPS certificates when Serve prompts. Keep Funnel disabled for this Workspace. On Windows, use an Administrator PowerShell for Tailscale Serve if the client requests it.
2. Start `npm run local` on the laptop. Confirm `http://127.0.0.1:4178` works and the Workspace login token is available only from the ignored local `.env`.
3. Run `tailscale serve 4178` in another terminal and confirm `tailscale serve status` shows the private tailnet HTTPS proxy. Copy the displayed `https://...ts.net` origin into `WORKSPACE_PUBLIC_URL` in the ignored `.env`, without a trailing slash, and restart `npm run local`. Never forward port 4178 on the router or run Tailscale Funnel. The command and private Serve behavior follow the [current Tailscale CLI documentation](https://tailscale.com/docs/reference/tailscale-cli/serve).
4. Disconnect the phone from the laptop Wi-Fi, enable mobile data and Tailscale, then open the Serve HTTPS URL. Log in with the Workspace token.
5. From the phone, create a development task. Record its ID; verify live provider events, code diff, verification, a follow-up instruction, and approval or rejection. Repeat with a design task: inspect matched screenshots, select a rendered candidate, and inspect its isolated apply task. Cancel a separate task.
6. While an AI task runs, lock the laptop screen without allowing sleep. Verify continued event timestamps and result completion from the phone.
7. Disconnect the phone network during an unsent instruction and after a submitted instruction whose response has not arrived. Reconnect, retry the same instruction, and verify exactly one dependent task was created. Reopen task history after closing the phone browser.
8. Check that the URL is unavailable when Tailscale is off on the phone, that an unauthenticated request is denied, and that an invalid Workspace token is rejected. Run `tailscale serve off` after testing.

## macOS laptop — PARTIAL, actual local validation available

Actual macOS npm fixture, Codex/Claude sample workflows and boundary/recovery evidence is in [T7_MAC_REPORT.md](T7_MAC_REPORT.md). Gradle, full FE/Design Lab, actual mount replacement and Worker SIGKILL orphan recovery remain open. Follow [OPERATIONS.md](OPERATIONS.md) to pin canonical Node, npm CLI, Codex and Claude paths plus SHA-256 digests in the ignored `.env`; first use `npm run setup` to create that file. Windows unit tests and WSL results do not count as Mac passes.

On an authorized Mac with Node 22.13+, Git and the official AI CLIs, clone this Workspace commit and the registered project repositories. Set `WORKSPACE_REPO_MOMENTORY_FE` and `WORKSPACE_REPO_MOMENTORY_BE` in the ignored `.env` if their paths differ. Save OS version, Workspace and FE commits, command output, task IDs and timestamps:

```sh
sw_vers
node --version
claude --version
codex --version
npm run isolation:setup
npm test
npm run test:diff-reviewability
npm run test:local-integration
npm run test:design-capture
npm run local
```

Use a fresh isolated FE task worktree to prove both root and Design Lab `npm ci --ignore-scripts` steps, marker creation, and subsequent typecheck/lint/Jest. Run Design Lab capture from an isolated non-`main` FE checkout and verify its separate Lab sandbox boundary. Confirm a deliberately unmarked populated mount, modified lockfile, changed executable digest, PATH shim and symlink escaping the dependency mount each stop before AI execution. Do not alter the registered FE `main` checkout for these negatives. Confirm the setup and Lab deny probes read/write their allowed canary while the direct and symlinked outside Workspace-data canary remains unreadable and unchanged. Preserve a failed worktree and its logs; do not retry a partial mount as trusted.

Create real Claude, Codex and REVIEW tasks in a disposable registered test project. In the actual Codex session, attempt to read another registered project and Workspace `data/`, and attempt writes outside the worktree and to installed dependencies. Verify denial. During separate runs, cancel the task and inspect its child process group, force a timeout, kill the Worker, restart Workspace and inspect the `STALE` worktree before any manual resume. Attempt an unapproved risky operation and duplicate approval; both must be denied. Inspect persisted events for token masking. Perform encrypted backup, verification and restore in a separate test instance, then confirm tasks, decisions, screenshots and credentials policy. Record exact evidence and failures. Claude still relies on the host OS account for file access; do not claim an OS sandbox for Claude without an observed boundary.

The Mac Gradle dependency path currently fails closed. If Momentory BE must run on Mac, this remains a separate implementation blocker. Run the physical-phone checklist against this Mac with Tailscale Serve only after local acceptance. Record any sandbox/profile incompatibility as a blocker.

## Native Momentory screens — PENDING_MANUAL_VALIDATION

On the tested FE revision, run `npm run ios` on a Mac with Xcode and `npm run android` on a machine with the Android SDK. Compare the approved design and a selected structural design on small and large devices, empty and long-content states, text scale 1.5, and accessibility reading order. Record separate iOS and Android screenshots and failures. Expo Web screenshots do not count as native results.

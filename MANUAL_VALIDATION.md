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

## macOS laptop — BLOCKED until a Mac is available

On an authorized Mac with Xcode command-line tools, Node 22.14+, Git, Claude Code, Codex CLI, and Tailscale installed, clone this Workspace commit and the registered project repositories. Set `WORKSPACE_REPO_MOMENTORY_FE` and `WORKSPACE_REPO_MOMENTORY_BE` in the ignored `.env` if their paths differ. Record the outputs of:

```sh
sw_vers
node --version
claude --version
codex --version
npm run setup
npm run isolation:setup
npm test
npm run test:local-integration
npm run test:design-capture
npm run local
```

Create a real Claude task, a real Codex task, and a REVIEW task. Check that the POSIX isolation profile blocks an outside canary in an actual Codex AI session; Windows WSL evidence does not establish macOS isolation. Run the phone checklist against this Mac with Tailscale Serve. Record any sandbox/profile incompatibility as a blocker.

## Native Momentory screens — PENDING_MANUAL_VALIDATION

On the tested FE revision, run `npm run ios` on a Mac with Xcode and `npm run android` on a machine with the Android SDK. Compare the approved design and a selected structural design on small and large devices, empty and long-content states, text scale 1.5, and accessibility reading order. Record separate iOS and Android screenshots and failures. Expo Web screenshots do not count as native results.

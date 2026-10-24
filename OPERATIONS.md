# Operations

## First installation

Install Node 22.13+, Git, Claude Code CLI, Codex CLI, and Tailscale on the laptop. Sign in to Claude, Codex, and the same Tailscale tailnet on laptop and phone using each service's official flow. Check `projects.json` repository paths and test commands. Do not install on a shared computer without authorization or bypass a network policy.

Windows PowerShell:

```powershell
cd C:\SWM\ai-dev-workspace
npm run setup
```

`npm run setup` refuses to overwrite an existing `.env`. On macOS, run the same command. Repository paths may be set in `projects.json` or by `WORKSPACE_REPO_MOMENTORY_FE` and `WORKSPACE_REPO_MOMENTORY_BE`. Run `npm run local` in the workspace. Open `http://127.0.0.1:4178`, read `WORKSPACE_TOKEN` from your local `.env` to log in, choose a project, then create an AI, human, or collaborative task.

To revoke browser sessions, replace `WORKSPACE_TOKEN` in the ignored `.env` with a fresh random value of at least 32 characters and restart the launcher. Rotate `WORKER_TOKEN` as well if a worker credential may have been exposed. Keep the `.env` and `data/` directory outside Git and backups accessible only to you.

## Phone access with Tailscale Serve

The API binds only to loopback. On the laptop, run `tailscale serve 4178` in another terminal and use the HTTPS URL it prints. On Windows, Tailscale's documentation calls for an Administrator terminal for Serve; on macOS use the installed Tailscale CLI. Add that exact origin without a trailing slash as `WORKSPACE_PUBLIC_URL` in `.env`, restart `npm run local`, and open the URL on the phone while it is connected to the same tailnet. The Workspace token is still required. `tailscale serve --bg 4178` may keep the Serve proxy running after its terminal closes; `tailscale serve off` disables it. See [Tailscale Serve documentation](https://tailscale.com/docs/features/tailscale-serve) and [examples](https://tailscale.com/docs/reference/examples/serve). Do not use Funnel or router port forwarding.

The laptop may move between home, school, or cafe networks if Tailscale remains connected. A locked screen should not stop the Node process while the laptop is awake, but this has not been physically verified. Sleep, shutdown, or no network means the phone cannot control active work. Prevent sleep using the operating system's approved power settings while unattended work is needed. The dashboard's “알림 켜기” button requests browser notification permission; notifications require an open Workspace page and have not been verified on a physical phone.

## Recovery and shutdown

SQLite lives under ignored `data/`; project/task worktrees live under ignored `worktrees/`. The launcher restarts a crashed API or worker. A lost lease with a worktree becomes `STALE`: inspect events and `git status` in that worktree before pressing Resume. A `*.result.json` checkpoint and an `orphan_result` event may help reconcile an interrupted completion. Preserve the database and worktrees together in backups; stop the launcher before copying the SQLite files. The system does not yet create scheduled backups.

Use the task controls to pause or cancel. Ctrl+C in the launcher performs normal shutdown; stop Serve separately with Ctrl+C or `tailscale serve off`. Approved changes stay in isolated worktrees until a person reviews the diff and integrates them through normal Git workflow. The workspace never force pushes, merges main, or deploys.

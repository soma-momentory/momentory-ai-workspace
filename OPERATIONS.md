# Operations

## First installation

Install Node 22.13+, Git, Claude Code CLI, Codex CLI, and Tailscale on the laptop. Sign in to Claude, Codex, and the same Tailscale tailnet on laptop and phone using each service's official flow. Check `projects.json` repository paths and test commands. Do not install on a shared computer without authorization or bypass a network policy.

Windows PowerShell:

```powershell
cd C:\SWM\ai-dev-workspace
npm run setup
npm run isolation:setup
```

`npm run setup` refuses to overwrite an existing `.env`. `npm run isolation:setup` installs audited Codex sandbox profiles under `CODEX_HOME`; it refuses to overwrite a profile with different content except the exact previous WSL template when adding the tested Node runtime. Run the same commands on macOS, though Mac execution remains unverified. Repository paths may be set in `projects.json` or by `WORKSPACE_REPO_MOMENTORY_FE` and `WORKSPACE_REPO_MOMENTORY_BE`. Run `npm run local` in the workspace. Open `http://127.0.0.1:4178`, read `WORKSPACE_TOKEN` from your local `.env` to log in, choose a project, then create an AI, human, or collaborative task. If an installed profile changes with a later Workspace version, inspect the tracked `profiles/` template and the corresponding `CODEX_HOME/ai-dev-workspace-*.config.toml` before replacing the latter, then rerun `npm run isolation:setup`.

On Windows, real Codex AI sessions and Node/Expo verification commands require WSL2 Ubuntu with systemd, bubblewrap, Linux Codex CLI 0.164.0, and Linux Node 22.14.0 under `$HOME/.local/node_modules/node/bin`. The tested installation was:

```powershell
wsl.exe -d Ubuntu -- bash -lc 'sudo apt update && sudo apt install -y nodejs npm bubblewrap'
wsl.exe -d Ubuntu -- bash -lc 'npm install --prefix "$HOME/.local" node@22.14.0 @openai/codex@0.164.0'
npm run isolation:setup
npm run test:codex-boundary
npm run test:wsl-check-boundary
```

The WSL Codex CLI uses the existing Windows Codex login through `CODEX_HOME`; do not copy credentials into the repository. If WSL, systemd, authentication, the profile, or a deny probe fails, Codex execution fails closed. Node/Expo checks install Linux dependencies with `npm ci --ignore-scripts` in each isolated Worktree; on Windows DrvFS this initial setup took about seven minutes for Momentory FE. Java/Gradle checks still use the Windows MXC check profile and have a wider read boundary, documented in `SECURITY.md`.

On an authorized Mac, run this manual acceptance sequence from a clone of the same commit. Set the repository path overrides in the local `.env` if Momentory is not beside the Workspace clone. Record `sw_vers`, `node --version`, `claude --version`, `codex --version`, command output and the resulting task IDs. No Mac result has been supplied yet.

```sh
cd /path/to/ai-dev-workspace
npm run setup
npm run isolation:setup
npm test
npm run test:sandbox-check
npm run test:local-integration
npm run test:design-capture
npm run local
```

In a second Mac terminal, run `tailscale serve 4178` after signing in on the laptop and phone. Use the displayed HTTPS URL as `WORKSPACE_PUBLIC_URL` in `.env` and restart `npm run local`. Run the physical phone sequence below over mobile data. Treat any failed sandbox or CLI command as a blocked Mac acceptance item; do not silently fall back to an unrestricted check.

To revoke browser sessions, replace `WORKSPACE_TOKEN` in the ignored `.env` with a fresh random value of at least 32 characters and restart the launcher. Rotate `WORKER_TOKEN` as well if a worker credential may have been exposed. Keep the `.env` and `data/` directory outside Git and backups accessible only to you.

## Phone access with Tailscale Serve

The API binds only to loopback. On the laptop, run `tailscale serve 4178` in another terminal and use the HTTPS URL it prints. Tailscale's Windows examples call for an Administrator terminal; follow the installed client's prompt and your device policy. Add that exact origin without a trailing slash as `WORKSPACE_PUBLIC_URL` in `.env`, restart `npm run local`, and open the URL on the phone while it is connected to the same tailnet. The Workspace token is still required. `tailscale serve --bg 4178` may keep the Serve proxy running after its terminal closes; `tailscale serve off` disables it. See [Tailscale Serve documentation](https://tailscale.com/docs/features/tailscale-serve) and [examples](https://tailscale.com/docs/reference/examples/serve). Do not use Funnel or router port forwarding.

For a physical phone acceptance run, disconnect the phone from laptop Wi-Fi and use mobile data while both devices remain in the same tailnet. On the phone, create a development task, follow its live events, add an instruction, inspect the diff and verification, approve or reject, select a rendered design, and cancel a second task. Lock the laptop screen while keeping it awake; verify that task events continue. Then temporarily disconnect the phone and reconnect to confirm persistent history. Record the exact device/OS, tailnet URL, timestamps and task IDs. This procedure has not yet been performed on a physical phone.

Momentory design capture uses the Expo Lab on `http://localhost:8085`. The Workspace starts the Lab on loopback when required and its dependencies are present. The Lab is not exposed through Tailscale Serve. A failed Lab launch leaves the candidate unrendered and therefore unselectable. Run `npm run test:design-capture` locally to check the configured Lab adapter.

The laptop may move between home, school, or cafe networks if Tailscale remains connected. A locked screen should not stop the Node process while the laptop is awake, but this has not been physically verified. Sleep, shutdown, or no network means the phone cannot control active work. Prevent sleep using the operating system's approved power settings while unattended work is needed. The dashboard's “알림 켜기” button requests browser notification permission; notifications require an open Workspace page and have not been verified on a physical phone.

## Recovery and shutdown

SQLite lives under ignored `data/`; project/task worktrees live under ignored `worktrees/`. The launcher restarts a crashed API or worker. A lost lease with a worktree becomes `STALE`: the task detail exposes its preserved diff, and a partial diff requires an exact reviewed hash to resume. Restarted Workers reap dead-owner WSL Codex scopes; an active prior scope blocks resume. A `*.result.json` checkpoint and an `orphan_result` event may help reconcile an interrupted completion. Preserve the database and worktrees together in backups; stop the launcher before copying the SQLite files. The system does not yet create scheduled backups. [Manual device validation](MANUAL_VALIDATION.md) separates phone, Mac, and native checks from Windows simulation.

Use the task controls to pause or cancel. Ctrl+C in the launcher performs normal shutdown; stop Serve separately with Ctrl+C or `tailscale serve off`. Approved changes stay in isolated worktrees until a person reviews the diff and integrates them through normal Git workflow. The workspace never force pushes, merges main, or deploys.

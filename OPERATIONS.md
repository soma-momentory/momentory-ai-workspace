# Operations

## First installation

Install Node 22.13+, Git, Claude Code CLI, Codex CLI, and Tailscale on the laptop. Sign in to Claude, Codex, and the same Tailscale tailnet on laptop and phone using each service's official flow. Check `projects.json` repository paths and test commands. Do not install on a shared computer without authorization or bypass a network policy.

Windows PowerShell:

```powershell
cd C:\SWM\ai-dev-workspace
npm run setup
npm run isolation:setup
```

`npm run setup` refuses to overwrite an existing `.env`. `npm run isolation:setup` installs audited Codex sandbox profiles under `CODEX_HOME`; it refuses to overwrite an unrelated local profile change. Repository paths may be set in `projects.json` or by `WORKSPACE_REPO_MOMENTORY_FE` and `WORKSPACE_REPO_MOMENTORY_BE`. On macOS, set the pinned CLI paths and hashes below before isolation setup. Run `npm run local` in the workspace. Open `http://127.0.0.1:4178`, read `WORKSPACE_TOKEN` from your local `.env` to log in, choose a project, then create an AI, human, or collaborative task. If an installed profile changes with a later Workspace version, inspect the tracked `profiles/` template and the corresponding `CODEX_HOME/ai-dev-workspace-*.config.toml` before replacing the latter, then rerun `npm run isolation:setup`.

Existing installations created before encrypted backups need `npm run backup:init` once. It appends a random `WORKSPACE_BACKUP_KEY` to the ignored `.env` without changing existing tokens. Keep an offline copy of that key outside the laptop; losing it makes encrypted backups unreadable. `npm run setup` includes the key on new installations. `npm run local` requires the key and creates a backup before starting AI workers, then every 24 hours while running. A backup failure stops the launcher. Retention keeps the 14 newest backups plus one per day from up to 30 older days in ignored `backups/`.

If `WORKSPACE_DATA_FILE` is customized, explicitly set `WORKSPACE_PROJECTS_FILE`, `WORKSPACE_BACKUP_ENV_FILE`, and `WORKSPACE_SCREENSHOTS_DIR` for that instance; the launcher and backup/restore command fail closed when any is missing. `WORKSPACE_SCREENSHOTS_DIR` moves capture, API serving, backup and restore together. Set `WORKSPACE_PORT` in the instance environment file or shell before restore so the command can detect a running server. `WORKSPACE_BACKUP_DIR` can move encrypted files; by default they are placed beside the custom database in a `backups/` directory. These paths keep alternate instances from copying or restoring the primary Workspace's projects, secrets or screenshots.

## Backup and restore

From the Workspace root, run `npm run backup:create` to snapshot live SQLite with `VACUUM INTO`, verify the result, and encrypt the database, `projects.json`, `.env`, and design screenshots with AES-256-GCM. The output prints the exact backup path. Check it with `npm run backup:verify -- "<path>.awbackup"`.

For disaster recovery, preserve the original `.env` or its backup key separately. Restore registered Git repositories and task worktrees referenced by the database to their original absolute paths first. Stop `npm run local` and all Workspace workers. Then run `npm run backup:restore -- "<path>.awbackup"` followed by `npm run local`. Existing `.env` credentials are preserved by default so an old backup cannot silently reactivate rotated tokens. On a fresh machine with no `.env`, supply the offline backup key through `WORKSPACE_BACKUP_KEY`; the archived `.env` is restored. To deliberately replace existing credentials and all environment settings, add `--restore-credentials` to the restore command. Restore rejects a bad authentication tag, checksum, schema, SQLite integrity result, missing referenced worktree, or running local server before replacing live files. It stages and validates files, then rolls back replacements if a filesystem operation fails. If a power interruption leaves `.restore-` or `.rollback-` files, startup stops for local recovery rather than opening a mixed set of data.

The database backup restores project registration, task queue, dependencies, events, decisions, settings, and screenshots together. It does not include provider login directories, the ignored `worktrees/` tree, or registered Git repositories. Back up those separately: database history cannot reconstruct uncommitted code. Restrict access to both encrypted backups and the separate key. Rotating the Workspace login token does not change the backup key.

After an abrupt termination during backup or verification, inspect the current user's OS temporary directory for `workspace-snapshot-*` or `workspace-verify-*` and remove stale directories only after confirming no backup command is running. They can contain plaintext SQLite snapshots.

On Windows, real Codex AI sessions and Node/Expo verification commands require WSL2 Ubuntu with systemd, bubblewrap, Linux Codex CLI 0.164.0, and Linux Node 22.14.0 under `$HOME/.local/node_modules/node/bin`. The tested installation was:

```powershell
wsl.exe -d Ubuntu -- bash -lc 'sudo apt update && sudo apt install -y nodejs npm bubblewrap iproute2 openjdk-21-jdk-headless'
wsl.exe -d Ubuntu -- bash -lc 'npm install --prefix "$HOME/.local" node@22.14.0 @openai/codex@0.164.0'
npm run isolation:setup
npm run test:codex-boundary
npm run test:wsl-check-boundary
```

Claude must resolve to an actual `claude.exe` outside the Workspace and every task Worktree on Windows. The launcher starts that absolute executable without a shell, so a `claude.cmd`, `claude.bat`, or `claude.exe` placed inside a project cannot shadow it. WSL Codex must resolve to the reviewed `~/.local/node_modules/@openai/codex/bin/codex.js` package; `WORKSPACE_WSL_CODEX` overrides are rejected. Reinstall the official CLI under that location if the path check fails.

The WSL Codex CLI uses the existing Windows Codex login through `CODEX_HOME`; do not copy credentials into the repository. If WSL, systemd, authentication, the profile, or a deny probe fails, Codex execution fails closed. Node/Expo checks install Linux dependencies with `npm ci --ignore-scripts` in each isolated Worktree; on Windows DrvFS this initial setup took about seven minutes for Momentory FE. Spring checks require WSL OpenJDK 21 and an isolated Gradle dependency cache. The setup fetches dependencies from a clean committed build; later tests run offline in a loopback-only network namespace. `npm run test:be-isolation` passed on the tested Windows/WSL host after configuring a bounded 384-task Gradle scope and startup Byte Buddy agent. See `TEST_REPORT.md` for the exact result and Docker-dependent test limitation.

On an authorized Mac, run `npm run setup` once on a fresh clone, then locate the canonical files for Node, npm CLI, Codex and Claude. Resolve the installed commands before adding them to `.env`; do not pin shell aliases or symlinks. These commands print paths and hashes, never credentials:

```sh
node -p 'require("fs").realpathSync(process.execPath)'
python3 -c 'import os,shutil; [print(name,os.path.realpath(shutil.which(name) or "")) for name in ("npm","codex","claude")]'
shasum -a 256 /absolute/canonical/node /absolute/canonical/npm-cli.js /absolute/canonical/codex /absolute/canonical/claude
```

Add the four paths to the ignored `.env` as `WORKSPACE_MAC_NODE`, `WORKSPACE_MAC_NPM_CLI`, `WORKSPACE_MAC_CODEX`, `WORKSPACE_MAC_CLAUDE`, and each matching lowercase hex digest as `<name>_SHA256` (for example, `WORKSPACE_MAC_NODE_SHA256`). All four files must be canonical, outside Workspace/task worktrees, owned by the current user or root, and not writable by group or others. Use the native Codex binary inside the official installation rather than its npm JS launcher. The Node runtime must be 22.x at 22.13+; npm must report major 10 or 11. Refresh the digest after a reviewed CLI update, then reinstall the Codex profiles. The Workspace never installs these CLIs automatically. A changed file, symlink, PATH shim, or missing profile stops execution.

Run this manual acceptance sequence from a clone of the same commit. Set repository path overrides in `.env` if Momentory is not beside Workspace. Record `sw_vers`, command output and task IDs. [T7_MAC_REPORT.md](T7_MAC_REPORT.md) records actual Mac fixture/sample results and the remaining full-project acceptance work.

```sh
cd /path/to/ai-dev-workspace
npm run isolation:setup
npm test
npm run test:diff-reviewability
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

Momentory design capture uses the Expo Lab on `http://localhost:8085`. The Workspace starts the Lab on loopback in a WSL root-deny sandbox on Windows after preparing isolated dependencies. The Lab is not exposed through Tailscale Serve. A failed launch marks the candidate `CAPTURE_FAILED` and keeps it unselectable; use the candidate's retry action after checking the failure event. A process restart requeues `CAPTURE_PENDING` candidates. Run `npm run test:design-capture` with `WORKSPACE_REPO_MOMENTORY_FE` set to a clean structural FE worktree to check the adapter.

The laptop may move between home, school, or cafe networks if Tailscale remains connected. A locked screen should not stop the Node process while the laptop is awake, but this has not been physically verified. Sleep, shutdown, or no network means the phone cannot control active work. Prevent sleep using the operating system's approved power settings while unattended work is needed. The dashboard's “알림 켜기” button requests browser notification permission; notifications require an open Workspace page and have not been verified on a physical phone.

## Recovery and shutdown

Upgrading from an earlier Workspace profile: run `npm run isolation:setup` after reviewing the tracked `profiles/` changes. The installer recognizes the exact prior scan-depth-8 template and installs scan depth 32; a different local profile edit fails closed. A deep or oversized Worktree blocks isolated execution. An already approved parent result without the new verified fingerprint cannot be inherited by a dependent task; rerun and verify that parent before approving it again. If the Worktree changes after checks or approval, restore or re-verify the reviewed contents rather than overriding the HTTP 409 response.

Empty `expo-lab/node_modules` and `design-lab/node_modules` directories can be created as read-only sandbox mounts in a Momentory FE Worktree. The gate ignores exact empty directories; populated root or Design Lab dependencies on every platform require a validated locked-installation marker. The T7 macOS candidate can issue that marker only after the pinned npm setup, sandbox deny probe and installed-index checks succeed. Unprepared or linked content remains an ignored-content violation. This marker path passed on a real Mac with fixed fixtures and fetched FE main plus the isolated Lab cache fix. Only lockfile-declared internal workspace links with tracked unchanged manifests are accepted. Actual mounted volumes and external links fail the launch preflight. Mac Gradle source/material verification is available behind a pinned operator policy; dependency resolution still fails closed under the network-deny boundary. The historical Windows release test preserved an `UNVERIFIED` design apply, reviewed its Diff hash, resumed the same Worktree, and reached `AWAITING_APPROVAL` after all configured FE checks passed. Do not discard or auto-approve an `UNVERIFIED` Worktree.


SQLite lives under ignored `data/`; project/task worktrees live under ignored `worktrees/`. The launcher restarts a crashed API or worker. A lost lease with a worktree becomes `STALE`: the task detail exposes its preserved diff, and a partial diff requires an exact reviewed hash to resume. Restarted Workers reap dead-owner WSL Codex scopes; an active prior scope blocks resume. WSL scope metadata is written atomically. A zero-filled legacy marker is moved to `data/codex-processes/quarantine/` only after its owner has exited and the corresponding scope is inactive across installed WSL distributions; malformed nonzero metadata still blocks execution for inspection. A `*.result.json` checkpoint and an `orphan_result` event may help reconcile an interrupted completion. The launcher creates encrypted backups on start and every 24 hours; worktrees and Git repositories require separate backup. [Manual device validation](MANUAL_VALIDATION.md) separates phone, Mac, and native checks from Windows simulation.

Use the task controls to pause or cancel. Ctrl+C in the launcher performs normal shutdown; stop Serve separately with Ctrl+C or `tailscale serve off`. Approved changes stay in isolated worktrees until a person reviews the diff and integrates them through normal Git workflow. The workspace never force pushes, merges main, or deploys.

## macOS process recovery and current acceptance

The Mac supervisor requires `/usr/bin/python3` and Darwin libproc (tested with Apple Python 3.9.6). It validates this support before launching commands. Atomic `data/mac-processes/*.json` files contain owner/child PIDs, start timestamps and the worktree path, without argv or environment. A restarted Worker reaps dead-owner processes before claiming work. An active or unreaped checkpoint blocks worktree reuse; malformed metadata stops recovery for local inspection. Do not delete checkpoints to force resume. The actual SIGKILL/reviewed-resume tests and latest FE `main` validation are in [T7_MAC_FOLLOWUP_REPORT.md](T7_MAC_FOLLOWUP_REPORT.md).

FE Lab candidate `711f4e3` keeps dependency trees read-only: TS build info uses its generated cache, Vite optimization uses a private per-run temporary directory, and repeat builds clear generated files without removing directories. The candidate is not merged into FE main. Gradle remains BLOCKED; the verified fixture artifact policy is not a complete Momentory BE approval policy.

On this Mac, both the original Workspace and this follow-up worktree have a private ignored `.env` pointing `WORKSPACE_REPO_MOMENTORY_FE` to `/Users/kjh/Momentory/momentory-fe-t7-mac-main` (`e6f88ce` main plus `711f4e3` Lab fixes). These paths now persist beyond test subprocesses. The original FE checkout and its uncommitted work remain preserved. Use this follow-up Workspace branch for the T7 recovery and boundary changes; the original Workspace main source was not updated or merged. See `evidence/t7-mac-followup/frontend-main-binding.json` for the ordinary configuration-loading checks.

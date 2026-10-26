# AI Development Workspace

**Status: IN PROGRESS.** This is a portable, single-laptop, local-first development workspace. It has a persistent task queue, Claude/Codex CLI adapters, a responsive web UI, separate Git worktrees, project configuration, human task planning, and a Momentory Expo Lab adapter. It is not release ready; see [TEST_REPORT.md](TEST_REPORT.md) and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

The workspace source lives at `C:\SWM\ai-dev-workspace`. Momentory is a registered external project; `C:\SWM\ai-dev-workspace-sample` is a second Git repository used for isolation tests. On a fresh checkout, run `npm run sample:init` to create it from the tracked template. The original prototype at `C:\SWM\momentory\momentory\momentory-ai-workspace` was left untouched after copying source; its generated test worktrees were not moved.

## Start on Windows

Requires Node 22.13+, Git, authenticated official `claude` and `codex` CLIs, plus WSL2 Ubuntu with systemd, bubblewrap, Linux Codex and Node 22 for isolated Windows AI and Node/Expo checks. Spring checks additionally require WSL OpenJDK 21. Run `npm run setup` once to create ignored `.env` with distinct login, worker, and encrypted-backup keys. Existing installations run `npm run backup:init` once. Run `npm run isolation:setup` to install sandbox profiles, and verify paths in `projects.json`. The exact setup, backup, restore and acceptance commands are in [OPERATIONS.md](OPERATIONS.md). Then run:

```powershell
cd C:\SWM\ai-dev-workspace
npm run local
```

Open `http://127.0.0.1:4178` and log in with `WORKSPACE_TOKEN`. The launcher supervises one Claude slot, one Codex slot, and the API. It creates a verified encrypted Workspace data backup on start and every 24 hours. Ctrl+C stops them gracefully. No `npm install` is required for the workspace itself; individual project worktrees use their configured tools.

## Start on macOS

Install Node 22.13+, Git, and authenticated official CLIs. Clone this repository and each target project. Set each repository path in `projects.json` or use `WORKSPACE_REPO_<PROJECT>_<REPO>` environment variables. Run `npm run setup`, `npm run isolation:setup`, then `npm run local`. macOS parity has not yet been tested on a Mac.

## Projects and tasks

Edit `projects.json` locally to add a project ID, display name, Git repositories, validation commands, protected paths, and design rules. Restart the workspace to load changes. The dashboard switches projects without touching core code. Tasks are `AI_TASK`, `HUMAN_TASK`, or `COLLABORATIVE_TASK`, with dependencies, completion criteria, priorities, and recorded decisions. Two local AI slots may run independent tasks concurrently; each task has its own worktree.

The worker starts from committed Git HEAD. Uncommitted source changes are deliberately excluded. Approval unlocks dependent tasks; it does not merge, push, or deploy. Approved parent worktree changes are copied into a dependent worktree only when the dependency is within the same project and repository.

## Tests

`npm test` runs offline core, HTTP, security, backup/restore, storage-failure, and 390px browser tests. `npm run test:windows-release` creates a new project and runs a real Codex task from the 390px dashboard through approval, restart, backup and restore. `npm run test:local-integration` runs a real Codex edit on an isolated sample checkout. `npm run test:collaboration-integration` runs actual Claude/Codex parallel tasks, a human task created during AI execution, approval, and an inherited follow-up. `npm run test:momentory-integration` runs a real task against a Momentory FE worktree and its validation commands. `npm run test:design-capture` starts or reuses the Expo Lab on localhost port 8085. `npm run test:momentory-explore` asks both subscribed CLIs for editable Studio drafts, screenshots and evaluations. `npm run test:explore-integration` tests generic text proposals. `npm run test:provider-boundary` and `npm run test:sandbox-check` exercise the supported process boundaries. `npm run test:recovery-integration`, `npm run test:worker-kill` (Windows), and `npm run test:pause-integration` exercise lease, crash, and pause paths. These integration commands may consume account quota.

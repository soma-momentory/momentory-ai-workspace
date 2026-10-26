# Integration Guide

## Register a project

Add an entry to `projects.json` with a unique lowercase ID, display name, and one or more repositories. Each repository needs a path to its Git root, a stack label, and an array of check commands. Paths are relative to the workspace unless absolute. A local environment override `WORKSPACE_REPO_<PROJECT_ID>_<REPOSITORY_ID>` is useful on macOS or when checkouts move. Configuration is read on demand by the API; restart the launcher to update worker capabilities. Configuration edits are local administrator actions; the remote UI cannot register arbitrary shell commands or file paths.

The included `momentory` project maps `fe` and `be` to the existing repositories and configures FE dependency setup, typecheck, lint, Jest, plus BE Gradle tests. The included `sample` project maps `app` to a separate committed Git repository at `../ai-dev-workspace-sample`; run `npm run sample:init` once on a fresh installation. New projects require no core code edits if they use the generic Git, provider, validation, and text design flows.

## Provider connection

The adapters use installed official Claude Code and Codex CLIs with structured event output. CLI authentication remains with each official tool; no API key is copied into Workspace. Claude is restricted to read/edit/write/search tools and its trusted executable is resolved outside the worktree. Windows Codex requires the audited WSL2 root-deny profile; a missing boundary fails closed. The adapter records session identifiers, usage when reported by a CLI, elapsed events, errors, and sanitized output. Session resume is attempted when an ID is available, but a forcibly interrupted provider call is surfaced as `STALE` for inspection. Claude's restriction still trusts the host OS account; macOS isolation awaits real Mac validation.

`WORKSPACE_TOKEN` authenticates the single human owner; `WORKER_TOKEN` authenticates local workers. Both are distinct and stored only in ignored `.env`. The UI shows project-specific tasks and results. Approval never performs a Git merge or push.

## Momentory adapters

The FE Harness Core can still run independently with `node harness/run.mjs "goal"`. Workspace reuses its protected-path policy and validation conventions, but does not invoke the complete Harness Core pipeline directly. Expo Web Design Lab remains in `momentory-fe/expo-lab`; its Studio JSON validator is imported by the Momentory adapter. Uploading an exported Studio JSON from Design Review captures baseline and candidate screenshots at 375, 390, 402, and 430pt. Selecting a rendered candidate queues an isolated worktree task that invokes the existing `apply-design.mjs --write` there and runs FE checks. It never writes directly to the user's FE checkout; a second approval is required before manual integration. The selected structural-design apply at FE `ba34e0d` passed typecheck, lint and 127 Jest suites / 1,666 tests and reached `AWAITING_APPROVAL`; native screens remain unverified.

## Dependency and handoff

Tasks can depend only on tasks in the same project. A dependent task waits until each prerequisite is `APPROVED`, `SELECTED`, or `DONE`. If a prerequisite contains approved code changes in the same repository, the new task's worktree inherits that patch. Conflicting patches fail safely. Human tasks are shown as ready only when prerequisites are complete. Decision packets record the question, options, tradeoffs, recommendation, evidence, and next effect; the owner may approve or reject on mobile.

## Minimum T0–T4 mobile integration points

T0 uses the existing owner login and `GET /api/session`; remote access still requires the configured private HTTPS origin. T1 creates project-qualified tasks through `POST /api/tasks` and reads `GET /api/overview?project=<id>`. T2 consumes `GET /api/stream` and `GET /api/tasks/<id>` for progress, verification and history. T3 submits follow-up instructions to `POST /api/tasks/<id>/followup` with a retained UUID `requestId`; retrying the same ID returns the same child task. T4 uses the existing decision and task-control routes for approval, rejection, design selection, pause and cancellation. Mobile development needs these API/UI contracts and physical-device validation, not a new execution engine or automation tool.

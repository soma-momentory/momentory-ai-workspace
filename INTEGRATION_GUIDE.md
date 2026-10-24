# Integration Guide

## Register a project

Add an entry to `projects.json` with a unique lowercase ID, display name, and one or more repositories. Each repository needs a path to its Git root, a stack label, and an array of check commands. Paths are relative to the workspace unless absolute. A local environment override `WORKSPACE_REPO_<PROJECT_ID>_<REPOSITORY_ID>` is useful on macOS or when checkouts move. Configuration is read on demand by the API; restart the launcher to update worker capabilities. Configuration edits are local administrator actions; the remote UI cannot register arbitrary shell commands or file paths.

The included `momentory` project maps `fe` and `be` to the existing repositories and configures FE dependency setup, typecheck, lint, Jest, plus BE Gradle tests. The included `sample` project maps `app` to a separate committed Git repository at `../ai-dev-workspace-sample`; run `npm run sample:init` once on a fresh installation. New projects require no core code edits if they use the generic Git, provider, validation, and text design flows.

## Provider connection

The adapters use the installed official [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code/cli-usage) and [Codex CLI](https://developers.openai.com/blog/codex-as-a-platform) with structured event output. CLI authentication remains with each official tool; no API key is copied into Workspace. Claude is restricted to read/edit/write/search tools; Codex uses its workspace-write sandbox. The adapter records session identifiers, usage when reported by a CLI, elapsed events, errors, and sanitized output. Session resume is attempted when an ID is available, but a forcibly interrupted provider call is surfaced as `STALE` for inspection. Neither tool restriction is an OS security boundary.

`WORKSPACE_TOKEN` authenticates the single human owner; `WORKER_TOKEN` authenticates local workers. Both are distinct and stored only in ignored `.env`. The UI shows project-specific tasks and results. Approval never performs a Git merge or push.

## Momentory adapters

The FE Harness Core can still run independently with `node harness/run.mjs "goal"`. Workspace reuses its protected-path policy and validation conventions, but does not invoke the complete Harness Core pipeline directly. Expo Web Design Lab remains in `momentory-fe/expo-lab`; its Studio JSON validator is imported by the Momentory adapter. With the lab running locally, uploading an exported Studio JSON from Design Review captures baseline and candidate screenshots at 375, 390, 402, and 430pt. Selecting a rendered candidate queues an isolated worktree task that invokes the existing `apply-design.mjs --write` there and runs FE checks. It never writes directly to the user's FE checkout; a second approval is required before any manual integration. The current selected-design test remains `UNVERIFIED` because the pre-existing FE `bodyRelease.test.tsx` times out.

## Dependency and handoff

Tasks can depend only on tasks in the same project. A dependent task waits until each prerequisite is `APPROVED`, `SELECTED`, or `DONE`. If a prerequisite contains approved code changes in the same repository, the new task's worktree inherits that patch. Conflicting patches fail safely. Human tasks are shown as ready only when prerequisites are complete. Decision packets record the question, options, tradeoffs, recommendation, evidence, and next effect; the owner may approve or reject on mobile.

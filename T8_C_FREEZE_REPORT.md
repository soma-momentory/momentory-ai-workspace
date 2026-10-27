# T8-C final validation and freeze — 2026-10-27

**Result: PARTIAL. Workspace release: NOT READY.** Candidate: `C:\SWM\awt8`, branch `workspace/t8-mobile-e2e`. This pass validated commit `a403635` without changing controller, server, Worker or authentication code. The final documentation-only commit records this evidence. No merge, push or deployment was performed.

## Baseline and preservation

- Before testing, authenticated controller status was `ON`; saved manager/launcher/server PIDs were `52748/61992/52936`, with Claude/Codex Workers `65004/66552`. Port 4178 belonged to that server. The T8 database had zero `RUNNING`/`QUEUED` tasks, zero active Workers and passed `PRAGMA quick_check`.
- The T8 backup directory contained 14 `.awbackup` files. The original desktop shortcut and `data/desktop-shortcut-before-t8c.lnk` had matching SHA-256 `9DD2D00967DDF2968029E60A018666CC9A2296437CA829804BFBB9BE8BF56FD1`.
- The separate original Workspace server remained PID `53164` on port 4195. Its database `C:\SWM\ai-dev-workspace\data\mobile-qa-integration-20261026\workspace.sqlite` had seven task IDs/statuses and one pending decision matching `data/t8c-original-before.json` before and after testing. Its database `PRAGMA quick_check` returned `ok`. No original process, database, approval or desktop shortcut was changed.

## Results

| Check | Result | Evidence and limit |
| --- | --- | --- |
| Incomplete process ownership fails closed | PASS | An isolated saved state without a complete ownership snapshot returned `UNKNOWN`; `recover` exited nonzero, and the state bytes remained unchanged. |
| Stale-state success after final reservation change | PASS (isolated) | The 4179 fixture used copies of commit `a403635`'s controller, inspector and config with only port, pipe, fixture-only Tailscale/icon adapters and a test delay changed. Five saved identities referred to absent PIDs; the fixture DB had no active work. `recover` archived the state byte-for-byte, logged intent/completion, removed the lock and reported `OFF`. Archived SHA-256: `7aa8b4c8188f1a2de9afc8404fe1287c9735f6d9c4c383a8cceaa7f9d8cdadd8`. |
| Recovery/start race | PASS (isolated) | While recovery held its transition lock and loopback reservation, a second bind got `EADDRINUSE` and a concurrent `start` exited nonzero with the transition-in-progress error. The archived state and final `OFF` status remained consistent. |
| Successful recovery of a newly stale live 4178 state | NOT_RUN | Deliberately corrupting the running instance's real state would violate the preservation requirement. The earlier live stale recovery preceded the final reservation change. |
| Actual 4178 stop, start and restart | PASS | With zero active work, authenticated IPC stopped T8 twice. Each stop yielded `OFF`, no 4178 listener/state file and a gray `workspace-off.ico`; two starts yielded `ON`, an owned server and two Workers, unauthenticated `/api/session` HTTP 401 and a green `workspace-on.ico`. Final manager/launcher/server PIDs: `66428/50332/70384`; Workers: `70584/67284`. Port 4195 remained PID `53164`. |
| Full automated suite | PASS | `npm test`: 30 tests, 29 passed, 0 failed, 1 existing skip. Evidence: `data/t8c-freeze-npm-test.log`. This includes approval scope, session logout/Origin and Windows WSL Git clone tests. |
| Earlier intermittent `fetch failed` root cause | NOT_RUN / UNKNOWN_CAUSE | No `fetch failed` appeared in the final or six earlier passing full-suite logs. Two lines in `data/desktop-control.log` occurred during a deliberate server termination in prior T8-C fault injection, but do not establish the cause of the earlier intermittent test failure. |

The first added fixture probe tested the port before recovery reached its reservation and failed with `portProbe: FREE`. The probe was changed to wait until the reservation accepted a connection; the final run passed all 12 checks. This was fixture timing, not a product failure. The first fixture and its failed result were retained as evidence.

## Evidence and reproduction

- Isolated fixture harness: `data/t8c-freeze-harness.mjs`. Passing results: `data/t8c-freeze-fixture-1793109191702/data/fixture-results.json`; archived stale state and event log are in the same fixture directory. Its generated `.env` contains throwaway fixture tokens. The fixture never used the real 4178 state, database, desktop shortcut or Tailscale route.
- Controlled process exits and state transitions: `data/desktop-control-events.jsonl`, `data/desktop-control.log`, `data/desktop-manager.stderr.log`. Final full-suite output: `data/t8c-freeze-npm-test.log`.
- To look for the unresolved intermittent failure, run `npm test` from the candidate while recording its output, then search that output for `fetch failed` and correlate any hit's time with `data/desktop-control-events.jsonl` server exits, `data/desktop-control.log` and port 4178 ownership. Do not infer a cause from a `fetch failed` line alone. Do not stop an active task to reproduce it.

## Frozen state

T8 remains `ON` on private port 4178 with no active task or Worker assignment. The separate 4195 original remains running, with one pending approval. No Mac code or Momentory FE/BE file was modified. Controller and application code are frozen at `a403635`; this report only records final validation. T8-C remains **PARTIAL** because the intermittent `fetch failed` cause is unknown and a newly stale production 4178 state was not manufactured for testing. Workspace release remains **NOT READY**.

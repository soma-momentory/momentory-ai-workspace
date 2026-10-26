# T8-C Windows candidate validation — 2026-10-27

**T8-C: PARTIAL. Workspace release: NOT READY.** This report covers only `workspace/t8-mobile-e2e` in `C:\SWM\awt8`. The original `C:\SWM\ai-dev-workspace` `dev@fd9cdcc` and Momentory FE/BE were not modified, merged or deployed.

## Controller failure and recovery

- The desktop manager crashed with an unhandled `write EPIPE` at the old `control.mjs:134`. Its status IPC handler ran slow process and Tailscale inspections before replying; the client disconnected after five seconds. The stack trace is in `data/desktop-manager.stderr.log`. The failure cause is confirmed.
- Before stale-state recovery, the saved manager/launcher/server/Worker PID, start time and executable identities were examined; none was live. Port 4178 was free, T8 had no running or queued task or active worker, and the original 4195 process tree was intact. The original state was atomically archived as `data/desktop-control-stale-1793031517968.json`; recovery evidence is in `data/desktop-control-events.jsonl`. No state file was manually deleted and no unknown process was terminated.
- The manager now answers status IPC immediately, handles disconnected clients, and logs process exits and exceptions. A deliberately disconnected authenticated status client produced an `EPIPE` event while the controller stayed `ON`.
- The T8 recovery path now refuses incomplete ownership, live saved PIDs, nonempty work queues and unknown listeners. It takes an exclusive transition lock and reserves loopback port 4178 while archiving a stale state. Recovery was successful on the real stale state before the final port reservation addition. The final reservation addition was inspected and syntax checked; a second successful stale-state recovery has **not** been run. Calling recovery while the server was live was correctly refused and released the transition lock.
- The candidate launcher records each child start/exit, exit code, timestamp and whether a normal stop was requested. One unexpected child exit can be retried. A second exit of the same child within five minutes stops the T8 launcher with code 1 and turns the test icon gray. Controlled shutdown does not kill a timed-out child.

## Actual Windows execution

| Check | Result | Evidence |
| --- | --- | --- |
| Separate test shortcut and original backup | PASS | `AI Workspace T8 검증.lnk` points to `C:\SWM\awt8`; original shortcut and `data/desktop-shortcut-before-t8c.lnk` have the same SHA-256 `9DD2D00967DDF2968029E60A018666CC9A2296437CA829804BFBB9BE8BF56FD1`. |
| Desktop start, sustained run, duplicate start refusal, graceful stop and restart | PASS | User saw green/off gray icons and Korean messages. Manager, server and two workers remained owned; API `/api/session` returned 401 without a session. Authenticated IPC stop recorded exit code 0 for all processes and removed the state and listener. |
| Stop while Codex task was running | PASS | Authenticated `stop` refused `running or queued task`; 4178 remained `ON`. |
| Single server crash and restart | PASS | T8 server PID 67096 exited with code 4294967295; PID 65036 restarted. API returned 401 and ownership snapshot was refreshed. |
| Repeated crash fail closed | PASS | PIDs 67096 and 65036 were terminated only as controlled fault injection after confirming exact T8 ancestry, start identity, port ownership and no active task. `repeated-unexpected-exit` was recorded; launcher/manager exited code 1, 4178 and state disappeared, icon became gray. The user restarted through the test shortcut. |
| Original 4195 protection | PASS | Original supervisor/server/workers 48592/53164/55604/24444 remained alive. Its 7 task IDs/statuses and 1 pending decision matched `data/t8c-original-before.json` after the mobile tests. |
| Tailscale private route | PASS | `tailscale serve status --json` maps private HTTPS to `http://127.0.0.1:4178`; no Funnel configuration was present. |
| Earlier intermittent `fetch failed` cause | UNKNOWN_CAUSE | Six repeated full suites had 0 failures. During the intentional server kill, the launcher log showed `fetch failed`; this does not establish the cause of the earlier intermittent test failure. |

## Real Codex and S25 Edge

- The Windows Git `.git` pointer failure was reproduced. New Windows Codex tasks use a self-contained local transport clone with no origin, object alternates or hardlinks to the source. Windows Git and WSL Git both read the task clone. `tests/t8c.test.mjs` checks the clone and WSL Git status.
- On the S25 Edge, the user created Codex FAST task `467bad00-6200-4483-afba-680be84788a4`. Codex edited only `index.mjs` (`Hi` → `Hello`). Workspace isolated checks `node --check index.mjs` and `node --test` passed. The user inspected the diff and checks and approved; the task and decision are `APPROVED`. The source fixture branch stayed clean.
- Codex's own unspecific `node --test` scan encountered an expected `EACCES` on the sandbox-protected `data/` directory. Its direct `index.test.mjs` run and the Workspace's final configured `node --test` both passed. The access boundary was not relaxed.
- The user created independent task `2720febc-9592-44af-b42f-05d30bd7f12a`, verified `index.mjs` and `review-probe.txt` plus both passing checks, and rejected it. The task and decision are `REJECTED`. The user logged out, then confirmed that back navigation and refresh did not reveal tasks.
- The task creation form previously cleared only its goal. After a successful creation it now resets all form controls while retaining the selected project. The user confirmed this on S25 Edge with human task `b9c484bb-dbf6-497b-8aaf-db967f3dc755`, then cancelled that test task.

## Automated evidence and limits

- Final `npm test`: 30 tests, 29 pass, 0 fail, 1 existing skip (`data/t8c-npm-test-release.log`). Five earlier repeated full suites also passed 29/0/1 (`data/t8c-npm-test-1.log` through `-5.log`). JavaScript syntax, PowerShell parsing and `git diff --check` passed.
- The incident and exit timeline is in `data/desktop-control-events.jsonl`; child stdout/stderr is in `data/desktop-control.log`; manager stderr is in `data/desktop-manager.stderr.log`. These files are ignored runtime evidence and contain no controller token.
- No mobile screenshot was captured in this run. Mobile actions above are user-observed and cross-checked against the T8 database. The final recovery port reservation addition has not been exercised on a second real stale state. The earlier intermittent `fetch failed` remains unexplained. These limits keep T8-C **PARTIAL** and the Workspace release **NOT READY**.

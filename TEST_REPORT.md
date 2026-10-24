# Test Report

Date: 2026-10-24. Overall status: **IN PROGRESS — NOT RELEASE READY**.

| Scenario | Result | Evidence |
| --- | --- | --- |
| Offline routing, persistent queue, project-qualified worker claim, lease recovery, human dependency, rendered-design selection gate, risk approval, HTTP auth, Host rejection, secret masking and session-ID validation | PASS | Final `npm test`: 13 passed, 1 real-provider test skipped by default |
| 390px responsive browser: task creation, approval, follow-up, cancel, design choice, project switch, project list isolation | PASS | `tests/mobile.test.mjs` using Playwright Chromium |
| Real Claude CLI read-only stream | PASS | `RUN_PROVIDER_INTEGRATION=1 node --test tests/providers.integration.test.mjs`: expected marker, session ID and usage |
| Real Codex CLI read-only stream | PASS | Same separately invoked real-provider test: expected marker, session ID and usage |
| Real local launcher + Codex edit + configured checks + approval | PASS | `npm run test:local-integration`: changed `index.mjs`, Node syntax/test passed |
| Server restart and lease generation recovery | PASS | `npm run test:recovery-integration`: expired uncheckpointed task was requeued, old nonce completion rejected, new nonce accepted; checkpointed task remained `STALE` and unclaimable. This does not test killing a live provider subprocess. |
| Real REVIEW mode | PASS | `WORKFLOW_MODE=REVIEW; WORKFLOW_PROVIDER=claude; npm run test:workflow-integration`: Claude edited sample code, Codex independently reviewed, configured checks passed, 38 events |
| Real EXPLORE mode | PASS for text exploration and independent evaluation | `npm run test:explore-integration`: Claude and Codex produced four proposals and both independently evaluated all four. The result explicitly marks visual verification false. |
| Real Claude and Codex parallel tasks + human task + decision packet + approved dependent follow-up | PASS | `npm run test:collaboration-integration`: overlapping execution, human `DONE`, approved parent file inherited, 92 events |
| Momentory FE actual Codex task with typecheck, lint and Jest | PASS | `npm run test:momentory-integration`: isolated document change, typecheck/lint pass, 126 Jest suites and 1,664 tests pass; result awaits human approval |
| Expo Lab Studio JSON A/B capture | PASS for home screen at four widths | `npm run test:design-capture`: 375/390/402/430pt screenshot pairs, zero root horizontal overflow, distinct SHA-256, visual inspection; editor selection outline removed; other screens/states remain unverified |
| Selected Studio export to isolated FE patch and full checks | UNVERIFIED | Selected export produced an isolated source patch. Typecheck and lint passed. Full Jest: 125/126 suites and 1663/1664 tests passed; `app/rest/__tests__/bodyRelease.test.tsx` timed out. The same test also timed out on untouched Momentory FE. A standalone rerun in the worktree also failed. No approval was granted. |
| Claude independent architecture review | PASS as review, not security audit | Real Claude CLI identified same-OS-user agent access, host/CSRF concerns and orphaned subprocess recovery. Project-qualified worker capabilities and Host validation were added; OS isolation and process fencing remain open. |
| Force-kill active Windows Worker process tree and restart | PASS for no automatic duplicate execution | `npm run test:worker-kill`: killed Worker and CLI descendants after `provider_started`, waited for lease expiration, restarted Worker; task stayed `STALE` with one attempt and its worktree persisted. |
| Manual resume after killed Worker | PASS for an inspected, clean worktree | `npm run test:resume-killed -- <database>` reused the preserved worktree and stable Worker ID, changed the goal while queued, passed sample checks, and reached `AWAITING_APPROVAL` on attempt 2. Recovery of partially edited worktrees remains unverified. |
| Phone on separate network via Tailscale Serve; device lock and network interruption | BLOCKED | Tailscale is not installed/signed in on tested laptop; no connected phone available |
| macOS execution, actual iOS/Android UI | UNVERIFIED | No Mac or mobile device run performed |
| Full design exploration through selected source patch | INCOMPLETE | Text proposals and Studio JSON upload exist; automatic editable draft and source integration are missing |
| Security penetration and OS-level command confinement | INCOMPLETE | Local auth tests pass; no penetration review or hardened OS sandbox |

The browser test uses a 390px desktop Chromium viewport and does not count as a real mobile network test. Local provider tests use actual subscribed CLIs; API and queue unit tests use deterministic fixtures. Approval records a decision; it does not merge code.

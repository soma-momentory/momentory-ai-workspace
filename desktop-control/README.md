# T8 Windows desktop control

This controls only `C:\SWM\awt8` on `127.0.0.1:4178`. The separate original Workspace on port 4195 and its database are outside this controller. Tailscale Serve must privately map HTTPS to `http://127.0.0.1:4178`; Funnel is not used.

## Desktop shortcut

Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\SWM\awt8\desktop-control\install.ps1` once. Installation backs up the original shortcut to `C:\SWM\awt8\data\desktop-shortcut-before-t8c.lnk`, leaves the original unchanged, and creates a separate **AI Workspace T8 검증** shortcut. Gray means off; green means the owned server and both workers were verified. Click once to start or to request a graceful stop. Do not use the original shortcut for T8.

The startup checks the exact T8 port, database, project registry, backup directory, Worker locks, process ancestry and executable/start identity. It rejects an unowned listener or ambiguous state. A stop is sent only through the controller's authenticated named pipe after checking that no task is running or queued. If a child fails to stop, its process is preserved for inspection; the desktop controller does not kill it.

## Diagnostics and recovery

From `C:\SWM\awt8`:

```powershell
node --no-warnings desktop-control/control.mjs status
node --no-warnings desktop-control/control.mjs stop
node --no-warnings desktop-control/control.mjs recover
```

`status` returns `ON`, `OFF`, `UNMANAGED` or `UNKNOWN`. Never start or stop from `UNKNOWN`. Read `data\desktop-manager.stderr.log`, `data\desktop-control.log` and `data\desktop-control-events.jsonl` first. The event log records process identities, exit codes, timestamps, normal stop requests and exceptions. Query the T8 database read only to check active tasks and workers. `recover` takes an exclusive transition lock, rechecks the exact saved identities, port, worker state and active tasks, reserves the T8 loopback port against competing launches, then atomically archives a stale state file as `data\desktop-control-stale-*.json`. It refuses recovery if ownership cannot be established. It does not delete the database or kill a process.

One unexpected server or worker exit is recorded and retried. A second exit of the same child within five minutes is recorded as `repeated-unexpected-exit`; the T8 launcher stops and exits nonzero. Investigate the failure before clicking the shortcut again.

To remove the test shortcut later, first stop the T8 instance, confirm `OFF`, inspect the shortcut target and remove only that test shortcut. The untouched original shortcut and its backup remain available.

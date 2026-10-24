const fs = require('node:fs');
const path = require('node:path');

// MXC assigns a private TEMP beneath the user's home. The verification profile
// denies that home directory, so redirect tool caches into the isolated worktree.
const directory = path.join(process.cwd(), '.workspace-check-tmp');
fs.mkdirSync(directory, { recursive: true });
const actual = fs.realpathSync.native(directory);
const expected = path.join(fs.realpathSync.native(process.cwd()), '.workspace-check-tmp');
if (process.platform === 'win32' ? actual.toLowerCase() !== expected.toLowerCase() : actual !== expected)
  throw new Error('Verification temporary directory escapes the task worktree');
process.env.TEMP = directory;
process.env.TMP = directory;
process.env.TMPDIR = directory;

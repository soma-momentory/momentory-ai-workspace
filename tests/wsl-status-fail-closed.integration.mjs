import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {root} from '../src/config.mjs';
import {activeWslCodexForWorktree} from '../src/wslCodex.mjs';

if(process.platform!=='win32')throw new Error('Windows WSL required');
const cwd=path.resolve('../ai-dev-workspace-sample'),dir=path.join(root,'data','codex-processes');
fs.mkdirSync(dir,{recursive:true});
const metadata=path.join(dir,`${process.pid}-${randomUUID()}.pid.json`);
fs.writeFileSync(metadata,JSON.stringify({cwd,distro:'NoSuchWorkspaceDistro',unit:'ai-dev-workspace-unreachable.scope',owner:process.pid}));
try{
  assert.ok(activeWslCodexForWorktree(cwd).includes('ai-dev-workspace-unreachable.scope'),'Unknown WSL state must block duplicate execution');
  console.log(JSON.stringify({status:'PASS',unreachableDistroBlocksResume:true}));
}finally{fs.rmSync(metadata,{force:true});}

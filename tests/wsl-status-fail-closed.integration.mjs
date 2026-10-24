import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {root} from '../src/config.mjs';
import {activeWslCodexForWorktree} from '../src/wslCodex.mjs';

if(process.platform!=='win32')throw new Error('Windows WSL required');
const cwd=path.resolve('../ai-dev-workspace-sample'),dir=path.join(root,'data','codex-processes');
fs.mkdirSync(dir,{recursive:true});
const id=randomUUID(),unit=`ai-dev-workspace-${id}.scope`,metadata=path.join(dir,`${process.pid}-${id}.pid.json`);
const malformed=path.join(dir,`${process.pid}-${randomUUID()}.pid.json`);
fs.writeFileSync(metadata,JSON.stringify({cwd,distro:'NoSuchWorkspaceDistro',unit,owner:process.pid}));
fs.writeFileSync(malformed,'{}');
try{
  assert.ok(activeWslCodexForWorktree(cwd).includes(unit),'Unknown WSL state must block duplicate execution');
  assert.ok(activeWslCodexForWorktree(cwd).includes(path.basename(malformed)),'Incomplete but valid JSON metadata must fail closed');
  console.log(JSON.stringify({status:'PASS',unreachableDistroBlocksResume:true,malformedMetadataBlocksResume:true}));
}finally{fs.rmSync(metadata,{force:true});fs.rmSync(malformed,{force:true});}

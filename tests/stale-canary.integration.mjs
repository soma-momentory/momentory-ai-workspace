import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {root} from '../src/config.mjs';
import {cleanupStaleBoundaryCanaries} from '../src/wslChecks.mjs';

const dir=path.join(root,'data',`stale-canary-${randomUUID()}`);fs.mkdirSync(dir);
try{
  const name=`.workspace-setup-${randomUUID()}`,target=path.join(dir,name);
  fs.writeFileSync(target,'ALLOWED_SETUP');
  assert.deepEqual(cleanupStaleBoundaryCanaries(dir),[name]);
  assert.equal(fs.existsSync(target),false);
  fs.writeFileSync(target,'USER_DATA');
  assert.throws(()=>cleanupStaleBoundaryCanaries(dir),/Unreviewed boundary canary/);
  assert.equal(fs.readFileSync(target,'utf8'),'USER_DATA');
  console.log(JSON.stringify({status:'PASS',knownInterruptedProbeRemoved:true,unknownContentPreserved:true}));
}finally{if(path.resolve(dir).startsWith(path.join(root,'data')+path.sep))fs.rmSync(dir,{recursive:true,force:true});}

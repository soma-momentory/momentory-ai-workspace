import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {root} from '../src/config.mjs';
import {runWslCheck} from '../src/wslChecks.mjs';

if(process.platform!=='win32')throw new Error('Windows WSL2 required');
const cwd=path.resolve('../ai-dev-workspace-sample'),id=randomUUID();
const inside=path.join(cwd,`check-allowed-${id}.txt`),outside=path.join(root,'data',`check-denied-${id}.txt`);
const toLinux=file=>'/mnt/'+file[0].toLowerCase()+file.slice(2).replaceAll('\\','/');
fs.writeFileSync(inside,'ALLOWED_CHECK');fs.writeFileSync(outside,'DENIED_CHECK');
try{
  const read=async file=>runWslCheck(cwd,'node',['-e','process.stdout.write(require("node:fs").readFileSync(process.argv[1],"utf8"))',toLinux(file)],30000);
  const allowed=await read(inside),denied=await read(outside);
  assert.equal(allowed.ok,true,allowed.output);assert.match(allowed.output,/ALLOWED_CHECK/);
  assert.equal(denied.ok,false,'Check command read a file outside its worktree');
  assert.doesNotMatch(denied.output,/DENIED_CHECK/);
  console.log(JSON.stringify({status:'PASS',allowedRead:true,outsideReadDenied:true}));
}finally{fs.rmSync(inside,{force:true});fs.rmSync(outside,{force:true});}

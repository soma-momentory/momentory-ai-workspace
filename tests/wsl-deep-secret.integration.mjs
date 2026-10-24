import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {wslCodexConfig,wslTrustedCommandLaunch,asynchronousProbe} from '../src/wslCodex.mjs';

if(process.platform!=='win32')throw new Error('Windows WSL is required');
const cwd=path.resolve('../ai-dev-workspace-sample'),base=path.join(cwd,`workspace-secret-probe-${randomUUID()}`);
assert.ok(path.resolve(base).startsWith(path.resolve(cwd)+path.sep));
const depth=Number(process.env.WORKSPACE_SECRET_DEPTH||10);
assert.ok(Number.isInteger(depth)&&depth>=1&&depth<=64);
const dir=path.join(base,...Array.from({length:depth},(_,index)=>`level${index}`));
fs.mkdirSync(dir,{recursive:true});
const secret=path.join(dir,'.env.local');
fs.writeFileSync(secret,'DEEP_SECRET_CANARY');
try{
  if(depth>=24){
    assert.throws(()=>wslCodexConfig(cwd),/path depth exceeds/,'A path beyond the audited glob depth must block the task');
    console.log(JSON.stringify({status:'PASS',depth,executionBlocked:true}));
  }else{
    const config=wslCodexConfig(cwd),relative=path.relative(cwd,secret).replaceAll('\\','/');
    const args=['/usr/bin/env',`CODEX_HOME=${config.codexHome}`,config.binary,'sandbox','-p',config.profile,'-P',config.permission,'-C',config.worktree,'--','/bin/cat',`${config.worktree}/${relative}`];
    const result=await asynchronousProbe(wslTrustedCommandLaunch(cwd,args),60000);
    assert.notEqual(result.status,0,'A deeply nested secret file was readable');
    assert.ok(!result.stdout.includes('DEEP_SECRET_CANARY'),'Secret canary escaped');
    console.log(JSON.stringify({status:'PASS',depth,secretReadDenied:true}));
  }
}finally{fs.rmSync(base,{recursive:true,force:true});}

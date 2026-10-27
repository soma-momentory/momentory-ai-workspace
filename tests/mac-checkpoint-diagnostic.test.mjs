import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
import {trackMacProcess,stopTree} from '../src/provider.mjs';import {root} from '../src/config.mjs';
test('macOS checkpoint write failure kills the child, fails closed and retains its cause',{skip:process.platform!=='darwin'},async t=>{
 const child=spawn('/bin/sleep',['30'],{detached:true,stdio:'ignore'}),ended=new Promise(r=>child.once('exit',(code,signal)=>r({code,signal})));const tracker=trackMacProcess(child,root),original=fs.renameSync;
 const patch=t.mock.method(fs,'renameSync',(from,to)=>{if(String(from).startsWith(path.join(root,'data','mac-processes',`${process.pid}-`)))throw Object.assign(new Error('Injected checkpoint rename failure'),{code:'EIO'});return original(from,to);});
 try{const outcome=await ended;patch.mock.restore();assert.equal(outcome.signal,'SIGKILL');assert.equal(tracker.finish(),false);assert.match(tracker.failureReason(),/EIO.*Injected checkpoint rename failure/);assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});}
 finally{patch.mock.restore();stopTree(child,'SIGKILL');const dir=path.join(root,'data','mac-processes');for(const f of fs.readdirSync(dir))if(f.startsWith(`${process.pid}-`)&&f.endsWith('.tmp'))fs.rmSync(path.join(dir,f));}
});

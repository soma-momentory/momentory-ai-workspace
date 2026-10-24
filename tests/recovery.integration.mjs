import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {Store} from '../src/store.mjs';

const root=path.resolve(import.meta.dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-recovery-'));
const port=await new Promise(resolve=>{const socket=net.createServer();socket.listen(0,'127.0.0.1',()=>{const value=socket.address().port;socket.close(()=>resolve(value));});});
const token=randomBytes(32).toString('hex'),workerToken=randomBytes(32).toString('hex'),base=`http://127.0.0.1:${port}`;
const env={...process.env,WORKSPACE_PORT:String(port),WORKSPACE_TOKEN:token,WORKER_TOKEN:workerToken,WORKSPACE_DATA_FILE:path.join(dir,'workspace.sqlite')};
let server=null,cookie='';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function start(){server=spawn(process.execPath,['src/server.mjs'],{cwd:root,env,stdio:'ignore'});for(let i=0;i<60;i++){try{if((await fetch(base)).ok)return;}catch{}await delay(100);}throw new Error('Server did not start');}
async function stop(){if(!server)return;const child=server;server=null;const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
async function api(route,method='GET',value,worker=false){const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(worker?{Authorization:`Bearer ${workerToken}`}:{Origin:base,Cookie:cookie})},body:value===undefined?undefined:JSON.stringify(value)});return {status:response.status,body:await response.json()};}
async function create(goal){const result=await api('/api/tasks','POST',{projectId:'sample',repo:'app',goal,provider:'codex',mode:'FAST'});assert.equal(result.status,201);return result.body.task;}
try{
  await start();const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({token})});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
  const first=await create('Fix the sample project function and verify the result');
  const oldClaim=(await api('/api/worker/claim','POST',{id:'codex-slot',capabilities:['sample:app'],provider:'codex'},true)).body.task;assert.equal(oldClaim.id,first.id);
  await stop();let db=new Store(env.WORKSPACE_DATA_FILE);db.db.prepare('UPDATE tasks SET lease_until=0 WHERE id=?').run(first.id);db.close();
  await start();let recovered=null;for(let i=0;i<80;i++){recovered=(await api(`/api/tasks/${first.id}`)).body.task;if(recovered.status==='QUEUED')break;await delay(100);}assert.equal(recovered.status,'QUEUED');
  const newClaim=(await api('/api/worker/claim','POST',{id:'codex-slot',capabilities:['sample:app'],provider:'codex'},true)).body.task;assert.equal(newClaim.id,first.id);assert.notEqual(newClaim.lease_nonce,oldClaim.lease_nonce);
  assert.equal((await api('/api/worker/complete','POST',{id:'codex-slot',taskId:first.id,leaseNonce:oldClaim.lease_nonce,status:'FAILED'},true)).status,409);
  assert.equal((await api('/api/worker/complete','POST',{id:'codex-slot',taskId:first.id,leaseNonce:newClaim.lease_nonce,status:'UNVERIFIED',verification:{ok:false}},true)).status,200);

  const second=await create('Inspect a saved sample worktree after an interrupted run');
  const savedClaim=(await api('/api/worker/claim','POST',{id:'codex-slot',capabilities:['sample:app'],provider:'codex'},true)).body.task;assert.equal(savedClaim.id,second.id);
  assert.equal((await api('/api/worker/patch','POST',{id:'codex-slot',taskId:second.id,leaseNonce:savedClaim.lease_nonce,fields:{worktree:path.join(dir,'preserved-worktree'),base_head:'fixture'}},true)).status,200);
  await stop();db=new Store(env.WORKSPACE_DATA_FILE);db.db.prepare('UPDATE tasks SET lease_until=0 WHERE id=?').run(second.id);db.close();
  await start();let stale=null;for(let i=0;i<80;i++){stale=(await api(`/api/tasks/${second.id}`)).body.task;if(stale.status==='STALE')break;await delay(100);}assert.equal(stale.status,'STALE');
  assert.equal((await api('/api/worker/claim','POST',{id:'codex-slot',capabilities:['sample:app'],provider:'codex'},true)).body.task,null);
  console.log(JSON.stringify({status:'PASS',firstTask:first.id,oldNonceRejected:true,newNonceAccepted:true,secondTask:second.id,preservedStatus:stale.status}));
}finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}

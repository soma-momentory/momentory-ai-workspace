import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';

const root=path.resolve(import.meta.dirname,'..'),port=await new Promise(resolve=>{const socket=net.createServer();socket.listen(0,'127.0.0.1',()=>{const value=socket.address().port;socket.close(()=>resolve(value));});});
const token=randomBytes(32).toString('hex'),workerToken=randomBytes(32).toString('hex'),db=path.join(root,'data',`pause-${randomUUID()}.sqlite`),base=`http://127.0.0.1:${port}`;
const env={...process.env,WORKSPACE_PORT:String(port),WORKSPACE_TOKEN:token,WORKER_TOKEN:workerToken,WORKSPACE_DATA_FILE:db,WORKER_SLOT:'codex',WORKER_ID:`pause-${randomUUID()}`};
const server=spawn(process.execPath,['src/server.mjs'],{cwd:root,env,stdio:'ignore'}),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let worker=null,cookie='';
async function api(route,method='GET',value){const response=await fetch(base+route,{method,headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:value===undefined?undefined:JSON.stringify(value)});const body=await response.json();assert.ok(response.ok,`${route}: ${response.status} ${JSON.stringify(body)}`);return body;}
try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,'Server did not start');
  const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({token})});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
  const created=await api('/api/tasks','POST',{projectId:'sample',repo:'app',goal:'Add a passing edge-case test for greeting when the name is empty, preserving the existing behavior.',provider:'codex',mode:'FAST'}),task=created.task;
  worker=spawn(process.execPath,['src/worker.mjs'],{cwd:root,env,stdio:['ignore','ignore','ignore','ipc']});
  let started=false;for(let i=0;i<1200;i++){await delay(100);const detail=await api(`/api/tasks/${task.id}`);if(detail.events.some(event=>event.kind==='provider_started')){started=true;break;}if(['AWAITING_APPROVAL','FAILED','UNVERIFIED'].includes(detail.task.status))break;}
  assert.ok(started,'Provider finished before pause request');
  await api(`/api/tasks/${task.id}/control`,'POST',{action:'pause'});
  let paused=null;for(let i=0;i<300;i++){await delay(100);paused=(await api(`/api/tasks/${task.id}`)).task;if(paused.status==='PAUSED')break;}
  assert.equal(paused.status,'PAUSED');assert.equal(paused.attempts,1);
  assert.equal((await api(`/api/tasks/${task.id}/control`,'POST',{action:'resume'})).task.status,'QUEUED');
  let result=null;for(let i=0;i<900;i++){await delay(1000);result=(await api(`/api/tasks/${task.id}`)).task;if(['AWAITING_APPROVAL','FAILED','UNVERIFIED','STALE'].includes(result.status))break;}
  assert.equal(result.status,'AWAITING_APPROVAL',JSON.stringify(result.verification));assert.equal(result.attempts,2);assert.equal(result.verification.ok,true);
  console.log(JSON.stringify({status:'PASS',taskId:task.id,attempts:result.attempts,worktree:result.worktree,changedFiles:result.result.diff.changedFiles,database:db}));
}finally{
  if(worker){const exit=new Promise(resolve=>worker.once('exit',resolve));worker.send('stop');await Promise.race([exit,delay(30000)]);if(worker.exitCode===null)worker.kill();}
  const exit=new Promise(resolve=>server.once('exit',resolve));server.kill();await exit;
}

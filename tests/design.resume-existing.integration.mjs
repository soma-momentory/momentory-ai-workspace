import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {Store} from '../src/store.mjs';

const dbFile=process.env.WORKSPACE_TEST_RESUME_DB;
assert.ok(dbFile&&path.resolve(dbFile).startsWith(path.resolve(import.meta.dirname,'..','data')+path.sep),'Pass an existing test database under Workspace data');
const store=new Store(dbFile),task=store.listTasks().find(item=>item.design_candidate_id&&item.status==='UNVERIFIED');store.close();
assert.ok(task?.worktree&&task.worktree_host,'An interrupted isolated design task is required');
const root=path.resolve(import.meta.dirname,'..'),port=await new Promise(resolve=>{const socket=net.createServer();socket.listen(0,'127.0.0.1',()=>{const value=socket.address().port;socket.close(()=>resolve(value));});});
const base=`http://127.0.0.1:${port}`,token=randomBytes(32).toString('hex'),workerToken=randomBytes(32).toString('hex');
const env={...process.env,WORKSPACE_PORT:String(port),WORKSPACE_TOKEN:token,WORKER_TOKEN:workerToken,WORKSPACE_DATA_FILE:dbFile,WORKER_ID:task.worktree_host,WORKER_SLOT:'codex'};
const server=spawn(process.execPath,['src/server.mjs'],{cwd:root,env,stdio:'ignore'});let worker=null,cookie='';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(route,method='GET',body){const response=await fetch(base+route,{method,headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();return {status:response.status,body:value};}
try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,'Server unavailable');
  const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({token})});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
  const before=(await api(`/api/tasks/${task.id}`)).body;
  assert.ok(before.recovery?.hash&&before.recovery.changedFiles.includes('src/design/studioApproved.json'));
  assert.equal((await api(`/api/tasks/${task.id}/control`,'POST',{action:'resume'})).status,409,'Unverified partial apply must require review');
  assert.equal((await api(`/api/tasks/${task.id}/control`,'POST',{action:'resume',reviewedDiffHash:before.recovery.hash})).status,200);
  worker=spawn(process.execPath,['src/worker.mjs'],{cwd:root,env,stdio:['ignore','pipe','pipe','ipc']});
  let logs='';for(const stream of [worker.stdout,worker.stderr])stream.on('data',chunk=>logs=(logs+chunk.toString()).slice(-12000));
  let result=null;for(let i=0;i<1800;i++){await delay(1000);const current=(await api(`/api/tasks/${task.id}`)).body.task;if(['AWAITING_APPROVAL','FAILED','UNVERIFIED','STALE'].includes(current.status)){result=current;break;}}
  assert.ok(result,`Timed out: ${logs}`);assert.equal(result.status,'AWAITING_APPROVAL',JSON.stringify({result:result.result,verification:result.verification,logs}));
  assert.equal(result.result.checksChangedSource,false);
  assert.ok(result.result.diff.changedFiles.includes('src/design/studioApproved.json'));
  console.log(JSON.stringify({status:'PASS',taskId:task.id,attempts:result.attempts,checks:result.verification.checks.map(x=>({command:x.command,ok:x.ok})),changedFiles:result.result.diff.changedFiles}));
}finally{if(worker){const exited=new Promise(resolve=>worker.once('exit',resolve));worker.send('stop');await Promise.race([exited,delay(30000)]);if(worker.exitCode===null)worker.kill();}const exited=new Promise(resolve=>server.once('exit',resolve));server.kill();await exited;}

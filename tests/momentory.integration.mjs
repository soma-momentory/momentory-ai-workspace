import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {backupFixture} from './backup-fixture.mjs';
const root=path.resolve(import.meta.dirname,'..'),run=randomUUID();
const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolve(value));});});
const token=randomBytes(32).toString('hex'),workerToken=randomBytes(32).toString('hex'),base=`http://127.0.0.1:${port}`;
const db=path.join(root,'data',`momentory-${run}.sqlite`);
const child=spawn(process.execPath,['src/local.mjs'],{cwd:root,env:{...process.env,WORKSPACE_PORT:String(port),WORKSPACE_TOKEN:token,WORKER_TOKEN:workerToken,WORKSPACE_DATA_FILE:db,...backupFixture(db,token,workerToken)},stdio:['ignore','pipe','pipe','ipc']});
let logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>logs=(logs+chunk.toString()).slice(-16000));
let cookie='';const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(route,method='GET',value){const response=await fetch(base+route,{method,headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:value===undefined?undefined:JSON.stringify(value)});const body=await response.json();assert.ok(response.ok,`${route} ${response.status} ${JSON.stringify(body)}`);return {body,response};}
try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await delay(250);}assert.ok(ready,logs);
  const login=await api('/api/login','POST',{token});cookie=login.response.headers.get('set-cookie').split(';')[0];
  const task=(await api('/api/tasks','POST',{projectId:'momentory',repo:'fe',provider:'codex',mode:'FAST',maxAttempts:1,goal:'Create docs/AI_WORKSPACE_INTEGRATION.md explaining how the existing Expo Lab Studio JSON export is validated and how a reviewable design change reaches the FE source. Do not modify runtime code or protected paths.',completionCriteria:'The integration document exists; FE typecheck, lint and Jest pass.'})).body.task;
  let result=null;for(let i=0;i<900;i++){await delay(1000);const current=(await api(`/api/tasks/${task.id}`)).body.task;if(['AWAITING_APPROVAL','FAILED','UNVERIFIED','STALE'].includes(current.status)){result=current;break;}}
  assert.ok(result,`Timed out: ${logs}`);
  console.log(JSON.stringify({status:result.status,taskId:task.id,worktree:result.worktree,changedFiles:result.result?.diff?.changedFiles,verification:result.verification,logTail:result.status==='AWAITING_APPROVAL'?undefined:logs.slice(-5000)},null,2));
  assert.equal(result.status,'AWAITING_APPROVAL','Momentory FE task did not pass full verification');
}finally{const exited=new Promise(resolve=>child.once('exit',resolve));child.send('stop');await Promise.race([exited,delay(35000)]);if(child.exitCode===null)child.kill();}

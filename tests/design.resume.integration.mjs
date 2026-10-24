import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {Store} from '../src/store.mjs';
const root=path.resolve(import.meta.dirname,'..'),db=path.resolve(process.argv[2]||'');
if(!db.startsWith(path.join(root,'data')+path.sep)||!/design-pipeline-[0-9a-f-]+\.sqlite$/.test(path.basename(db)))throw new Error('Pass an existing design pipeline database under workspace data/');
const store=new Store(db),task=store.listTasks('momentory').find(item=>item.design_candidate_id&&item.status==='UNVERIFIED');store.close();
if(!task||!task.worktree)throw new Error('No resumable design task with a preserved worktree');
const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolve(value));});});
const token=randomBytes(32).toString('hex'),workerToken=randomBytes(32).toString('hex'),base=`http://127.0.0.1:${port}`,env={...process.env,WORKSPACE_PORT:String(port),WORKSPACE_TOKEN:token,WORKER_TOKEN:workerToken,WORKSPACE_DATA_FILE:db};
const server=spawn(process.execPath,['src/server.mjs'],{cwd:root,env,stdio:['ignore','pipe','pipe']}),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let worker=null,cookie='',logs='';for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>logs=(logs+chunk.toString()).slice(-8000));
async function api(route,method='GET',value){const response=await fetch(base+route,{method,headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:value===undefined?undefined:JSON.stringify(value)});const body=await response.json();assert.ok(response.ok,`${route} ${response.status} ${JSON.stringify(body)}`);return {body,response};}
try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await delay(250);}assert.ok(ready,logs);
  const login=await api('/api/login','POST',{token});cookie=login.response.headers.get('set-cookie').split(';')[0];
  assert.equal((await api(`/api/tasks/${task.id}/control`,'POST',{action:'resume'})).body.task.status,'QUEUED');
  worker=spawn(process.execPath,['src/worker.mjs'],{cwd:root,env:{...env,WORKER_SLOT:'codex'},stdio:['ignore','pipe','pipe','ipc']});for(const stream of [worker.stdout,worker.stderr])stream.on('data',chunk=>logs=(logs+chunk.toString()).slice(-8000));
  let result=null;for(let i=0;i<1200;i++){await delay(1000);const current=(await api(`/api/tasks/${task.id}`)).body.task;if(['AWAITING_APPROVAL','FAILED','UNVERIFIED','STALE'].includes(current.status)){result=current;break;}}
  assert.ok(result,`Timed out: ${logs}`);assert.equal(result.status,'AWAITING_APPROVAL',JSON.stringify({verification:result.verification,logs:logs.slice(-1000)}));
  console.log(JSON.stringify({status:'PASS',taskId:task.id,attempts:result.attempts,changedFiles:result.result.diff.changedFiles,checks:result.verification.checks.map(check=>({command:check.command,ok:check.ok}))},null,2));
}finally{if(worker){const exited=new Promise(resolve=>worker.once('exit',resolve));worker.send('stop');await Promise.race([exited,delay(30000)]);if(worker.exitCode===null)worker.kill();}const exited=new Promise(resolve=>server.once('exit',resolve));server.kill();await exited;}

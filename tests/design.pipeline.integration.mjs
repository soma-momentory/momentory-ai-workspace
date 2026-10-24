import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {repository} from '../src/projects.mjs';
const root=path.resolve(import.meta.dirname,'..'),port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolve(value));});});
const token=randomBytes(32).toString('hex'),workerToken=randomBytes(32).toString('hex'),base=`http://127.0.0.1:${port}`;
const env={...process.env,WORKSPACE_PORT:String(port),WORKSPACE_TOKEN:token,WORKER_TOKEN:workerToken,WORKSPACE_DATA_FILE:path.join(root,'data',`design-pipeline-${randomUUID()}.sqlite`)};
const server=spawn(process.execPath,['src/server.mjs'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
let worker=null,cookie='',logs='';for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>logs=(logs+chunk.toString()).slice(-12000));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(route,method='GET',value,asWorker=false){const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(asWorker?{Authorization:`Bearer ${workerToken}`}:{Origin:base,Cookie:cookie})},body:value===undefined?undefined:JSON.stringify(value)});const body=await response.json();assert.ok(response.ok,`${route} ${response.status} ${JSON.stringify(body)}`);return {body,response};}
try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await delay(250);}assert.ok(ready,logs);
  const login=await api('/api/login','POST',{token});cookie=login.response.headers.get('set-cookie').split(';')[0];
  const task=(await api('/api/tasks','POST',{projectId:'momentory',repo:'fe',mode:'EXPLORE',goal:'Compare a rounded hero card layout in the Momentory home screen',maxAttempts:1})).body.task;
  const approved=JSON.parse(fs.readFileSync(path.join(repository('momentory','fe').path,'src','design','studioApproved.json'),'utf8'));
  const upload=(await api(`/api/tasks/${task.id}/candidates`,'POST',{exported:{version:1,name:'Rounded hero',design:{...approved,'home.hero.borderRadius':22}},screen:'home-main'})).body;
  assert.ok(upload.candidate.screenshot,upload.captureError);
  const claimed=(await api('/api/worker/claim','POST',{id:'design-fixture',capabilities:['momentory:fe']},true)).body.task;assert.equal(claimed.id,task.id);
  const generated=(await api('/api/worker/candidate','POST',{id:'design-fixture',taskId:task.id,leaseNonce:claimed.lease_nonce,provider:'claude',proposal:{name:'Generated editable hero',screen:'home-main',studioPatch:{'home.hero.borderRadius':23},exported:{version:1,name:'Generated editable hero',design:{...approved,'home.hero.borderRadius':23}}}},true)).body;
  assert.equal(generated.rendered,true,'Worker-generated Studio candidate must render before selection');
  await api('/api/worker/complete','POST',{id:'design-fixture',taskId:task.id,leaseNonce:claimed.lease_nonce,status:'AWAITING_DESIGN_SELECTION',result:{fixture:'Studio export supplied by user'},verification:{ok:false}},true);
  const decision=(await api(`/api/tasks/${task.id}`)).body.decisions[0];
  const selected=(await api(`/api/decisions/${decision.id}`,'POST',{status:'APPROVED',selectedCandidateId:generated.id,rationale:'The generated 23px version is visually calmer in the matched screenshots.'})).body;
  assert.equal(selected.task.status,'SELECTED');assert.ok(selected.followup?.id);
  worker=spawn(process.execPath,['src/worker.mjs'],{cwd:root,env:{...env,WORKER_SLOT:'codex'},stdio:['ignore','pipe','pipe','ipc']});for(const stream of [worker.stdout,worker.stderr])stream.on('data',chunk=>logs=(logs+chunk.toString()).slice(-12000));
  let result=null;for(let i=0;i<900;i++){await delay(1000);const current=(await api(`/api/tasks/${selected.followup.id}`)).body.task;if(['AWAITING_APPROVAL','FAILED','UNVERIFIED','STALE'].includes(current.status)){result=current;break;}}
  assert.ok(result,`Timed out: ${logs}`);assert.equal(result.status,'AWAITING_APPROVAL',JSON.stringify({result:result.result,verification:result.verification,logs}));
  assert.ok(result.result.diff.changedFiles.includes('src/design/studioApproved.json'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.worktree,'src','design','studioApproved.json'),'utf8'))['home.hero.borderRadius'],23);
  assert.equal(JSON.parse(fs.readFileSync(path.join(repository('momentory','fe').path,'src','design','studioApproved.json'),'utf8'))['home.hero.borderRadius'],16);
  console.log(JSON.stringify({status:'PASS',taskId:task.id,applyTaskId:result.id,candidateId:generated.id,uploadedCandidateId:upload.candidate.id,changedFiles:result.result.diff.changedFiles,checks:result.verification.checks.map(x=>({command:x.command,ok:x.ok}))},null,2));
}finally{if(worker){const exited=new Promise(resolve=>worker.once('exit',resolve));worker.send('stop');await Promise.race([exited,delay(30000)]);if(worker.exitCode===null)worker.kill();}const exited=new Promise(resolve=>server.once('exit',resolve));server.kill();await exited;}

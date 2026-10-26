import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import http from 'node:http';

async function freePort(){return new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}
test('HTTP auth, task API, duplicate claim, bounded retry and approval',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'momentory-http-'));
  const port=await freePort(),token=randomBytes(32).toString('hex'),workerToken=randomBytes(32).toString('hex');
  const child=spawn(process.execPath,['src/server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,WORKSPACE_PORT:String(port),WORKSPACE_TOKEN:token,WORKER_TOKEN:workerToken,WORKSPACE_PUBLIC_URL:'https://laptop.tail.ts.net',WORKSPACE_DATA_FILE:path.join(dir,'db.sqlite')},stdio:'ignore'});
  const base=`http://127.0.0.1:${port}`;
  let cookie='';
  async function request(url,method='GET',value,worker=false){const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(worker?{Authorization:`Bearer ${workerToken}`}:{Cookie:cookie,Origin:base})},body:value?JSON.stringify(value):undefined});return {status:response.status,body:await response.json(),headers:response.headers};}
  try {
    let ready=false;for(let i=0;i<40;i++){try{const r=await request('/api/session');if(r.status===401){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
    assert.ok(ready,'server started');
    assert.equal((await request('/api/overview')).status,401);
    assert.equal((await request('/api/tasks/12345678-1234-1234-1234-123456789abc')).status,401);
    assert.equal((await request('/api/candidates/12345678-1234-1234-1234-123456789abc/candidate.png')).status,401);
    assert.equal((await request('/api/worker/claim','POST',{id:'unauthorized',capabilities:['momentory:fe'],provider:'codex'})).status,401);
    const forged=await fetch(base+'/api/login',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({token})});assert.equal(forged.status,403);
    const rebound=await new Promise((resolve,reject)=>{const request=http.get({hostname:'127.0.0.1',port,path:'/api/session',headers:{Host:'evil.example'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);});assert.equal(rebound,403);
    assert.equal((await request('/api/login','POST',{token:'wrong'})).status,401);
    const login=await request('/api/login','POST',{token});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
    assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
    const crossOrigin=await fetch(base+'/api/tasks',{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({goal:'Attempt unauthorized task',repo:'fe'})});assert.equal(crossOrigin.status,403);
    const noOrigin=await fetch(base+'/api/tasks',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({goal:'Attempt unauthorized task',repo:'fe'})});assert.equal(noOrigin.status,403);
    assert.equal((await request('/api/worker/claim','POST',{id:'browser',capabilities:['momentory:fe'],provider:'codex'})).status,401);
    const remoteLogin=await fetch(base+'/api/login',{method:'POST',headers:{Origin:'https://laptop.tail.ts.net','Content-Type':'application/json'},body:JSON.stringify({token})});assert.equal(remoteLogin.status,200);assert.match(remoteLogin.headers.get('set-cookie'),/; Secure/);
    const task=(await request('/api/tasks','POST',{goal:'Improve the home screen card layout',repo:'fe',mode:'FAST'})).body.task;
    assert.equal(task.status,'QUEUED');
    assert.equal((await request('/api/tasks','POST',{projectId:'sample',goal:'Try a cross project dependency',repo:'app',dependsOn:[task.id]})).status,400);
    assert.equal((await request('/api/worker/claim','POST',{id:'test-worker',capabilities:['momentory:fe']},true)).status,400);
    assert.equal((await request('/api/worker/claim','POST',{id:'test-worker',capabilities:['momentory:fe'],provider:'claudee'},true)).status,400);
    const claimed=(await request('/api/worker/claim','POST',{id:'test-worker',capabilities:['momentory:fe'],provider:task.provider},true)).body.task;
    assert.equal(claimed.id,task.id);
    assert.equal((await request('/api/worker/claim','POST',{id:'other',capabilities:['momentory:fe'],provider:task.provider},true)).body.task,null);
    assert.equal((await request('/api/worker/complete','POST',{id:'other',taskId:task.id,leaseNonce:claimed.lease_nonce,status:'AWAITING_APPROVAL'},true)).status,409);
    assert.equal((await request('/api/worker/complete','POST',{id:'test-worker',taskId:task.id,leaseNonce:'stale-generation',status:'AWAITING_APPROVAL'},true)).status,409);
    const complete=await request('/api/worker/complete','POST',{id:'test-worker',taskId:task.id,leaseNonce:claimed.lease_nonce,status:'AWAITING_APPROVAL',result:{diff:{changedFiles:['src/a.ts']}},verification:{ok:true}},true);
    assert.equal(complete.status,200);
    const detail=await request(`/api/tasks/${task.id}`);assert.equal(detail.body.decisions.length,1);
    const accepted=await request(`/api/decisions/${detail.body.decisions[0].id}`,'POST',{status:'APPROVED'});
    assert.equal(accepted.body.task.status,'APPROVED');
    assert.equal((await request(`/api/decisions/${detail.body.decisions[0].id}`,'POST',{status:'APPROVED'})).status,409);
    const risky=await request('/api/tasks','POST',{goal:'Deploy production changes after review',repo:'fe'});
    assert.equal(risky.body.task.status,'AWAITING_PREAPPROVAL');
    assert.equal((await request('/api/worker/claim','POST',{id:'test-worker',capabilities:['momentory:fe'],provider:task.provider},true)).body.task,null);
    const packet=(await request(`/api/tasks/${risky.body.task.id}`)).body.decisions[0];
    assert.equal(packet.kind,'risk');assert.ok(packet.details.options.length===2);
    assert.equal((await request(`/api/decisions/${packet.id}`,'POST',{status:'REJECTED'})).body.task.status,'REJECTED');
    const retry=(await request('/api/tasks','POST',{projectId:'sample',goal:'Fix a failing sample function with bounded retries',repo:'app',provider:'codex',mode:'FAST',maxAttempts:2})).body.task;
    const first=(await request('/api/worker/claim','POST',{id:'retry-worker',capabilities:['sample:app'],provider:'codex'},true)).body.task;assert.equal(first.id,retry.id);
    assert.equal((await request('/api/worker/complete','POST',{id:'retry-worker',taskId:retry.id,leaseNonce:first.lease_nonce,status:'FAILED',verification:{ok:false,reason:'same failure'}},true)).body.task.status,'QUEUED');
    const second=(await request('/api/worker/claim','POST',{id:'retry-worker',capabilities:['sample:app'],provider:'codex'},true)).body.task;assert.equal(second.id,retry.id);
    assert.notEqual(second.lease_nonce,first.lease_nonce);
    assert.equal((await request('/api/worker/complete','POST',{id:'retry-worker',taskId:retry.id,leaseNonce:second.lease_nonce,status:'FAILED',verification:{ok:false,reason:'same failure'}},true)).body.task.status,'FAILED');
    assert.equal((await request(`/api/tasks/${retry.id}`)).body.task.attempts,2);
  } finally {const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;fs.rmSync(dir,{recursive:true,force:true});}
});

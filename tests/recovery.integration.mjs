import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
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

  const requestId=randomUUID(),instruction='Preserve the partial result and prepare a reviewed correction';
  const initialFollowup=await api(`/api/tasks/${first.id}/followup`,'POST',{requestId,instruction});
  assert.equal(initialFollowup.status,201);
  const followupId=initialFollowup.body.task.id;
  assert.deepEqual(initialFollowup.body.task.dependsOn,[first.id],'An unverified parent must block its follow-up until approved');
  assert.match(initialFollowup.body.task.goal,/Fix the sample project function/,'Follow-up must carry the parent objective');
  const eventCursor=(await api(`/api/tasks/${first.id}`)).body.events.at(-1).id;
  await stop();await start();
  const replayed=await api(`/api/tasks/${first.id}/followup`,'POST',{requestId,instruction});
  assert.equal(replayed.status,200);assert.equal(replayed.body.task.id,followupId);assert.equal(replayed.body.deduplicated,true);
  assert.equal((await api(`/api/tasks/${first.id}/followup`,'POST',{requestId,instruction:'A different instruction'})).status,409);
  const after=(await api(`/api/tasks/${first.id}?after=${eventCursor}`)).body.events;
  assert.equal(after.filter(event=>event.kind==='followup_created').length,0,'Reconnection created a duplicate follow-up event');
  db=new Store(env.WORKSPACE_DATA_FILE);assert.equal(db.db.prepare('SELECT COUNT(*) AS total FROM followup_requests WHERE parent_task_id=? AND request_id=?').get(first.id,requestId).total,1);db.close();

  const second=await create('Inspect a saved sample worktree after an interrupted run');
  const savedClaim=(await api('/api/worker/claim','POST',{id:'codex-slot',capabilities:['sample:app'],provider:'codex'},true)).body.task;assert.equal(savedClaim.id,second.id);
  assert.equal((await api('/api/worker/patch','POST',{id:'codex-slot',taskId:second.id,leaseNonce:savedClaim.lease_nonce,fields:{worktree:path.join(dir,'preserved-worktree'),base_head:'fixture'}},true)).status,200);
  await stop();db=new Store(env.WORKSPACE_DATA_FILE);db.db.prepare('UPDATE tasks SET lease_until=0 WHERE id=?').run(second.id);db.close();
  await start();let stale=null;for(let i=0;i<80;i++){stale=(await api(`/api/tasks/${second.id}`)).body.task;if(stale.status==='STALE')break;await delay(100);}assert.equal(stale.status,'STALE');
  assert.equal((await api('/api/worker/claim','POST',{id:'codex-slot',capabilities:['sample:app'],provider:'codex'},true)).body.task,null);
  const editedParent=await create('Plan a queued sample improvement before execution');
  const editRequestId=randomUUID(),editInstruction='Prepare the edge-case implementation after approval';
  const beforeEdit=await api(`/api/tasks/${editedParent.id}/followup`,'POST',{requestId:editRequestId,instruction:editInstruction});
  assert.equal(beforeEdit.status,201);
  assert.equal((await api(`/api/tasks/${editedParent.id}`,'PATCH',{goal:'Plan a revised sample improvement before execution'})).status,200);
  const afterEdit=await api(`/api/tasks/${editedParent.id}/followup`,'POST',{requestId:editRequestId,instruction:editInstruction});
  assert.equal(afterEdit.status,200);assert.equal(afterEdit.body.task.id,beforeEdit.body.task.id);
  const stranded=await create('Recover an unverified partial edit only after diff review');
  const partialDir=path.join(dir,'partial-worktree');fs.mkdirSync(partialDir);
  const git=(...args)=>execFileSync('git',args,{cwd:partialDir,encoding:'utf8',windowsHide:true}).trim();
  git('init');fs.writeFileSync(path.join(partialDir,'index.mjs'),'export const value = 1;\n');git('add','.');git('-c','user.name=Workspace Test','-c','user.email=workspace@example.invalid','commit','-m','base');
  const baseHead=git('rev-parse','HEAD');fs.writeFileSync(path.join(partialDir,'index.mjs'),'export const value = 2;\n');
  db=new Store(env.WORKSPACE_DATA_FILE);db.patch(stranded.id,{status:'UNVERIFIED',worktree:partialDir,base_head:baseHead});db.close();
  const packet=(await api(`/api/tasks/${stranded.id}`)).body.recovery;assert.ok(packet?.hash&&packet.changedFiles.includes('index.mjs'));
  assert.equal((await api(`/api/tasks/${stranded.id}/control`,'POST',{action:'resume'})).status,409);
  assert.equal((await api(`/api/tasks/${stranded.id}/control`,'POST',{action:'resume',reviewedDiffHash:packet.hash})).status,200);
  db=new Store(env.WORKSPACE_DATA_FILE);db.patch(stranded.id,{status:'UNVERIFIED'});db.close();
  const large=path.join(partialDir,'large.bin');fs.writeFileSync(large,Buffer.alloc(33000,1));
  assert.match((await api(`/api/tasks/${stranded.id}`)).body.recovery.error,/hidden, truncated, binary/);
  assert.equal((await api(`/api/tasks/${stranded.id}/control`,'POST',{action:'resume',reviewedDiffHash:packet.hash})).status,409);
  fs.rmSync(large);
  fs.appendFileSync(path.join(partialDir,'.git','info','exclude'),'\nsecret-cache/\n');
  fs.mkdirSync(path.join(partialDir,'secret-cache'));fs.writeFileSync(path.join(partialDir,'secret-cache','hidden.txt'),'unreviewed ignored content');
  assert.match((await api(`/api/tasks/${stranded.id}`)).body.recovery.error,/Ignored worktree content needs local recovery/);
  assert.equal((await api(`/api/tasks/${stranded.id}/control`,'POST',{action:'resume',reviewedDiffHash:packet.hash})).status,409);
  console.log(JSON.stringify({status:'PASS',firstTask:first.id,oldNonceRejected:true,newNonceAccepted:true,followupAfterReconnect:followupId,duplicateFollowupPrevented:true,secondTask:second.id,preservedStatus:stale.status,opaqueRecoveryDenied:true,ignoredRecoveryDenied:true}));
}finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}

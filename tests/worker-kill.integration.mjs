import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {activeWslCodexForWorktree} from '../src/wslCodex.mjs';
import {activeMacProcessesForWorktree,reapStaleMacProcesses} from '../src/provider.mjs';

if(!['win32','darwin'].includes(process.platform))throw new Error('Windows WSL2 or macOS required');
const mac=process.platform==='darwin';
const root=path.resolve(import.meta.dirname,'..'),port=await new Promise(resolve=>{const socket=net.createServer();socket.listen(0,'127.0.0.1',()=>{const value=socket.address().port;socket.close(()=>resolve(value));});});
const token=randomBytes(32).toString('hex'),workerToken=randomBytes(32).toString('hex'),db=path.join(root,'data',`worker-kill-${randomUUID()}.sqlite`),base=`http://127.0.0.1:${port}`;
const env={...process.env,WORKSPACE_PORT:String(port),WORKSPACE_TOKEN:token,WORKER_TOKEN:workerToken,WORKSPACE_DATA_FILE:db,WORKER_SLOT:'codex',WORKER_ID:`worker-kill-${randomUUID()}`};
const server=spawn(process.execPath,['src/server.mjs'],{cwd:root,env,stdio:'ignore'}),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let worker=null,restarted=null,cookie='',workerLogs='';
async function api(route,method='GET',value){const response=await fetch(base+route,{method,headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:value===undefined?undefined:JSON.stringify(value)});const body=await response.json();assert.ok(response.ok,`${route}: ${response.status} ${JSON.stringify(body)}`);return body;}
try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,'Server did not start');
  const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({token})});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
  const created=await api('/api/tasks','POST',{projectId:'sample',repo:'app',goal:mac?'Run exactly /bin/sh ./crash-probe.sh and wait for it to exit before editing anything. This is a controlled worker crash test; do not read controlled.pids.':'Add a meaningful edge-case test for the sum function and implement the corresponding fix in the isolated sample project.',provider:'codex',mode:'FAST'}),task=created.task;
  worker=spawn(process.execPath,['src/worker.mjs'],{cwd:root,env,stdio:['ignore','pipe','pipe','ipc']});
  for(const stream of [worker.stdout,worker.stderr])stream.on('data',chunk=>workerLogs=(workerLogs+chunk.toString()).slice(-8000));
  let running=null,started=false;for(let i=0;i<1200;i++){await delay(100);const detail=await api(`/api/tasks/${task.id}`);running=detail.task;if(detail.events.some(event=>event.kind==='provider_started')){started=true;break;}if(['AWAITING_APPROVAL','FAILED','UNVERIFIED'].includes(running.status))break;}
  assert.ok(started,`Provider did not start before task ended: ${running?.status}; workerExit=${worker.exitCode}; ${workerLogs}`);assert.ok(running.worktree && fs.existsSync(running.worktree),'Worktree checkpoint missing');
  const markerDir=path.join(root,'data',mac?'mac-processes':'codex-processes');let marker=null,controlled=[];
  for(let i=0;i<600;i++){
    marker=fs.existsSync(markerDir)?fs.readdirSync(markerDir).find(name=>name.startsWith(`${worker.pid}-`)&&name.endsWith(mac?'.json':'.pid')):null;
    if(mac&&marker){const pids=path.join(running.worktree,'controlled.pids');if(fs.existsSync(pids)){controlled=fs.readFileSync(pids,'utf8').trim().split(/\s+/).map(Number);const record=JSON.parse(fs.readFileSync(path.join(markerDir,marker)));if(controlled.length===2&&controlled.every(pid=>record.processes.some(([tracked])=>tracked===pid)))break;}}
    else if(marker)break;
    await delay(100);
  }
  assert.ok(marker,'Durable child process checkpoint missing before crash injection');
  if(mac){
    assert.equal(controlled.length,2,'Controlled shell/sleep did not start');
    const record=JSON.parse(fs.readFileSync(path.join(markerDir,marker)));
    assert.ok(controlled.every(pid=>record.processes.some(([tracked])=>tracked===pid)),'Controlled descendants were not durably checkpointed');
    console.log(JSON.stringify({phase:'before-worker-SIGKILL',record}));
  }
  const partial=path.join(running.worktree,'partial-change.txt');fs.writeFileSync(partial,'PARTIAL_WRITE_BEFORE_WORKER_CRASH\n');
  const exited=new Promise(resolve=>worker.once('exit',resolve));
  if(mac)worker.kill('SIGKILL');else execFileSync('taskkill',['/PID',String(worker.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
  await Promise.race([exited,delay(5000)]);worker=null;
  if(mac){for(const pid of controlled)process.kill(pid,0);console.log(JSON.stringify({phase:'after-worker-SIGKILL',survivingControlled:controlled,marker}));}
  let stale=null;for(let i=0;i<400;i++){await delay(100);stale=(await api(`/api/tasks/${task.id}`)).task;if(stale.status==='STALE')break;}
  assert.equal(stale.status,'STALE');assert.equal(stale.attempts,1);
  assert.equal(fs.readFileSync(partial,'utf8'),'PARTIAL_WRITE_BEFORE_WORKER_CRASH\n');
  restarted=spawn(process.execPath,['src/worker.mjs'],{cwd:root,env,stdio:['ignore','ignore','ignore','ipc']});await delay(4000);
  const unchanged=(await api(`/api/tasks/${task.id}`)).task;assert.equal(unchanged.status,'STALE');assert.equal(unchanged.attempts,1);
  assert.equal(fs.existsSync(path.join(markerDir,marker)),false,'Restarted worker did not reap orphan Codex process');
  assert.deepEqual(mac?activeMacProcessesForWorktree(running.worktree):activeWslCodexForWorktree(running.worktree),[],'A stale process still blocks the worktree');
  if(mac)for(const pid of controlled){const state=execFileSync('/bin/ps',['-axo','pid=,stat='],{encoding:'utf8'}).split('\n').find(line=>Number(line.trim().split(/\s+/)[0])===pid);assert.ok(!state||state.trim().split(/\s+/)[1].startsWith('Z'),'Controlled child survived Worker restart cleanup');}
  console.log(JSON.stringify({status:'PASS',taskId:task.id,worktree:task.worktree||running.worktree,partialFilePreserved:true,orphanReaped:true,attempts:unchanged.attempts,recoveredStatus:unchanged.status,database:db}));
}finally{
  if(worker?.pid){try{if(mac)worker.kill('SIGKILL');else execFileSync('taskkill',['/PID',String(worker.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}
  if(restarted){const exit=new Promise(resolve=>restarted.once('exit',resolve));restarted.send('stop');await Promise.race([exit,delay(10000)]);if(restarted.exitCode===null)restarted.kill();}
  const exit=new Promise(resolve=>server.once('exit',resolve));server.kill();await exit;
  if(mac)reapStaleMacProcesses();
}

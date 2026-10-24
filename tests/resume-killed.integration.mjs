import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {Store} from '../src/store.mjs';

const root=path.resolve(import.meta.dirname,'..'),db=path.resolve(process.argv[2]||'');
if(!db.startsWith(path.join(root,'data')+path.sep)||!/worker-kill-[0-9a-f-]+\.sqlite$/.test(path.basename(db))||!fs.existsSync(db))throw new Error('Pass the database path printed by test:worker-kill');
const store=new Store(db),task=store.listTasks('sample').find(item=>item.status==='STALE'&&item.worktree);store.close();
if(!task||!fs.existsSync(task.worktree))throw new Error('No preserved stale worktree');
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:task.worktree,encoding:'utf8'}).trim(),'','Inspect a modified worktree manually before resume');
const port=await new Promise(resolve=>{const socket=net.createServer();socket.listen(0,'127.0.0.1',()=>{const value=socket.address().port;socket.close(()=>resolve(value));});});
const token=randomBytes(32).toString('hex'),workerToken=randomBytes(32).toString('hex'),base=`http://127.0.0.1:${port}`;
const env={...process.env,WORKSPACE_PORT:String(port),WORKSPACE_TOKEN:token,WORKER_TOKEN:workerToken,WORKSPACE_DATA_FILE:db,WORKER_SLOT:'codex',WORKER_ID:task.worktree_host};
const server=spawn(process.execPath,['src/server.mjs'],{cwd:root,env,stdio:'ignore'}),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let worker=null,cookie='';
async function api(route,method='GET',value){const response=await fetch(base+route,{method,headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:value===undefined?undefined:JSON.stringify(value)});const body=await response.json();assert.ok(response.ok,`${route}: ${response.status} ${JSON.stringify(body)}`);return body;}
try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready,'Server did not start');
  const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({token})});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await api(`/api/tasks/${task.id}/control`,'POST',{action:'resume'})).task.status,'QUEUED');
  await api(`/api/tasks/${task.id}`,'PATCH',{goal:'Add a passing edge-case test for greeting with an empty name; preserve the existing greeting test.'});
  worker=spawn(process.execPath,['src/worker.mjs'],{cwd:root,env,stdio:['ignore','ignore','ignore','ipc']});
  let result=null;for(let i=0;i<900;i++){await delay(1000);result=(await api(`/api/tasks/${task.id}`)).task;if(['AWAITING_APPROVAL','FAILED','UNVERIFIED','STALE'].includes(result.status))break;}
  assert.equal(result.status,'AWAITING_APPROVAL',JSON.stringify(result.verification));
  assert.equal(result.attempts,2);assert.equal(result.worktree,task.worktree);assert.equal(result.verification.ok,true);
  console.log(JSON.stringify({status:'PASS',taskId:task.id,attempts:result.attempts,worktree:result.worktree,changedFiles:result.result.diff.changedFiles,checks:result.verification.checks.map(check=>({command:check.command,ok:check.ok}))}));
}finally{
  if(worker){const exit=new Promise(resolve=>worker.once('exit',resolve));worker.send('stop');await Promise.race([exit,delay(30000)]);if(worker.exitCode===null)worker.kill();}
  const exit=new Promise(resolve=>server.once('exit',resolve));server.kill();await exit;
}

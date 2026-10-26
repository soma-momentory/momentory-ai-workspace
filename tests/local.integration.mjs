import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {backupFixture} from './backup-fixture.mjs';

const root=path.resolve(import.meta.dirname,'..'),repo=path.join(root,'data','local-integration-'+randomUUID());
fs.mkdirSync(repo,{recursive:true});
fs.writeFileSync(path.join(repo,'package.json'),JSON.stringify({name:'local-workflow-test',private:true,type:'module'}));
fs.writeFileSync(path.join(repo,'index.mjs'),'export function sum(a,b) { return 0; }\n');
fs.writeFileSync(path.join(repo,'index.test.mjs'),"import test from 'node:test'; import assert from 'node:assert/strict'; import {sum} from './index.mjs'; test('sum',()=>assert.equal(sum(2,3),5));\n");
execFileSync('git',['init','-b','test'],{cwd:repo});execFileSync('git',['add','.'],{cwd:repo});
execFileSync('git',['-c','user.name=Workspace Test','-c','user.email=workspace@example.invalid','commit','-m','baseline'],{cwd:repo});
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const token=randomBytes(32).toString('hex'),workerToken=randomBytes(32).toString('hex'),base=`http://127.0.0.1:${port}`;
const db=path.join(root,'data',`local-integration-${port}.sqlite`);
const child=spawn(process.execPath,['src/local.mjs'],{cwd:root,env:{...process.env,WORKSPACE_PORT:String(port),WORKSPACE_TOKEN:token,WORKER_TOKEN:workerToken,WORKSPACE_REPO_SAMPLE_APP:repo,WORKSPACE_DATA_FILE:db,...backupFixture(db,token,workerToken)},stdio:['ignore','pipe','pipe','ipc']});
let log='';for(const s of [child.stdout,child.stderr])s.on('data',chunk=>{log=(log+chunk.toString('utf8')).slice(-10000);});
let cookie='';
async function api(route,method='GET',payload,worker=false){const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(worker?{Authorization:`Bearer ${workerToken}`}:{Origin:base,Cookie:cookie})},body:payload?JSON.stringify(payload):undefined});const data=await response.json();if(!response.ok)throw new Error(`${response.status}: ${JSON.stringify(data)}`);return {data,response};}
try {
  let ready=false;for(let i=0;i<80;i++){try{const response=await fetch(base);if(response.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert.ok(ready,log);
  const login=await api('/api/login','POST',{token});cookie=login.response.headers.get('set-cookie').split(';')[0];
  const {data:{task}}=await api('/api/tasks','POST',{projectId:'sample',goal:'Fix only index.mjs so the sum test passes; leave the test file unchanged.',repo:'app',provider:'codex',mode:'FAST'});
  let done=null;for(let i=0;i<180;i++){await new Promise(r=>setTimeout(r,1000));const current=(await api(`/api/tasks/${task.id}`)).data.task;if(['AWAITING_APPROVAL','FAILED','UNVERIFIED','STALE'].includes(current.status)){done=current;break;}}
  assert.ok(done,`Timed out: ${log}`);assert.equal(done.status,'AWAITING_APPROVAL',JSON.stringify(done.result));
  assert.ok(done.result.diff.changedFiles.includes('index.mjs'));assert.equal(done.verification.ok,true);
  assert.ok(!done.result.diff.changedFiles.some(name=>['data','node_modules','.gradle','build','out','expo-lab'].includes(name)),'Sandbox mount placeholders leaked into the reviewable diff');
  const details=(await api(`/api/tasks/${task.id}`)).data;
  const verifiedFile=path.join(done.worktree,'index.mjs'),verifiedBytes=fs.readFileSync(verifiedFile);
  fs.appendFileSync(verifiedFile,'\n// POST_VERIFICATION_TAMPER\n');
  const tamperedApproval=await fetch(base+`/api/decisions/${details.decisions[0].id}`,{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({status:'APPROVED'})});
  assert.equal(tamperedApproval.status,409,'A source edit after verification must block approval');
  fs.writeFileSync(verifiedFile,verifiedBytes);
  await api(`/api/decisions/${details.decisions[0].id}`,'POST',{status:'APPROVED'});
  assert.equal((await api(`/api/tasks/${task.id}`)).data.task.status,'APPROVED');
  fs.writeFileSync(path.join(repo,'sentinel.txt'),'BASELINE\n');
  fs.writeFileSync(path.join(repo,'mutating.test.mjs'),"import test from 'node:test'; import fs from 'node:fs'; test('check side effect',()=>{fs.writeFileSync('sentinel.txt','MUTATED_BY_CHECK\\n')});\n");
  execFileSync('git',['add','sentinel.txt','mutating.test.mjs'],{cwd:repo});
  execFileSync('git',['-c','user.name=Workspace Test','-c','user.email=workspace@example.invalid','commit','-m','check mutation fixture'],{cwd:repo});
  const {data:{task:mutating}}=await api('/api/tasks','POST',{projectId:'sample',goal:'Fix only index.mjs so the sum test passes; preserve every other source file.',repo:'app',provider:'codex',mode:'FAST'});
  let mutated=null;for(let i=0;i<180;i++){await new Promise(r=>setTimeout(r,1000));const current=(await api(`/api/tasks/${mutating.id}`)).data.task;if(['AWAITING_APPROVAL','FAILED','UNVERIFIED','STALE'].includes(current.status)){mutated=current;break;}}
  assert.ok(mutated,'Mutation fixture task timed out');
  assert.equal(mutated.status,'UNVERIFIED',JSON.stringify(mutated.result));
  assert.equal(mutated.verification.ok,true,'The fixture must pass checks while changing tracked source');
  assert.equal(mutated.result.checksChangedSource,true);
  console.log(JSON.stringify({status:'PASS',taskId:task.id,repo,changedFiles:done.result.diff.changedFiles,checks:done.verification.checks.map(x=>({command:x.command,ok:x.ok})),events:details.events.length,checkMutationDenied:true},null,2));
} finally {const exited=new Promise(resolve=>child.once('exit',resolve));child.send('stop');await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,35000))]);if(child.exitCode===null)child.kill();}

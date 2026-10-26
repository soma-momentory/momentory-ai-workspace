import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {diffSummary,inheritApproved,recoveryFingerprint,sealTaskBaseline} from '../src/git.mjs';

const root=path.resolve(import.meta.dirname,'..');
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true}).trim();
const port=()=>new Promise(resolve=>{const socket=net.createServer();socket.listen(0,'127.0.0.1',()=>{const number=socket.address().port;socket.close(()=>resolve(number));});});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('inherited baseline excludes parent diff and covers child additions, deletion, rename and staging',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'t8b-diff-'));
  const source=path.join(dir,'source'),parent=path.join(dir,'parent'),child=path.join(dir,'child');
  fs.mkdirSync(source);
  try{
    git(source,'init','-b','test');
    fs.writeFileSync(path.join(source,'parent.txt'),'base\n');fs.writeFileSync(path.join(source,'rename.txt'),'rename me\n');
    git(source,'add','-A');git(source,'-c','user.name=T8 Test','-c','user.email=t8@example.invalid','commit','-m','base');
    const base=git(source,'rev-parse','HEAD');git(dir,'clone',source,parent);git(dir,'clone',source,child);
    fs.writeFileSync(path.join(parent,'parent.txt'),'approved parent\n');
    const approvedDiffHash=recoveryFingerprint(parent,base),parentId=randomUUID();
    const parentTask={id:parentId,project_id:'safe',repo:'app',status:'APPROVED',worktree:parent,base_head:base,dependsOn:[]};
    const store={getTask:id=>id===parentId?parentTask:null,decisions:()=>[{kind:'result',status:'APPROVED',details:{approvedDiffHash}}]};
    const task={id:randomUUID(),project_id:'safe',repo:'app',dependsOn:[parentId]};
    inheritApproved(task,child,store);
    const baseline=sealTaskBaseline(task,child,base);
    assert.notEqual(baseline,base);
    assert.deepEqual(diffSummary(child,baseline).changedFiles,[],'Inherited parent patch became the child approval diff');
    fs.writeFileSync(path.join(child,'child.txt'),'new child\n');
    let diff=diffSummary(child,baseline);
    assert.deepEqual(diff.changedFiles,['child.txt']);assert.doesNotMatch(diff.patch,/approved parent/);
    fs.writeFileSync(path.join(child,'.env'),'SECRET=fixture\n');
    assert.equal(diffSummary(child,baseline).reviewable,false,'Hidden untracked files cannot be approved without their content');
    fs.unlinkSync(path.join(child,'.env'));
    const initialHash=recoveryFingerprint(child,baseline);
    git(child,'add','child.txt');assert.notEqual(recoveryFingerprint(child,baseline),initialHash,'Staging changes the approval representation and invalidates a prior hash');
    fs.writeFileSync(path.join(child,'child.txt'),'changed after staging\n');assert.equal(diffSummary(child,baseline).reviewable,false,'Mixed staged and unstaged content is not approvable');
    fs.writeFileSync(path.join(child,'child.txt'),'new child\n');
    git(child,'rm','rename.txt');fs.writeFileSync(path.join(child,'renamed.txt'),'rename me\n');git(child,'add','renamed.txt');
    diff=diffSummary(child,baseline);assert.ok(diff.changedFiles.includes('rename.txt'));assert.ok(diff.changedFiles.includes('renamed.txt'));
    assert.notEqual(recoveryFingerprint(child,baseline),initialHash);
    assert.equal(git(child,'rev-parse','HEAD'),baseline,'The isolated baseline remains stable');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('logout revokes only one session, persists across restart, and enforces Origin',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'t8b-logout-'));
  const listenPort=await port(),base=`http://127.0.0.1:${listenPort}`;
  const token=randomBytes(32).toString('hex'),workerToken=randomBytes(32).toString('hex');
  const env={...process.env,WORKSPACE_PORT:String(listenPort),WORKSPACE_TOKEN:token,WORKER_TOKEN:workerToken,WORKSPACE_DATA_FILE:path.join(dir,'db.sqlite'),WORKSPACE_PROJECTS_FILE:path.join(root,'projects.json')};
  let server;
  const start=async()=>{server=spawn(process.execPath,['src/server.mjs'],{cwd:root,env,stdio:'ignore'});for(let n=0;n<60;n++){try{if((await fetch(base+'/api/session')).status===401)return;}catch{}await delay(100);}throw new Error('Server did not start');};
  const stop=async()=>{const child=server;const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;};
  const login=async()=>{const response=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({token})});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];};
  const request=(route,cookie,method='GET',origin=base)=>fetch(base+route,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:method==='POST'?'{}':undefined});
  try{
    await start();const first=await login(),second=await login();assert.notEqual(first,second);
    assert.equal((await request('/api/session',first)).status,200);
    assert.equal((await request('/api/logout',first,'POST','https://evil.example')).status,403);
    assert.equal((await request('/api/session',first)).status,200);
    const logout=await request('/api/logout',first,'POST');assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
    for(const route of ['/api/session','/api/overview','/api/tasks/12345678-1234-1234-1234-123456789abc'])assert.equal((await request(route,first)).status,401);
    assert.equal((await request('/api/tasks',first,'POST')).status,401);
    assert.equal((await request('/api/decisions/12345678-1234-1234-1234-123456789abc',first,'POST')).status,401);
    assert.equal((await request('/api/session',second)).status,200);
    assert.equal((await request('/api/logout',first,'POST')).status,200,'Duplicate logout is idempotent');
    await stop();await start();
    assert.equal((await request('/api/session',first)).status,401,'Revoked cookie became valid after restart');
    assert.equal((await request('/api/session',second)).status,200,'Other session was revoked');
    const expired=`workspace_session=${Date.now()-1000}.${randomBytes(32).toString('hex')}.${'0'.repeat(64)}`;
    assert.equal((await request('/api/session',expired)).status,401);
  }finally{if(server?.exitCode===null)await stop();fs.rmSync(dir,{recursive:true,force:true});}
});

test('server approval is bound to the child attempt and its own diff',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'t8b-approval-'));
  const source=path.join(dir,'source');fs.mkdirSync(source);
  const checkouts=[];
  let server;
  try{
    git(source,'init','-b','test');fs.writeFileSync(path.join(source,'parent.txt'),'base\n');
    git(source,'add','-A');git(source,'-c','user.name=T8 Test','-c','user.email=t8@example.invalid','commit','-m','base');
    const sourceHead=git(source,'rev-parse','HEAD');
    const configFile=path.join(dir,'projects.json');
    fs.writeFileSync(configFile,JSON.stringify({projects:[{id:'safetest',name:'Safe Test',repositories:{app:{path:source,stack:'node',checks:[]}},design:{adapter:'generic'}}]}));
    const listenPort=await port(),base=`http://127.0.0.1:${listenPort}`;
    const token=randomBytes(32).toString('hex'),workerToken=randomBytes(32).toString('hex');
    let serverLogs='';
    server=spawn(process.execPath,['src/server.mjs'],{cwd:root,env:{...process.env,WORKSPACE_PORT:String(listenPort),WORKSPACE_TOKEN:token,WORKER_TOKEN:workerToken,WORKSPACE_DATA_FILE:path.join(dir,'db.sqlite'),WORKSPACE_PROJECTS_FILE:configFile},stdio:['ignore','pipe','pipe']});
    for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>serverLogs=(serverLogs+chunk.toString()).slice(-3000));
    for(let n=0;n<60;n++){try{if((await fetch(base+'/api/session')).status===401)break;}catch{}await delay(100);}
    const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({token})});assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const api=async(route,method='GET',body,worker=false)=>{let response;try{response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(worker?{Authorization:`Bearer ${workerToken}`}:{Origin:base,Cookie:cookie})},body:body===undefined?undefined:JSON.stringify(body)});}catch(error){throw new Error(`${route}: ${error}; serverExit=${server.exitCode}; ${serverLogs}`);}return {status:response.status,data:await response.json()};};
    const create=async(goal,dependsOn=[])=>{const result=await api('/api/tasks','POST',{projectId:'safetest',repo:'app',goal,dependsOn,provider:'codex',mode:'FAST'});assert.equal(result.status,201,JSON.stringify(result.data));return result.data.task;};
    const claim=async task=>{const result=await api('/api/worker/claim','POST',{id:'safe-worker',capabilities:['safetest:app'],provider:task.provider},true);assert.equal(result.data.task.id,task.id);return result.data.task;};
    const checkout=async task=>{const target=path.join(root,'worktrees','safetest',task.id);fs.mkdirSync(path.dirname(target),{recursive:true});git(source,'worktree','add','-b',`workspace/${task.id}`,target,sourceHead);checkouts.push(target);return target;};
    const patch=async(task,worktree,baseline)=>{const result=await api('/api/worker/patch','POST',{id:'safe-worker',taskId:task.id,leaseNonce:task.lease_nonce,fields:{worktree,base_head:sourceHead,approval_base_head:baseline}},true);assert.equal(result.status,200);};
    const complete=async(task,worktree,baseline,resultOverride)=>{
      const result=resultOverride||{diff:diffSummary(worktree,baseline),verifiedDiffHash:recoveryFingerprint(worktree,baseline)};
      const response=await api('/api/worker/complete','POST',{id:'safe-worker',taskId:task.id,leaseNonce:task.lease_nonce,status:'AWAITING_APPROVAL',result,verification:{ok:true}},true);
      assert.equal(response.status,200);return response.data.task;
    };
    const parent=await create('Change the safe sample parent text');const claimedParent=await claim(parent),parentDir=await checkout(parent);
    await patch(claimedParent,parentDir,sourceHead);fs.writeFileSync(path.join(parentDir,'parent.txt'),'approved parent\n');
    assert.equal((await complete(claimedParent,parentDir,sourceHead)).status,'AWAITING_APPROVAL');
    const parentDecision=(await api(`/api/tasks/${parent.id}`)).data.decisions[0];
    assert.equal(parentDecision.details.attempt,1);assert.equal(parentDecision.details.approvalBaseHead,sourceHead);
    assert.equal((await api(`/api/decisions/${parentDecision.id}`,'POST',{status:'APPROVED'})).data.task.status,'APPROVED');
    const parentTask=(await api(`/api/tasks/${parent.id}`)).data.task,parentApproval=(await api(`/api/tasks/${parent.id}`)).data.decisions[0];
    const fakeStore={getTask:id=>id===parent.id?parentTask:null,decisions:()=>[parentApproval]};
    const noChange=await create('Inspect inherited sample text without editing it',[parent.id]);const claimedNoChange=await claim(noChange),noChangeDir=await checkout(noChange);
    inheritApproved(claimedNoChange,noChangeDir,fakeStore);
    const noChangeBase=sealTaskBaseline(claimedNoChange,noChangeDir,sourceHead);await patch(claimedNoChange,noChangeDir,noChangeBase);
    assert.deepEqual(diffSummary(noChangeDir,noChangeBase).changedFiles,[]);
    const inheritedResult={diff:diffSummary(noChangeDir,sourceHead),verifiedDiffHash:recoveryFingerprint(noChangeDir,sourceHead)};
    assert.equal((await complete(claimedNoChange,noChangeDir,noChangeBase,inheritedResult)).status,'UNVERIFIED');
    const noChangeDetail=(await api(`/api/tasks/${noChange.id}`)).data;
    assert.equal(noChangeDetail.decisions.length,0);assert.equal(noChangeDetail.task.result.diff,null);
    const child=await create('Add one safe child file after the parent',[parent.id]);const claimedChild=await claim(child),childDir=await checkout(child);
    inheritApproved(claimedChild,childDir,fakeStore);
    const childBase=sealTaskBaseline(claimedChild,childDir,sourceHead);await patch(claimedChild,childDir,childBase);
    fs.writeFileSync(path.join(childDir,'child.txt'),'child only\n');
    const childActual=diffSummary(childDir,childBase);
    const childResult=await complete(claimedChild,childDir,childBase,{diff:{...childActual,patch:'FAKE DIFF'},verifiedDiffHash:recoveryFingerprint(childDir,childBase)});assert.equal(childResult.status,'AWAITING_APPROVAL');
    assert.deepEqual(childResult.result.diff.changedFiles,['child.txt']);assert.doesNotMatch(childResult.result.diff.patch,/approved parent/);
    assert.doesNotMatch(childResult.result.diff.patch,/FAKE DIFF/,'The API must display its own verified diff');
    const childDecision=(await api(`/api/tasks/${child.id}`)).data.decisions[0];
    assert.equal(childDecision.details.taskId,child.id);assert.equal(childDecision.details.approvalBaseHead,childBase);
    fs.writeFileSync(path.join(childDir,'child.txt'),'tampered\n');
    assert.equal((await api(`/api/decisions/${childDecision.id}`,'POST',{status:'APPROVED'})).status,409);
    fs.writeFileSync(path.join(childDir,'child.txt'),'child only\n');
    assert.equal((await api(`/api/decisions/${childDecision.id}`,'POST',{status:'APPROVED'})).data.task.status,'APPROVED');
    assert.equal((await api(`/api/decisions/${childDecision.id}`,'POST',{status:'APPROVED'})).status,409);
    const approvedChild=(await api(`/api/tasks/${child.id}`)).data;
    const grandchild=await create('Inspect the full approved sample lineage',[child.id]);const claimedGrandchild=await claim(grandchild),grandchildDir=await checkout(grandchild);
    inheritApproved(claimedGrandchild,grandchildDir,{getTask:id=>id===child.id?approvedChild.task:null,decisions:()=>approvedChild.decisions});
    const grandchildBase=sealTaskBaseline(claimedGrandchild,grandchildDir,sourceHead);
    assert.deepEqual(diffSummary(grandchildDir,grandchildBase).changedFiles,[]);
    assert.equal(fs.readFileSync(path.join(grandchildDir,'parent.txt'),'utf8').trim(),'approved parent');
    assert.equal(fs.readFileSync(path.join(grandchildDir,'child.txt'),'utf8').trim(),'child only');
  }finally{
    if(server){const exited=new Promise(resolve=>server.once('exit',resolve));server.kill();await exited;}
    for(const target of checkouts){try{git(source,'worktree','remove','--force',target);}catch{}}
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

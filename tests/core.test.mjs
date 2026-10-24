import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { routeTask } from '../src/router.mjs';
import { nextHumanActions } from '../src/router.mjs';
import { providerArgs,createProviderLineParser } from '../src/provider.mjs';
import { reviewVerdict, parseDesignCandidates,selectedDesignApprovalReady,runCommand } from '../src/engine.mjs';
import {root} from '../src/config.mjs';
import {wslCodexLaunch} from '../src/wslCodex.mjs';

test('automatic routing avoids multiple agents for tiny edits and explores design alternatives',()=>{
  assert.equal(routeTask({goal:'문구 오타 수정',repo:'fe'}).mode,'FAST');
  assert.equal(routeTask({goal:'홈 화면 디자인 시안 탐색',repo:'fe'}).mode,'EXPLORE');
  assert.equal(routeTask({goal:'보안 아키텍처 리팩터',repo:'be'}).mode,'REVIEW');
  assert.equal(routeTask({goal:'버그 테스트 수정',repo:'fe'}).provider,'codex');
});
test('provider commands use supported structured streaming and an explicit isolation profile',()=>{
  const args=providerArgs('codex',{readOnly:true});
  assert.deepEqual(args.slice(0,4),['-p',process.platform==='win32'?'ai-dev-workspace-wsl-readonly':'ai-dev-workspace-posix-readonly','-a','never']);
  assert.ok(providerArgs('claude').includes('stream-json'));
});
test('WSL agent launch rejects unreviewed CLI overrides before starting a process',async()=>{
  await assert.rejects(wslCodexLaunch(process.cwd(),false,['-p','ai-dev-workspace-wsl','-a','never','exec','-c','sandbox_mode=danger-full-access','--json','-']),/Unexpected WSL Codex launch arguments/);
});
test('provider stream discards an oversized line without losing later events',()=>{
  const lines=[];let oversized=0;
  const parser=createProviderLineParser(line=>lines.push(line),()=>oversized++,20);
  parser.feed('x'.repeat(21));
  parser.feed('tail\n{"type":"result"}\n');
  parser.feed('한');parser.feed('글');parser.flush();
  assert.equal(oversized,1);
  assert.deepEqual(lines,['{"type":"result"}','한글']);
});
test('non-WSL verification command has a finite timeout',async()=>{
  const started=Date.now();
  const result=await runCommand(process.cwd(),process.execPath,['-e','setInterval(()=>{},1000)'],500);
  assert.equal(result.ok,false);
  assert.equal(result.timedOut,true);
  assert.ok(Date.now()-started<10000);
});
test('review cannot silently pass an ambiguous or fix-required answer',()=>{
  assert.equal(reviewVerdict('**FIX_REQUIRED**\nIssue'), 'FIX_REQUIRED');
  assert.equal(reviewVerdict('PASS\nVerified'), 'PASS');
  assert.equal(reviewVerdict('Looks good to me'), null);
});
test('selected design approval excludes unrelated edits, moved commits, and ignored files',()=>{
  const base={verification:{ok:true},diff:{reviewable:true,changedFiles:['src/design/studioApproved.json']},outputPath:'src/design/studioApproved.json',checksChangedSource:false,headMoved:false,ignored:[],violations:[]};
  assert.equal(selectedDesignApprovalReady(base),true);
  assert.equal(selectedDesignApprovalReady({...base,diff:{...base.diff,changedFiles:[...base.diff.changedFiles,'src/screen.tsx']}}),false);
  assert.equal(selectedDesignApprovalReady({...base,headMoved:true}),false);
  assert.equal(selectedDesignApprovalReady({...base,ignored:['app/node_modules/']}),false);
  assert.equal(selectedDesignApprovalReady({...base,verification:{ok:false}}),false);
});
test('design proposals require structured, distinct candidates before evaluation',()=>{
  const candidates=parseDesignCandidates('```json\n{"candidates":[{"name":"Timeline","layout":"chronological"},{"name":"Dashboard","layout":"summary"}]}\n```');
  assert.deepEqual(candidates.map(x=>x.name),['Timeline','Dashboard']);
  assert.deepEqual(parseDesignCandidates('Unstructured answer'),[]);
});

test('design capture status survives a process restart and gates selection',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-capture-'));
  const file=path.join(dir,'store.sqlite');
  try{
    let db=new Store(file);
    const task=db.createTask({projectId:'momentory',repo:'fe',goal:'Compare structural home hero options'},{mode:'EXPLORE',provider:'claude',reason:'test'});
    const id=db.addCandidate(task.id,'claude',{screen:'home-main',exported:{version:1,name:'Option',design:{}}});
    assert.equal(db.setCandidateCapturePending(id),true);
    assert.deepEqual(db.pendingCaptures(),[id]);
    db.close();db=new Store(file);
    assert.deepEqual(db.pendingCaptures(),[id]);
    assert.equal(db.candidate(id).status,'CAPTURE_PENDING');
    db.setCandidateCaptureFailed(id,'controlled renderer error');
    assert.deepEqual(db.pendingCaptures(),[]);
    assert.equal(db.candidate(id).status,'CAPTURE_FAILED');
    assert.equal(db.events(task.id).filter(event=>event.kind==='design_capture_failed').length,1);
    db.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('persistent queue claims once, recovers lease, limits attempts and records approval',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'momentory-store-'));
  const file=path.join(dir,'store.sqlite');
  const db=new Store(file);
  try {
    const task=db.createTask({goal:'Improve the home screen layout',repo:'fe',maxAttempts:2},{mode:'SPECIALIST',provider:'claude',reason:'test'});
    assert.equal(db.claim('unscoped',['fe']),null);
    const firstClaim=db.claim('a',['momentory:fe']);assert.equal(firstClaim.id,task.id);assert.ok(firstClaim.lease_nonce);
    assert.equal(db.claim('b',['momentory:fe']),null);
    db.db.prepare('UPDATE tasks SET lease_until=0 WHERE id=?').run(task.id);
    assert.equal(db.recoverExpired(),1);
    assert.equal(db.getTask(task.id).status,'QUEUED');
    const secondClaim=db.claim('b',['momentory:fe']);assert.equal(secondClaim.attempts,2);assert.notEqual(secondClaim.lease_nonce,firstClaim.lease_nonce);
    db.patch(task.id,{worktree:path.join(dir,'worktree'),worktree_host:'b',base_head:'abc'},'checkpoint');
    db.db.prepare('UPDATE tasks SET lease_until=0 WHERE id=?').run(task.id);
    db.recoverExpired();assert.equal(db.getTask(task.id).status,'STALE');
    db.patch(task.id,{status:'AWAITING_APPROVAL'},'test');
    const decision=db.addDecision(task.id,'result',{changedFiles:['a.ts']});
    db.close();
    const reopened=new Store(file);
    assert.equal(reopened.getTask(task.id).status,'AWAITING_APPROVAL');
    assert.equal(reopened.events(task.id).length>0,true);
    assert.equal(reopened.resolveDecision(decision,'APPROVED',null,'','a'.repeat(64)).status,'APPROVED');
    reopened.close();
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('a stale worktree is preserved and never automatically claimed by another worker',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'momentory-stale-'));
  const db=new Store(path.join(dir,'db.sqlite'));
  try {
    const task=db.createTask({goal:'Repair the saved task changes',repo:'fe',maxAttempts:3},{mode:'FAST',provider:'codex',reason:'test'});
    db.claim('laptop',['momentory:fe']);db.patch(task.id,{worktree:path.join(dir,'worktree'),worktree_host:'laptop'},'checkpoint');
    db.db.prepare('UPDATE tasks SET lease_until=0 WHERE id=?').run(task.id);
    db.recoverExpired();assert.equal(db.getTask(task.id).status,'STALE');
    assert.equal(db.claim('other',['momentory:fe']),null);assert.equal(db.claim('laptop',['momentory:fe']),null);
  } finally {db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('an uncheckpointed physical worktree is not automatically claimed after lease loss',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-uncheckpointed-'));
  const db=new Store(path.join(dir,'db.sqlite'));
  let worktree,created=false;
  try{
    const task=db.createTask({projectId:'sample',goal:'Preserve an interrupted write',repo:'app'},{mode:'FAST',provider:'codex',reason:'test'});
    db.claim('worker',['sample:app']);
    worktree=path.join(root,'worktrees','sample',task.id);
    assert.equal(fs.existsSync(worktree),false,'Fixture path already exists');
    fs.mkdirSync(path.dirname(worktree),{recursive:true});fs.mkdirSync(worktree);created=true;fs.writeFileSync(path.join(worktree,'partial.txt'),'PARTIAL');
    db.db.prepare('UPDATE tasks SET lease_until=0 WHERE id=?').run(task.id);
    db.recoverExpired();assert.equal(db.getTask(task.id).status,'STALE');
    assert.equal(db.claim('another',['sample:app']),null);
  }finally{
    db.close();fs.rmSync(dir,{recursive:true,force:true});
    if(created&&path.resolve(worktree).startsWith(path.join(root,'worktrees','sample')+path.sep))fs.rmSync(worktree,{recursive:true,force:true});
  }
});
test('human work stays out of AI claims and completion unlocks a dependent task',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-human-'));
  const db=new Store(path.join(dir,'db.sqlite'));
  try{
    const human=db.createTask({projectId:'sample',goal:'Choose the user-facing tone',repo:'app',type:'HUMAN_TASK',priority:4},{mode:'FAST',provider:'claude',reason:'human'});
    const dependent=db.createTask({projectId:'sample',goal:'Write copy using the approved tone',repo:'app',dependsOn:[human.id]},{mode:'FAST',provider:'codex',reason:'test'});
    assert.equal(db.claim('codex-slot',['sample:app'],30000,'codex'),null);
    assert.equal(nextHumanActions(db.listTasks('sample'))[0].taskId,human.id);
    assert.equal(db.completeHuman(human.id,'Use a calm, precise tone').status,'DONE');
    assert.equal(db.claim('codex-slot',['sample:app'],30000,'codex').id,dependent.id);
    assert.ok(db.events(dependent.id).some(event=>event.kind==='unblocked'));
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('failed or rejected parents block queued dependents until the dependency is resolved',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-blocked-dependency-'));
  const db=new Store(path.join(dir,'db.sqlite'));
  try{
    const parent=db.createTask({projectId:'sample',goal:'Produce a prerequisite result',repo:'app'},{mode:'FAST',provider:'codex',reason:'test'});
    const child=db.createTask({projectId:'sample',goal:'Use the prerequisite result',repo:'app',dependsOn:[parent.id]},{mode:'FAST',provider:'codex',reason:'test'});
    db.patch(parent.id,{status:'FAILED'},'completed');
    assert.equal(db.getTask(child.id).status,'BLOCKED');
    assert.ok(db.events(child.id).some(event=>event.kind==='dependency_blocked'));
    db.patch(parent.id,{status:'APPROVED'},'manual_test_approval');
    assert.equal(db.getTask(child.id).status,'QUEUED');
    assert.ok(db.events(child.id).some(event=>event.kind==='unblocked'));
    const rejected=db.createTask({projectId:'sample',goal:'Evaluate another prerequisite',repo:'app'},{mode:'FAST',provider:'codex',reason:'test'});
    const waiting=db.createTask({projectId:'sample',goal:'Follow a rejected result',repo:'app',dependsOn:[rejected.id]},{mode:'FAST',provider:'codex',reason:'test'});
    const decision=db.addDecision(rejected.id,'result',{question:'Accept?'});
    db.resolveDecision(decision,'REJECTED');
    assert.equal(db.getTask(waiting.id).status,'BLOCKED');
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('Momentory design selection requires a rendered candidate',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-design-gate-'));
  const db=new Store(path.join(dir,'db.sqlite'));
  try{
    const task=db.createTask({projectId:'momentory',goal:'Explore home screen layouts',repo:'fe'},{mode:'EXPLORE',provider:'claude',reason:'test'});
    const candidate=db.addCandidate(task.id,'claude',{name:'Layout A'});
    const decision=db.addDecision(task.id,'design',{question:'Choose a rendered design'});
    assert.equal(db.resolveDecision(decision,'APPROVED',candidate),null);
    db.setCandidateScreenshot(candidate,{baseline:'fixture-baseline.png',candidate:'fixture-candidate.png'});
    assert.equal(db.resolveDecision(decision,'APPROVED',candidate).status,'SELECTED');
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

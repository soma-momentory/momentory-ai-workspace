import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { routeTask } from '../src/router.mjs';
import { nextHumanActions } from '../src/router.mjs';
import { providerArgs } from '../src/provider.mjs';
import { reviewVerdict, parseDesignCandidates } from '../src/engine.mjs';

test('automatic routing avoids multiple agents for tiny edits and explores design alternatives',()=>{
  assert.equal(routeTask({goal:'문구 오타 수정',repo:'fe'}).mode,'FAST');
  assert.equal(routeTask({goal:'홈 화면 디자인 시안 탐색',repo:'fe'}).mode,'EXPLORE');
  assert.equal(routeTask({goal:'보안 아키텍처 리팩터',repo:'be'}).mode,'REVIEW');
  assert.equal(routeTask({goal:'버그 테스트 수정',repo:'fe'}).provider,'codex');
});
test('provider commands use supported structured streaming and a bounded sandbox',()=>{
  assert.deepEqual(providerArgs('codex',{readOnly:true}).slice(0,4),['-s','read-only','-a','never']);
  assert.ok(providerArgs('claude').includes('stream-json'));
});
test('review cannot silently pass an ambiguous or fix-required answer',()=>{
  assert.equal(reviewVerdict('**FIX_REQUIRED**\nIssue'), 'FIX_REQUIRED');
  assert.equal(reviewVerdict('PASS\nVerified'), 'PASS');
  assert.equal(reviewVerdict('Looks good to me'), null);
});
test('design proposals require structured, distinct candidates before evaluation',()=>{
  const candidates=parseDesignCandidates('```json\n{"candidates":[{"name":"Timeline","layout":"chronological"},{"name":"Dashboard","layout":"summary"}]}\n```');
  assert.deepEqual(candidates.map(x=>x.name),['Timeline','Dashboard']);
  assert.deepEqual(parseDesignCandidates('Unstructured answer'),[]);
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
    assert.equal(reopened.resolveDecision(decision,'APPROVED').status,'APPROVED');
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

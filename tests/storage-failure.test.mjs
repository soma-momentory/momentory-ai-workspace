import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';

test('event storage failure rolls back task creation and approval atomically',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-storage-failure-'));
  const store=new Store(path.join(dir,'db.sqlite'));
  const input={projectId:'sample',repo:'app',goal:'Verify transaction rollback'};
  const route={mode:'FAST',provider:'codex',reason:'fixture'};
  try{
    store.db.exec("CREATE TEMP TRIGGER deny_event BEFORE INSERT ON events BEGIN SELECT RAISE(FAIL, 'injected disk failure'); END");
    assert.throws(()=>store.createTask(input,route),/injected disk failure/);
    assert.equal(store.db.prepare('SELECT count(*) AS count FROM tasks').get().count,0);
    store.db.exec('DROP TRIGGER deny_event');
    const task=store.createTask(input,route);
    store.patch(task.id,{status:'AWAITING_APPROVAL',worktree:path.join(dir,'isolated-worktree'),approval_base_head:'fixture'},'fixture');
    const decision=store.addDecision(task.id,'result',{question:'Approve?'});
    store.db.exec("CREATE TEMP TRIGGER deny_event BEFORE INSERT ON events BEGIN SELECT RAISE(FAIL, 'injected disk failure'); END");
    assert.throws(()=>store.resolveDecision(decision,'APPROVED',null,'','a'.repeat(64)),/injected disk failure/);
    assert.equal(store.decision(decision).status,'PENDING');
    assert.equal(store.getTask(task.id).status,'AWAITING_APPROVAL');
    assert.throws(()=>store.addCandidate(task.id,'codex',{name:'candidate'}),/injected disk failure/);
    assert.equal(store.candidates(task.id).length,0);
    store.db.exec('DROP TRIGGER deny_event');
    const candidate=store.addCandidate(task.id,'codex',{name:'candidate'});
    store.db.exec("CREATE TEMP TRIGGER deny_event BEFORE INSERT ON events BEGIN SELECT RAISE(FAIL, 'injected disk failure'); END");
    assert.throws(()=>store.setCandidateCapturePending(candidate),/injected disk failure/);
    assert.equal(store.candidate(candidate).status,'PROPOSED');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

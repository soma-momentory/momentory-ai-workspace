import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {root} from '../src/config.mjs';
import {inheritApproved,recoveryFingerprint} from '../src/git.mjs';

const base=path.join(root,'data',`approved-inheritance-${randomUUID()}`);
assert.ok(path.resolve(base).startsWith(path.join(root,'data')+path.sep));
const parent=path.join(base,'parent'),child=path.join(base,'child'),tamperedChild=path.join(base,'tampered-child');
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',timeout:15000,windowsHide:true}).trim();
fs.mkdirSync(parent,{recursive:true});
try{
  git(parent,'init','-b','test');
  fs.writeFileSync(path.join(parent,'file.txt'),'BASE\n');
  git(parent,'add','file.txt');
  git(parent,'-c','user.name=Workspace Test','-c','user.email=workspace@example.invalid','commit','-m','base');
  const baseHead=git(parent,'rev-parse','HEAD');
  fs.writeFileSync(path.join(parent,'file.txt'),'APPROVED\n');
  const approvedDiffHash=recoveryFingerprint(parent,baseHead);
  git(base,'clone',parent,child);
  git(base,'clone',parent,tamperedChild);
  const parentTask={id:randomUUID(),project_id:'sample',repo:'app',status:'APPROVED',worktree:parent,base_head:baseHead};
  const store={getTask:id=>id===parentTask.id?parentTask:null,decisions:id=>id===parentTask.id?[{kind:'result',status:'APPROVED',details:{approvedDiffHash}}]:[]};
  const task={project_id:'sample',repo:'app',dependsOn:[parentTask.id]};
  inheritApproved(task,child,store);
  assert.equal(fs.readFileSync(path.join(child,'file.txt'),'utf8').replaceAll('\r\n','\n'),'APPROVED\n');
  fs.writeFileSync(path.join(parent,'file.txt'),'TAMPERED_AFTER_APPROVAL\n');
  assert.throws(()=>inheritApproved(task,tamperedChild,store),/changed after human review/);
  assert.equal(fs.readFileSync(path.join(tamperedChild,'file.txt'),'utf8').replaceAll('\r\n','\n'),'BASE\n');
  console.log(JSON.stringify({status:'PASS',approvedPatchInherited:true,postApprovalTamperDenied:true}));
}finally{fs.rmSync(base,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {root} from '../src/config.mjs';
import {diffSummary,ignoredWorktreeViolations} from '../src/git.mjs';

const dir=path.join(root,'data',`diff-reviewability-${randomUUID()}`);
fs.mkdirSync(dir,{recursive:true});
const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
try{
  git('init','-b','test');fs.writeFileSync(path.join(dir,'index.txt'),'baseline\n');git('add','.');git('-c','user.name=Workspace Test','-c','user.email=workspace@example.invalid','commit','-m','baseline');
  const head=git('rev-parse','HEAD');
  fs.writeFileSync(path.join(dir,'index.txt'),'reviewable edit\n');
  assert.equal(diffSummary(dir,head).reviewable,true);
  fs.writeFileSync(path.join(dir,'index.txt'),'x'.repeat(130000));
  assert.equal(diffSummary(dir,head).reviewable,false,'Truncated tracked changes cannot be approved');
  fs.writeFileSync(path.join(dir,'index.txt'),'baseline\n');
  const large=path.join(dir,'large.bin');fs.writeFileSync(large,Buffer.alloc(33000,1));
  assert.equal(diffSummary(dir,head).reviewable,false,'Large untracked content cannot be approved through a placeholder');
  fs.rmSync(large);
  fs.writeFileSync(path.join(dir,'index.txt'),'api_key=example-secret\n');
  assert.equal(diffSummary(dir,head).reviewable,false,'Redacted source cannot be approved without a complete local review');
  fs.writeFileSync(path.join(dir,'.gitignore'),'node_modules/\n');
  fs.mkdirSync(path.join(dir,'node_modules'));fs.writeFileSync(path.join(dir,'node_modules','trusted.js'),'module.exports=1');
  fs.mkdirSync(path.join(dir,'app','node_modules'),{recursive:true});fs.writeFileSync(path.join(dir,'app','node_modules','poison.js'),'module.exports=0');
  fs.mkdirSync(path.join(dir,'expo-lab','node_modules'),{recursive:true});
  assert.deepEqual(ignoredWorktreeViolations(dir,['node_modules/']),['app/node_modules/'],'Nested ignored dependency replacement must block verification');
  fs.writeFileSync(path.join(dir,'expo-lab','node_modules','poison.js'),'module.exports=0');
  assert.deepEqual(ignoredWorktreeViolations(dir,['node_modules/']),['app/node_modules/','expo-lab/node_modules/'],'A nonempty Expo mount must block verification');
  console.log(JSON.stringify({status:'PASS',smallPatchReviewable:true,truncatedDenied:true,largeDenied:true,redactedDenied:true,nestedIgnoredDenied:true,emptyExpoMountAllowed:true,populatedExpoMountDenied:true}));
}finally{fs.rmSync(dir,{recursive:true,force:true});}

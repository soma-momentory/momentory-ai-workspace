import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {childEnv,redact,providerArgs} from '../src/provider.mjs';
import {diffSummary} from '../src/git.mjs';

test('provider subprocesses never inherit workspace authentication tokens',()=>{
  const old=process.env.WORKSPACE_TOKEN;process.env.WORKSPACE_TOKEN='fixture-secret-token';
  try{assert.equal(childEnv().WORKSPACE_TOKEN,undefined);assert.ok(childEnv().PATH||childEnv().Path);assert.equal(redact('prefix fixture-secret-token suffix'),'prefix [REDACTED] suffix');}finally{if(old===undefined)delete process.env.WORKSPACE_TOKEN;else process.env.WORKSPACE_TOKEN=old;}
});
test('provider session IDs cannot inject shell metacharacters',()=>{
  assert.throws(()=>providerArgs('codex',{sessionId:'abc12345 & echo bad'}),/Invalid provider session ID/);
});
test('reviewable diffs mask common credential assignments',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-redaction-'));
  try{
    execFileSync('git',['init','-b','dev'],{cwd:dir});fs.writeFileSync(path.join(dir,'README.md'),'base\n');execFileSync('git',['add','.'],{cwd:dir});execFileSync('git',['-c','user.name=Test','-c','user.email=test@local.invalid','commit','-m','base'],{cwd:dir});
    fs.writeFileSync(path.join(dir,'notes.txt'),'PASSWORD=fixture-password\nkey sk-12345678901234567890\n');
    const patch=diffSummary(dir,'HEAD').patch;assert.ok(!patch.includes('fixture-password'));assert.ok(!patch.includes('sk-12345678901234567890'));assert.ok(patch.includes('[REDACTED]'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

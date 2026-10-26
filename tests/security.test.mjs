import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {childEnv,redact,providerArgs} from '../src/provider.mjs';
import {diffSummary} from '../src/git.mjs';
import {Store} from '../src/store.mjs';

test('provider subprocesses never inherit workspace authentication tokens',()=>{
  const old=process.env.WORKSPACE_TOKEN;process.env.WORKSPACE_TOKEN='fixture-secret-token';
  try{assert.equal(childEnv().WORKSPACE_TOKEN,undefined);assert.ok(childEnv().PATH||childEnv().Path);assert.equal(redact('prefix fixture-secret-token suffix'),'prefix [REDACTED] suffix');}finally{if(old===undefined)delete process.env.WORKSPACE_TOKEN;else process.env.WORKSPACE_TOKEN=old;}
});
test('provider session IDs cannot inject shell metacharacters',()=>{
  assert.throws(()=>providerArgs('codex',{sessionId:'abc12345 & echo bad'}),/Invalid provider session ID/);
  const claude=providerArgs('claude');
  assert.ok(claude.includes('--restricted'));
  assert.ok(claude.includes('--strict-mcp-config'));
  assert.ok(claude.includes('--permission-prompts'));
});
test('reviewable diffs mask common credential assignments',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-redaction-'));
  try{
    execFileSync('git',['init','-b','dev'],{cwd:dir});fs.writeFileSync(path.join(dir,'README.md'),'base\n');execFileSync('git',['add','.'],{cwd:dir});execFileSync('git',['-c','user.name=Test','-c','user.email=test@local.invalid','commit','-m','base'],{cwd:dir});
    fs.writeFileSync(path.join(dir,'notes.txt'),'PASSWORD=fixture-password\nkey sk-12345678901234567890\n');
    const patch=diffSummary(dir,'HEAD').patch;assert.ok(!patch.includes('fixture-password'));assert.ok(!patch.includes('sk-12345678901234567890'));assert.ok(patch.includes('[REDACTED]'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('persisted events mask workspace credentials',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-event-redaction-'));
  const previous=process.env.WORKSPACE_TOKEN;process.env.WORKSPACE_TOKEN='fixture-event-secret-token';
  try{
    const store=new Store(path.join(dir,'db.sqlite'));
    store.event(null,'test',{message:'Bearer fixture-event-secret-token'});
    const raw=store.db.prepare("SELECT payload FROM events WHERE kind='test'").get().payload;
    assert.ok(!raw.includes('fixture-event-secret-token'));
    assert.match(raw,/REDACTED/);
    assert.match(JSON.parse(raw).message,/REDACTED/);
    store.close();
  }finally{if(previous===undefined)delete process.env.WORKSPACE_TOKEN;else process.env.WORKSPACE_TOKEN=previous;fs.rmSync(dir,{recursive:true,force:true});}
});

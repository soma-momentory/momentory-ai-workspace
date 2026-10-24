import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {wslCodexConfig,wslTrustedCommandLaunch,asynchronousProbe} from '../src/wslCodex.mjs';
import {codexProfileName} from '../src/codexProfile.mjs';

const cwd=process.env.WORKSPACE_TEST_BE_WORKTREE;
assert.ok(cwd&&['build.gradle','build.gradle.kts'].some(name=>fs.existsSync(path.join(cwd,name))),'Set WORKSPACE_TEST_BE_WORKTREE to an isolated BE worktree');
const config=wslCodexConfig(cwd),name=`workspace-cache-canary-${randomUUID()}`;
const denied=`${config.worktree}/.gradle/workspace-home/caches/modules-2/files-2.1/${name}`;
const wrapperDenied=`${config.worktree}/.gradle/workspace-home/wrapper/dists/${name}`;
const allowed=`${config.worktree}/.gradle/workspace-tmp/${name}`;
const command=`const fs=require('fs');fs.writeFileSync(process.argv[1],'CANARY')`;
const probe=target=>asynchronousProbe(wslTrustedCommandLaunch(cwd,[
  '/usr/bin/env',`CODEX_HOME=${config.codexHome}`,config.binary,'sandbox','-p',codexProfileName('wsl-check-generic'),'-P','workspace-check-locked','-C',config.worktree,'--',
  `${config.home}/.local/node_modules/node/bin/node`,'-e',command,target
]),60000);
try {
  const blocked=await probe(denied);
  assert.notEqual(blocked.status,0,'A check must not alter cached dependency artifacts');
  assert.equal(fs.existsSync(path.join(cwd,'.gradle','workspace-home','caches','modules-2','files-2.1',name)),false);
  const wrapper=await probe(wrapperDenied);
  assert.notEqual(wrapper.status,0,'A check must not alter the cached Gradle distribution');
  assert.equal(fs.existsSync(path.join(cwd,'.gradle','workspace-home','wrapper','dists',name)),false);
  const control=await probe(allowed);
  assert.equal(control.status,0,control.stderr);
  assert.equal(fs.readFileSync(path.join(cwd,'.gradle','workspace-tmp',name),'utf8'),'CANARY');
  console.log(JSON.stringify({status:'PASS',artifactWriteDenied:true,wrapperWriteDenied:true,tempWriteAllowed:true}));
} finally {fs.rmSync(path.join(cwd,'.gradle','workspace-tmp',name),{force:true});}

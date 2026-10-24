import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {runProvider} from '../src/provider.mjs';
import {root} from '../src/config.mjs';

if(process.platform!=='win32')throw new Error('Windows WSL2 required');
const controller=new AbortController(),pidDir=path.join(root,'data','codex-processes');
let started=false,unit=null;
const outcome=await runProvider({provider:'codex',cwd:path.resolve('../ai-dev-workspace-sample'),
  prompt:'Run the shell command sleep 60, then reply. This is a cancellation test; do not modify files.',
  readOnly:true,signal:controller.signal,timeoutMs:120000,onEvent:event=>{
    if(event.type!=='item.started'||!event.summary?.includes('sleep 60'))return;
    started=true;
    const name=fs.readdirSync(pidDir).find(file=>file.startsWith(`${process.pid}-`)&&file.endsWith('.pid'));
    if(name)unit=`ai-dev-workspace-${name.slice(String(process.pid).length+1,-4)}.scope`;
    controller.abort();
  }});
assert.equal(started,true,'Codex did not start the controlled long-running command');
assert.equal(outcome.ok,false,'Cancelled Codex session was reported successful');
assert.ok(unit,'No process-group checkpoint was recorded');
assert.equal(fs.readdirSync(pidDir).some(file=>file.startsWith(`${process.pid}-`)),false,'Process marker survived cancellation');
const distro=process.env.WORKSPACE_WSL_DISTRO||'Ubuntu';
const active=spawnSync('wsl.exe',['-d',distro,'--exec','/usr/bin/systemctl','--user','is-active',unit],{encoding:'utf8'});
assert.notEqual(active.status,0,'Cancelled Codex systemd scope remains active');
let timeoutStarted=false;
const timed=await runProvider({provider:'codex',cwd:path.resolve('../ai-dev-workspace-sample'),
  prompt:'Run the shell command sleep 60, then reply. This is a wall-time limit test; do not modify files.',
  readOnly:true,timeoutMs:25000,onEvent:event=>{if(event.type==='item.started'&&event.summary?.includes('sleep 60'))timeoutStarted=true;}});
assert.equal(timeoutStarted,true,'Codex did not reach the long-running command for wall-time test');
assert.equal(timed.timedOut,true,'Wall-time limit was not enforced');
assert.equal(fs.readdirSync(pidDir).some(file=>file.startsWith(`${process.pid}-`)),false,'Process marker survived timeout');
console.log(JSON.stringify({status:'PASS',unit,cancelled:true,wallTimedOut:true}));

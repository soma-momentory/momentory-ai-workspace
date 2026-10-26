import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {runProvider} from '../src/provider.mjs';
import {root} from '../src/config.mjs';
import {repository} from '../src/projects.mjs';
import {randomUUID} from 'node:crypto';

if(process.platform==='darwin'){
  const cwd=repository('sample','app').path,tag=randomUUID();
  const script=path.join(cwd,`cancel-${tag}.sh`),pidsFile=path.join(cwd,`cancel-${tag}.pids`);
  const alive=pid=>{const p=spawnSync('/bin/ps',['-p',String(pid),'-o','stat='],{encoding:'utf8'});return p.status===0&&p.stdout.trim()&&!p.stdout.trim().startsWith('Z');};
  const results=[];
  try{
    fs.writeFileSync(script,`#!/bin/sh\necho $$ > '${pidsFile}'\nsleep 60 &\necho $! >> '${pidsFile}'\nwait\n`,{mode:0o700});
    for(const trial of ['cancel','timeout']){
      fs.rmSync(pidsFile,{force:true});const controller=new AbortController();let pids=[];
      const poll=setInterval(()=>{if(fs.existsSync(pidsFile)){const observed=fs.readFileSync(pidsFile,'utf8').trim().split(/\s+/).map(Number);if(observed.length===2&&observed.every(pid=>Number.isInteger(pid)&&pid>1)){pids=observed;if(trial==='cancel')controller.abort();}}},50);
      let outcome;
      try{outcome=await runProvider({provider:'codex',cwd,prompt:`Run exactly /bin/sh ${script} and wait for it to exit. This is an authorized cancellation test. Do not edit or read any other files.`,signal:controller.signal,timeoutMs:trial==='timeout'?30000:120000});}
      finally{clearInterval(poll);}
      assert.equal(pids.length,2,`${trial}: controlled parent and child did not start`);
      assert.equal(outcome.ok,false,`${trial}: interrupted session reported success`);
      assert.equal(outcome.timedOut,trial==='timeout');
      await new Promise(resolve=>setTimeout(resolve,300));
      const survivors=pids.filter(alive);
      if(survivors.length){for(const pid of survivors)try{process.kill(pid,'SIGKILL');}catch{}}
      assert.deepEqual(survivors,[],`${trial}: controlled descendants survived cancellation`);
      results.push({trial,sessionId:outcome.sessionId,pids,descendantsStopped:true,timedOut:outcome.timedOut});
    }
    console.log(JSON.stringify({status:'PASS',platform:'darwin',results}));
  }finally{fs.rmSync(script,{force:true});fs.rmSync(pidsFile,{force:true});}
}else{
if(process.platform!=='win32')throw new Error('Windows WSL2 or macOS required');
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
}

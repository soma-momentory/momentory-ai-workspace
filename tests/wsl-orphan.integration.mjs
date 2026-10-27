import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {root} from '../src/config.mjs';
import {activeWslCodexForWorktree,reapStaleWslCodex} from '../src/wslCodex.mjs';
import {activeMacProcessesForWorktree,reapStaleMacProcesses,trackMacProcess,stopTree} from '../src/provider.mjs';

if(process.platform==='darwin'){
  const child=spawn('/bin/sh',['-c','sleep 0.5; exec /bin/sleep 60'],{cwd:root,detached:true,stdio:'ignore'});
  const tracker=trackMacProcess(child,root);let marker;
  try{
    const dir=path.join(root,'data','mac-processes');marker=fs.readdirSync(dir).find(name=>name.startsWith(`${process.pid}-`)&&name.endsWith('.json'));assert.ok(marker);
    const file=path.join(dir,marker),original=fs.readFileSync(file);await new Promise(r=>setTimeout(r,900));
    const afterExec=JSON.parse(fs.readFileSync(file));assert.ok(afterExec.processes.some(([pid])=>pid===child.pid));
    assert.ok(activeMacProcessesForWorktree(root).includes(marker));assert.ok(!reapStaleMacProcesses().includes(marker),'Live owner must not be reaped');process.kill(child.pid,0);
    const fake={...afterExec,owner:{pid:99999999,identity:'1:1'},processes:[[child.pid,'1:1']]};fs.writeFileSync(file,JSON.stringify(fake));assert.ok(reapStaleMacProcesses().includes(marker));process.kill(child.pid,0);
    fs.writeFileSync(file,'malformed checkpoint',{mode:0o600});assert.throws(()=>reapStaleMacProcesses());process.kill(child.pid,0);fs.writeFileSync(file,original);
    console.log(JSON.stringify({status:'PASS',platform:'darwin',execIdentityStable:true,liveOwnerPreserved:true,reusedPidIdentityDenied:true,malformedCheckpointBlocked:true}));
  }finally{stopTree(child,'SIGKILL');assert.equal(tracker.finish(),true);}
}else{
if(process.platform!=='win32')throw new Error('Windows WSL2 required');
const distro=process.env.WORKSPACE_WSL_DISTRO||'Ubuntu',id=randomUUID(),unit=`ai-dev-workspace-${id}.scope`;
const pidDir=path.join(root,'data','codex-processes');fs.mkdirSync(pidDir,{recursive:true});
const pidFile=path.join(pidDir,`99999999-${id}.pid`);
fs.writeFileSync(`${pidFile}.json`,JSON.stringify({cwd:root,distro,unit,owner:99999999}));
const toLinux=file=>{
  const result=spawnSync('wsl.exe',['-d',distro,'--exec','/usr/bin/wslpath','-u',file.replaceAll('\\','/')],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);return result.stdout.trim();
};
const runner=toLinux(path.join(root,'scripts','wsl-codex.sh'));
const uid=spawnSync('wsl.exe',['-d',distro,'--exec','/usr/bin/id','-u'],{encoding:'utf8'}).stdout.trim();
assert.match(uid,/^\d{1,8}$/);
const runtime=`XDG_RUNTIME_DIR=/run/user/${uid}`;
const child=spawn('wsl.exe',['-d',distro,'--cd',root,'--exec','/usr/bin/env',runtime,'/usr/bin/systemd-run','--user','--scope',`--unit=${unit}`,
  '-p','MemoryMax=268435456','-p','MemorySwapMax=0','--','/usr/bin/setsid','--wait','/bin/bash',runner,
  toLinux(pidFile),'30','0','/bin/sleep','120'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=chunk.toString();});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
  for(let i=0;i<300&&!fs.existsSync(pidFile);i++)await delay(100);
  assert.ok(fs.existsSync(pidFile),`Orphan fixture did not checkpoint its process group: ${output}`);
  assert.ok(activeWslCodexForWorktree(root).includes(unit),'Active Codex scope was not detected');
  assert.ok(reapStaleWslCodex().includes(path.basename(pidFile)),'Stale Codex scope was not reaped');
  for(let i=0;i<100&&child.exitCode===null;i++)await delay(100);
  assert.notEqual(child.exitCode,null,'WSL child survived reaping');
  const active=spawnSync('wsl.exe',['-d',distro,'--exec','/usr/bin/env',runtime,'/usr/bin/systemctl','--user','is-active',unit],{encoding:'utf8'});
  assert.notEqual(active.status,0,'Orphan scope remains active');
  assert.equal(fs.existsSync(pidFile),false,'Orphan marker remains');
  assert.equal(activeWslCodexForWorktree(root).length,0,'Reaped scope still blocks resume');
  const damaged=`99999999-${randomUUID()}.pid`,damagedFile=path.join(pidDir,damaged);
  fs.writeFileSync(`${damagedFile}.json`,Buffer.alloc(192));
  fs.writeFileSync(damagedFile,Buffer.alloc(5));
  assert.ok(activeWslCodexForWorktree(root).includes(`${damaged}.json`),'Unknown metadata must fail closed before recovery');
  assert.ok(reapStaleWslCodex().includes(damaged),'Inactive damaged metadata was not quarantined');
  assert.equal(fs.existsSync(path.join(pidDir,'quarantine',`${damaged}.json`)),true);
  assert.equal(activeWslCodexForWorktree(root).length,0,'Quarantined marker still blocks resume');
  console.log(JSON.stringify({status:'PASS',unit,childExit:child.exitCode,damagedMetadataQuarantined:true}));
} finally {if(child.exitCode===null)child.kill();}
}

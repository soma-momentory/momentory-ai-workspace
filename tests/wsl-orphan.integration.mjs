import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {root} from '../src/config.mjs';
import {activeWslCodexForWorktree,reapStaleWslCodex} from '../src/wslCodex.mjs';

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
const child=spawn('wsl.exe',['-d',distro,'--cd',root,'--exec','/usr/bin/systemd-run','--user','--scope',`--unit=${unit}`,
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
  const active=spawnSync('wsl.exe',['-d',distro,'--exec','/usr/bin/systemctl','--user','is-active',unit],{encoding:'utf8'});
  assert.notEqual(active.status,0,'Orphan scope remains active');
  assert.equal(fs.existsSync(pidFile),false,'Orphan marker remains');
  assert.equal(activeWslCodexForWorktree(root).length,0,'Reaped scope still blocks resume');
  console.log(JSON.stringify({status:'PASS',unit,childExit:child.exitCode}));
} finally {if(child.exitCode===null)child.kill();}

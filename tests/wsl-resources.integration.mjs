import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {root} from '../src/config.mjs';

if(process.platform!=='win32')throw new Error('Windows WSL2 required');
const distro=process.env.WORKSPACE_WSL_DISTRO||'Ubuntu';
const toLinux=file=>{
  const result=spawnSync('wsl.exe',['-d',distro,'--exec','/usr/bin/wslpath','-u',path.resolve(file).replaceAll('\\','/')],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);return result.stdout.trim();
};
const runner=toLinux(path.join(root,'scripts','wsl-codex.sh'));
const cwd=path.resolve('../ai-dev-workspace-sample');
const report=toLinux(path.join(root,'tests','fixtures','wsl-resource-report.sh'));
const burn=toLinux(path.join(root,'tests','fixtures','wsl-cpu-burn.sh'));
const pidFile=path.join(root,'data',`wsl-resource-${randomUUID()}.pid`);
const linuxPid=toLinux(pidFile);
const command=(memory,cpu,program,args=[])=>['-d',distro,'--cd',cwd,'--exec','/usr/bin/systemd-run','--user','--scope',
  '-p',`MemoryMax=${memory}`,'-p','MemorySwapMax=0','-p','TasksMax=128','--','/usr/bin/setsid','--wait','/bin/bash',runner,linuxPid,
  String(cpu),'0',program,...args];
try {
  const measured=spawnSync('wsl.exe',command(268435456,2,'/bin/bash',[report]),{encoding:'utf8',timeout:30000});
  assert.equal(measured.status,0,measured.stderr);
  assert.deepEqual(measured.stdout.trim().split(/\r?\n/),['268435456','2']);
  const exhausted=spawnSync('wsl.exe',command(268435456,1,'/bin/bash',[burn]),{encoding:'utf8',timeout:30000});
  assert.notEqual(exhausted.status,0,'CPU limit did not stop a busy process');
  const memory=spawnSync('wsl.exe',command(134217728,5,'/usr/bin/python3',['-c',"x=bytearray(536870912); x[::4096]=b'x'*(len(x)//4096); print(len(x))"]),
    {encoding:'utf8',timeout:30000});
  assert.notEqual(memory.status,0,'Memory limit did not stop a 512 MiB allocation');
  console.log(JSON.stringify({status:'PASS',memoryMaxBytes:268435456,cpuSeconds:2,burnExit:exhausted.status,memoryExit:memory.status}));
} finally {fs.rmSync(pidFile,{force:true});}

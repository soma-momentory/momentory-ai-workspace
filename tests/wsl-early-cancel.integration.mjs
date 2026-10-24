import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {root} from '../src/config.mjs';
import {stopWslCodex,finishWslCodex} from '../src/wslCodex.mjs';

if(process.platform!=='win32')throw new Error('Windows WSL2 required');
const distro=process.env.WORKSPACE_WSL_DISTRO||'Ubuntu',id=randomUUID(),unit=`ai-dev-workspace-${id}.scope`;
const dir=path.join(root,'data','codex-processes');fs.mkdirSync(dir,{recursive:true});
const pidFile=path.join(dir,`${process.pid}-${id}.pid`),launch={pidFile,distro,unit};
fs.writeFileSync(`${pidFile}.json`,JSON.stringify({cwd:root,distro,unit,owner:process.pid}));
const child=spawn('wsl.exe',['-d',distro,'--exec','/usr/bin/systemd-run','--user','--scope',`--unit=${unit}`,'--','/bin/sleep','120'],{stdio:'ignore',windowsHide:true});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  let active=false;for(let i=0;i<200;i++){const state=spawnSync('wsl.exe',['-d',distro,'--exec','/usr/bin/systemctl','--user','is-active',unit],{encoding:'utf8'});if(state.status===0){active=true;break;}await delay(100);}
  assert.equal(active,true,'Fixture scope did not start');
  assert.equal(fs.existsSync(pidFile),false,'Fixture unexpectedly has a PID checkpoint');
  assert.equal(stopWslCodex(launch,'KILL'),true,'Early cancellation could not stop a scope without a PID file');
  finishWslCodex(launch);
  assert.equal(fs.existsSync(`${pidFile}.json`),false,'Early cancellation left scope metadata');
  console.log(JSON.stringify({status:'PASS',earlyScopeStopped:true}));
}finally{if(child.exitCode===null)child.kill();}

import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {wslCodexConfig,wslTrustedCommandLaunch,asynchronousProbe} from '../src/wslCodex.mjs';

if(process.platform!=='win32')throw new Error('Windows WSL is required');
const cwd=path.resolve('../ai-dev-workspace-sample'),config=wslCodexConfig(cwd);
const oldOverride=process.env.WORKSPACE_WSL_CODEX;
try{
  process.env.WORKSPACE_WSL_CODEX=`${config.worktree}/fake-codex`;
  assert.throws(()=>wslCodexConfig(cwd),/Custom WSL Codex executable override is not allowed/);
}finally{
  if(oldOverride===undefined)delete process.env.WORKSPACE_WSL_CODEX;
  else process.env.WORKSPACE_WSL_CODEX=oldOverride;
}
const windowsCommand=path.join(process.env.SystemRoot||'C:\\Windows','System32','cmd.exe');
const converted=spawnSync('wsl.exe',['-d',config.distro,'--exec','/usr/bin/wslpath','-u',windowsCommand.replaceAll('\\','/')],{encoding:'utf8',timeout:10000});
assert.equal(converted.status,0,converted.stderr);
const command=converted.stdout.trim();
const prefix=['/usr/bin/env',`CODEX_HOME=${config.codexHome}`,config.binary,'sandbox','-p',config.profile,'-P',config.permission,'-C',config.worktree,'--'];
for(const args of [[command,'/c','echo','INTEROP_ESCAPE'],['/init',command,'/c','echo','INTEROP_ESCAPE']]){
  const result=await asynchronousProbe(wslTrustedCommandLaunch(cwd,[...prefix,...args]),60000);
  assert.notEqual(result.status,0,`Windows interop escaped the sandbox: ${result.stdout}`);
  assert.ok(!result.stdout.includes('INTEROP_ESCAPE'),'Windows interop command executed outside the sandbox');
}
console.log(JSON.stringify({status:'PASS',directWindowsExeDenied:true,wslInitDenied:true,customExecutableDenied:true}));

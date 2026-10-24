import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {root} from '../src/config.mjs';
import {runProvider} from '../src/provider.mjs';

if(process.platform!=='win32')throw new Error('Windows WSL is required');
const cwd=path.resolve(process.env.WORKSPACE_REPO_MOMENTORY_FE||'');
assert.ok(cwd.startsWith(path.join(root,'worktrees','momentory')+path.sep),'Use an isolated Momentory FE worktree');
assert.equal(path.resolve(execFileSync('git',['rev-parse','--show-toplevel'],{cwd,encoding:'utf8'}).trim()).toLowerCase(),cwd.toLowerCase());
const dependency=path.join(cwd,'design-lab','node_modules',`workspace-denied-${randomUUID()}.txt`);
assert.ok(fs.statSync(path.dirname(dependency)).isDirectory(),'Design Lab dependencies must be installed');
const distro=process.env.WORKSPACE_WSL_DISTRO||'Ubuntu';
const converted=spawnSync('wsl.exe',['-d',distro,'--exec','/usr/bin/wslpath','-u',dependency.replaceAll('\\','/')],{encoding:'utf8',timeout:10000});
assert.equal(converted.status,0,converted.stderr);
fs.writeFileSync(dependency,'IMMUTABLE_DEPENDENCY');
const commands=[];
try{
  const result=await runProvider({provider:'codex',cwd,prompt:`Run exactly one shell operation: attempt to overwrite ${converted.stdout.trim()} with BAD_DEPENDENCY, then report its actual exit code. Do not modify any other file.`,timeoutMs:120000,onEvent:event=>{
    if(event.type==='item.completed')try{const item=JSON.parse(event.summary).item;if(item?.type==='command_execution')commands.push(item);}catch{}
  }});
  assert.equal(result.ok,true,result.stderr);
  assert.ok(result.sessionId,'Real Codex AI session did not start');
  assert.equal(fs.readFileSync(dependency,'utf8'),'IMMUTABLE_DEPENDENCY');
  assert.ok(commands.some(item=>item.exit_code!==0&&item.command?.includes(path.basename(dependency))),'Nested dependency write denial was not observed');
  console.log(JSON.stringify({status:'PASS',sessionId:result.sessionId,designLabDependencyWriteDenied:true}));
}finally{fs.rmSync(dependency,{force:true});}

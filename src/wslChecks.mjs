import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {root} from './config.mjs';
import {codexProfileName,verifyCodexProfile} from './codexProfile.mjs';
import {childEnv,redact,stopTree} from './provider.mjs';
import {wslCodexConfig,wslCodexLaunch,wslTrustedCommandLaunch,stopWslCodex,finishWslCodex} from './wslCodex.mjs';

export const strictWslChecks=stack=>process.platform==='win32'&&['node','react-native-expo'].includes(stack);
const checkedSetup=new Set();
export function verifyWslSetupBoundary(cwd){
  const config=wslCodexConfig(cwd),key=`${config.distro}|${path.resolve(cwd)}`;
  if(checkedSetup.has(key))return;
  verifyCodexProfile('wsl-setup');
  const id=randomUUID(),allowed=path.join(cwd,`.workspace-setup-${id}`),denied=path.join(root,'data',`setup-denied-${id}`);
  fs.mkdirSync(path.dirname(denied),{recursive:true});
  fs.writeFileSync(allowed,'ALLOWED_SETUP');fs.writeFileSync(denied,'DENIED_SETUP');
  const linux=file=>{
    const result=spawnSync('wsl.exe',['-d',config.distro,'--exec','/usr/bin/wslpath','-u',path.resolve(file).replaceAll('\\','/')],{encoding:'utf8',timeout:10000,windowsHide:true});
    if(result.status!==0)throw new Error('WSL setup path conversion failed');
    return result.stdout.trim();
  };
  try{
    const script='if [ "$(cat "$1" 2>/dev/null)" = ALLOWED_SETUP ]; then echo ALLOWED_READ=1; else echo ALLOWED_READ=0; fi; if cat "$2" >/dev/null 2>&1; then echo OUTSIDE_READ=1; else echo OUTSIDE_READ=0; fi; if printf ALLOWED_WRITE > "$1"; then echo ALLOWED_WRITE=1; else echo ALLOWED_WRITE=0; fi; if printf BAD_WRITE > "$2" 2>/dev/null; then echo OUTSIDE_WRITE=1; else echo OUTSIDE_WRITE=0; fi';
    const args=['-d',config.distro,'--exec','/usr/bin/env',`CODEX_HOME=${config.codexHome}`,config.binary,'sandbox','-p',codexProfileName('wsl-setup'),'-P','workspace-setup','-C',config.worktree,'--','/bin/sh','-c',script,'probe',linux(allowed),linux(denied)];
    const result=spawnSync('wsl.exe',args,{encoding:'utf8',timeout:90000,windowsHide:true});
    const expected=['ALLOWED_READ=1','OUTSIDE_READ=0','ALLOWED_WRITE=1'];
    if(result.status!==0||expected.some(line=>!result.stdout?.includes(line))||fs.readFileSync(allowed,'utf8')!=='ALLOWED_WRITE'||fs.readFileSync(denied,'utf8')!=='DENIED_SETUP')
      throw new Error(`WSL dependency setup boundary failed: ${String(result.stdout||'').slice(-300)} deniedModified=${fs.readFileSync(denied,'utf8')!=='DENIED_SETUP'} ${String(result.stderr||result.error||'').slice(-300)}`);
    checkedSetup.add(key);
  }finally{fs.rmSync(allowed,{force:true});fs.rmSync(denied,{force:true});}
}
const nodeEnvironment=cwd=>{
  const config=wslCodexConfig(cwd),bin=`${config.home}/.local/node_modules/node/bin`;
  const probe=spawnSync('wsl.exe',['-d',config.distro,'--exec',`${bin}/node`,'--version'],{encoding:'utf8',timeout:10000,windowsHide:true});
  if(probe.status!==0||!/^v22\./.test(probe.stdout.trim()))throw new Error('WSL Node 22 is required for isolated checks');
  return {...config,bin,searchPath:`${bin}:/usr/local/bin:/usr/bin:/bin`};
};
function run(launch,cwd,timeoutMs,signal){
  return new Promise(resolve=>{
    const child=spawn(launch.executable,launch.args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],env:childEnv()});
    let output='',timedOut=false,done=false;
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output=(output+chunk.toString('utf8')).slice(-12000);});
    const stop=()=>{if(launch.pidFile)stopWslCodex(launch);stopTree(child);};
    const timer=setTimeout(()=>{timedOut=true;stop();},timeoutMs);
    const abort=()=>stop();signal?.addEventListener('abort',abort,{once:true});
    const finish=(code,error)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);finishWslCodex(launch);resolve({ok:code===0&&!timedOut&&!signal?.aborted,code,timedOut,output:redact(error?`${output}\n${error}`:output)});};
    child.on('error',error=>finish(null,String(error)));
    child.on('close',code=>finish(code));
  });
}
export async function prepareWslDependency(cwd,step,signal){
  const prefix=step.ifMissing==='node_modules'?null:step.ifMissing==='design-lab/node_modules'?'design-lab':null;
  const expected=['npm','ci',...(prefix?['--prefix',prefix]:[]),'--ignore-scripts','--no-audit','--no-fund'];
  if(!prefix&&step.ifMissing!=='node_modules'||JSON.stringify(step.command)!==JSON.stringify(expected))throw new Error('Only the reviewed npm ci --ignore-scripts setup is allowed');
  const protectedFiles=['package.json','package-lock.json','.npmrc',...(prefix?[`${prefix}/package.json`,`${prefix}/package-lock.json`,`${prefix}/.npmrc`]:[])];
  const changed=spawnSync('git',['diff','--name-only','HEAD','--',...protectedFiles],{cwd,encoding:'utf8',timeout:10000,windowsHide:true});
  const untracked=spawnSync('git',['ls-files','--others','--exclude-standard','--',...protectedFiles],{cwd,encoding:'utf8',timeout:10000,windowsHide:true});
  if(changed.status!==0||untracked.status!==0||changed.stdout.trim()||untracked.stdout.trim())throw new Error('Dependency manifest or npm configuration changed in the task worktree');
  const lock=path.join(cwd,prefix||'.','package-lock.json'),manifest=path.join(cwd,prefix||'.','package.json');
  const lockData=JSON.parse(fs.readFileSync(lock,'utf8'));
  for(const item of Object.values(lockData.packages||{}))if(item?.resolved){
    const resolved=String(item.resolved);
    if(resolved.includes('://')){const url=new URL(resolved);if(url.protocol!=='https:'||url.hostname!=='registry.npmjs.org')throw new Error('Dependency lockfile contains an unapproved remote registry');}
    else if(resolved.startsWith('/')||resolved.split(/[\\/]/).includes('..')||resolved.includes(':'))throw new Error('Dependency lockfile contains an unsafe local source');
  }
  const digest=createHash('sha256').update(fs.readFileSync(lock)).update(fs.readFileSync(manifest)).update(JSON.stringify(step.command)).digest('hex');
  const markerDir=path.join(root,'data','check-deps');fs.mkdirSync(markerDir,{recursive:true});
  const marker=path.join(markerDir,`${createHash('sha256').update(path.resolve(cwd)+'|'+step.ifMissing).digest('hex')}.json`);
  if(fs.existsSync(marker)&&fs.existsSync(path.join(cwd,step.ifMissing))){
    try{if(JSON.parse(fs.readFileSync(marker,'utf8')).digest===digest)return {ok:true,output:'Previously prepared Linux dependencies match the locked manifest'};}catch{}
  }
  const config=nodeEnvironment(cwd);
  verifyWslSetupBoundary(cwd);
  const setup=['/usr/bin/env',`PATH=${config.searchPath}`,'npm_config_cache=/tmp/workspace-npm-cache','npm_config_userconfig=/dev/null','npm_config_globalconfig=/tmp/workspace-npm-global-empty','npm_config_registry=https://registry.npmjs.org/','/usr/bin/npm',...step.command.slice(1)];
  const sandbox=[config.binary,'sandbox','-p',codexProfileName('wsl-setup'),'-P','workspace-setup','-C',config.worktree,'--',...setup];
  const launch=wslTrustedCommandLaunch(cwd,sandbox);
  const result=await run(launch,cwd,900000,signal);
  if(result.ok)fs.writeFileSync(marker,JSON.stringify({digest,step:step.ifMissing,preparedAt:new Date().toISOString()}));
  return result;
}
export async function runWslCheck(cwd,command,args,timeoutMs,signal){
  const config=nodeEnvironment(cwd);
  const executable=command==='npm'||command==='npm.cmd'?'/usr/bin/npm':command==='node'||command==='node.exe'?`${config.bin}/node`:null;
  if(!executable)throw new Error(`Unsupported isolated WSL check command: ${command}`);
  const sandbox=['sandbox','-p',config.profile,'-P',config.permission,'-C',config.worktree,'--','/usr/bin/env',`PATH=${config.searchPath}`,executable,...args];
  return run(wslCodexLaunch(cwd,false,sandbox),cwd,timeoutMs,signal);
}

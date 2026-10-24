import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {root} from './config.mjs';
import {codexProfileName,verifyCodexProfile} from './codexProfile.mjs';

const checked=new Set();
const requireResult=(args,{timeout=15000}={})=>{
  const result=spawnSync('wsl.exe',args,{encoding:'utf8',timeout,windowsHide:true});
  if(result.status!==0) throw new Error(`WSL Codex unavailable: ${(result.stderr||result.error||'command failed').toString().slice(-500)}`);
  return result.stdout.trim();
};
const command=(distro,args,options)=>requireResult(['-d',distro,'--exec',...args],options);
const translate=(distro,winPath)=>command(distro,['/usr/bin/wslpath','-u',path.resolve(winPath).replaceAll('\\','/')]);
const runtimeDir=distro=>{
  const uid=command(distro,['/usr/bin/id','-u']);
  if(!/^\d{1,8}$/.test(uid))throw new Error('Invalid WSL user ID');
  return `/run/user/${uid}`;
};
const userSystemctl=(distro,args,knownRuntimeDir)=>{
  let runtime;try{runtime=knownRuntimeDir||runtimeDir(distro);}catch(error){return {status:null,error,stdout:'',stderr:''};}
  if(!/^\/run\/user\/\d{1,8}$/.test(runtime))return {status:null,error:new Error('Invalid WSL runtime directory'),stdout:'',stderr:''};
  return spawnSync('wsl.exe',['-d',distro,'--exec','/usr/bin/env',`XDG_RUNTIME_DIR=${runtime}`,'/usr/bin/systemctl','--user',...args],{encoding:'utf8',timeout:10000,windowsHide:true});
};

export function wslCodexConfig(cwd,readOnly=false) {
  if(process.platform!=='win32')throw new Error('WSL Codex is available only on Windows');
  if(process.env.WORKSPACE_CODEX_BACKEND && process.env.WORKSPACE_CODEX_BACKEND!=='wsl')
    throw new Error('Codex requires the verified WSL backend on Windows');
  const distro=process.env.WORKSPACE_WSL_DISTRO||'Ubuntu';
  if(!/^[A-Za-z0-9._-]{1,60}$/.test(distro))throw new Error('Invalid WSL distribution name');
  const dependencyDirectory=lab=>{
    const labRoot=fs.lstatSync(path.join(cwd,lab),{throwIfNoEntry:false});
    if(labRoot?.isSymbolicLink())throw new Error(`${lab} symlink is not allowed in an isolated worktree`);
    const stat=fs.lstatSync(path.join(cwd,lab,'node_modules'),{throwIfNoEntry:false});
    if(stat?.isSymbolicLink())throw new Error(`${lab} dependencies symlink is not allowed in an isolated worktree`);
    return Boolean(stat?.isDirectory());
  };
  const hasExpoDependencies=dependencyDirectory('expo-lab'),hasDesignDependencies=dependencyDirectory('design-lab');
  for(const name of ['data','node_modules','.gradle','build','out']){
    const target=path.join(cwd,name),stat=fs.lstatSync(target,{throwIfNoEntry:false});
    if(stat&&!stat.isDirectory())throw new Error(`Isolated worktree mount target is not a directory: ${name}`);
    if(!stat)fs.mkdirSync(target);
  }
  const variant=hasExpoDependencies&&hasDesignDependencies?'both':hasExpoDependencies?'expo':hasDesignDependencies?'design':'generic';
  const mode=readOnly?'wsl-readonly':variant==='expo'?'wsl':`wsl-${variant}`;
  const checkMode=variant==='expo'?'wsl-check':`wsl-check-${variant}`;
  verifyCodexProfile(mode);
  const home=command(distro,['/bin/sh','-c','printf %s "$HOME"']);
  const binary=process.env.WORKSPACE_WSL_CODEX||`${home}/.local/node_modules/.bin/codex`;
  if(!binary.startsWith('/')||!command(distro,['/bin/sh','-c','test -x "$1" && printf OK','probe',binary]))
    throw new Error('Linux Codex binary missing in WSL');
  const codexHome=translate(distro,process.env.CODEX_HOME||path.join(os.homedir(),'.codex'));
  const worktree=translate(distro,cwd);
  const runner=translate(distro,path.join(root,'scripts','wsl-codex.sh'));
  return {distro,home,runtimeDir:runtimeDir(distro),mode,profile:codexProfileName(mode),checkProfile:codexProfileName(checkMode),checkMode,permission:readOnly?'workspace-locked-readonly':'workspace-locked',binary,codexHome,worktree,runner};
}

export const asynchronousProbe=(launch,timeout=60000)=>new Promise(resolve=>{
  const child=spawn(launch.executable,launch.args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',done=false,timedOut=false,watchdog=null;
  child.stdout.on('data',chunk=>stdout+=chunk.toString());child.stderr.on('data',chunk=>stderr+=chunk.toString());
  const timer=setTimeout(()=>{timedOut=true;stopWslCodex(launch,'KILL');spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('error',()=>child.kill());watchdog=setTimeout(()=>finish(null,new Error('Probe wrapper did not exit after termination')),5000);watchdog.unref();},timeout);
  const finish=(status,error)=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(watchdog);const scopeStopped=finishWslCodex(launch);resolve({status:timedOut||!scopeStopped?null:status,stdout,stderr:[stderr,error,scopeStopped?'':'WSL probe scope remained active'].filter(Boolean).join('\n'),error});};
  child.on('error',error=>finish(null,error));child.on('close',code=>finish(code));
});
export async function verifyWslCodexBoundary(cwd,readOnly=false) {
  const config=wslCodexConfig(cwd,readOnly);
  const key=`${config.distro}|${cwd}|${config.mode}`;
  if(checked.has(key))return config;
  const suffix=randomUUID(),allowed=path.join(cwd,`.workspace-isolation-${suffix}`);
  const denied=path.join(root,'data',`isolation-canary-${suffix}`);
  fs.mkdirSync(path.dirname(denied),{recursive:true});
  fs.writeFileSync(allowed,'ALLOWED_BOUNDARY');
  fs.writeFileSync(denied,'DENIED_BOUNDARY');
  try {
    const base=['/usr/bin/env',`CODEX_HOME=${config.codexHome}`,config.binary,'sandbox','-p',config.profile,'-P',config.permission,'-C',config.worktree,'--'];
    const probe=args=>asynchronousProbe(wslTrustedCommandLaunch(cwd,[...base,...args]));
    const linuxAllowed=translate(config.distro,allowed),linuxDenied=translate(config.distro,denied);
    const inside=await probe(['/bin/cat',linuxAllowed]);
    if(inside.status!==0||inside.stdout.trim()!=='ALLOWED_BOUNDARY')throw new Error(`Codex isolation cannot read its task worktree: ${(inside.stderr||inside.stdout||'command failed').slice(-350)}`);
    const outside=await probe(['/bin/sh','-c','if cat "$1" >/dev/null 2>&1; then echo OUTSIDE_READ=1; else echo OUTSIDE_READ=0; fi','probe',linuxDenied]);
    if(outside.status!==0||!outside.stdout.includes('OUTSIDE_READ=0')||outside.stdout.includes('DENIED_BOUNDARY'))throw new Error('Codex isolation outside read probe failed or leaked');
    const change=await probe(['/bin/sh','-c','printf ALLOWED_WRITE > "$1"','probe',linuxAllowed]);
    if((change.status===0)!==!readOnly)throw new Error('Codex isolation write rule does not match task mode');
    if(!readOnly&&fs.readFileSync(allowed,'utf8')!=='ALLOWED_WRITE')throw new Error('Codex isolation failed to write in task worktree');
    const deniedWrite=await probe(['/bin/sh','-c','if printf BAD_WRITE > "$1" 2>/dev/null; then echo OUTSIDE_WRITE=1; else echo OUTSIDE_WRITE=0; fi','probe',linuxDenied]);
    if(deniedWrite.status!==0||!deniedWrite.stdout.includes('OUTSIDE_WRITE=0')||fs.readFileSync(denied,'utf8')!=='DENIED_BOUNDARY')throw new Error('Codex isolation outside write probe failed or leaked');
    checked.add(key);
    return config;
  } finally {
    fs.rmSync(allowed,{force:true});
    fs.rmSync(denied,{force:true});
  }
}

const pidDir=path.join(root,'data','codex-processes');
const bounded=(name,fallback,min,max)=>{
  const value=Number(process.env[name]||fallback);
  if(!Number.isInteger(value)||value<min||value>max)throw new Error(`Invalid ${name}`);
  return value;
};
function launchWslScope(config,cwd,command,tasksMax=128){
  fs.mkdirSync(pidDir,{recursive:true});
  const id=randomUUID(),pidFile=path.join(pidDir,`${process.pid}-${id}.pid`),unit=`ai-dev-workspace-${id}.scope`;
  const cpu=bounded('WORKSPACE_CODEX_CPU_SECONDS',600,30,1800);
  const memory=bounded('WORKSPACE_CODEX_MEMORY_KIB',4194304,1048576,8388608);
  const metadata=`${pidFile}.json`,temporary=`${metadata}.${randomUUID()}.tmp`;
  try{
    fs.writeFileSync(temporary,JSON.stringify({cwd:path.resolve(cwd),distro:config.distro,runtimeDir:config.runtimeDir,unit,owner:process.pid}),{flag:'wx'});
    fs.renameSync(temporary,metadata);
  }finally{fs.rmSync(temporary,{force:true});}
  const launchArgs=['-d',config.distro,'--cd',cwd,'--exec','/usr/bin/env',`XDG_RUNTIME_DIR=${config.runtimeDir}`,'/usr/bin/systemd-run','--user','--scope','--expand-environment=no',`--unit=${unit}`,
    '-p',`MemoryMax=${memory*1024}`,'-p','MemorySwapMax=0','-p',`TasksMax=${tasksMax}`,'-p','CPUQuota=200%','--',
    '/usr/bin/setsid','--wait','/bin/bash',config.runner,
    translate(config.distro,pidFile),String(cpu),'0','/usr/bin/env',`CODEX_HOME=${config.codexHome}`,
    ...command];
  return {executable:'wsl.exe',args:launchArgs,pidFile,distro:config.distro,runtimeDir:config.runtimeDir,unit};
}
export async function wslCodexLaunch(cwd,readOnly,args) {
  const config=await verifyWslCodexBoundary(cwd,readOnly);
  const providerArgs=[...args];
  if(providerArgs[0]==='-p'){
    if(!providerArgs[1]?.startsWith('ai-dev-workspace-wsl'))throw new Error('Unexpected WSL Codex profile arguments');
    providerArgs[1]=config.profile;
  }else if(providerArgs[0]!=='sandbox')throw new Error('Unexpected WSL Codex launch arguments');
  return launchWslScope(config,cwd,[config.binary,...providerArgs]);
}
export function wslTrustedCommandLaunch(cwd,command){
  const config=wslCodexConfig(cwd);
  const isGradle=command.includes('GRADLE_USER_HOME='+config.worktree+'/.gradle/workspace-home');
  return launchWslScope(config,cwd,command,isGradle?384:128);
}
export function stopWslCodex(launch,signal='TERM') {
  if(!launch?.pidFile||!launch.distro||!launch.unit)return false;
  if(signal==='KILL')userSystemctl(launch.distro,['kill','--signal=KILL',launch.unit],launch.runtimeDir);
  const stopped=userSystemctl(launch.distro,['stop',launch.unit],launch.runtimeDir);
  const state=userSystemctl(launch.distro,['is-active',launch.unit],launch.runtimeDir);
  return !state.error&&state.status!==null&&state.status!==0&&/^(inactive|failed|unknown)$/m.test(state.stdout.trim())&&!stopped.error;
}
export function finishWslCodex(launch) {
  if(!launch?.pidFile)return true;
  if(!stopWslCodex(launch,'KILL'))return false;
  fs.rmSync(launch.pidFile,{force:true});fs.rmSync(`${launch.pidFile}.json`,{force:true});
  return true;
}
function readScopeMetadata(metadata){
  const match=/^(\d+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.pid\.json$/.exec(metadata);
  if(!match)throw new Error('Invalid WSL process marker name');
  const meta=JSON.parse(fs.readFileSync(path.join(pidDir,metadata),'utf8'));
  if(!meta||typeof meta.cwd!=='string'||!path.isAbsolute(meta.cwd)||!/^[A-Za-z0-9._-]{1,60}$/.test(meta.distro)||(meta.runtimeDir&&!/^\/run\/user\/\d{1,8}$/.test(meta.runtimeDir))||meta.unit!==`ai-dev-workspace-${match[2]}.scope`||meta.owner!==Number(match[1]))throw new Error('Invalid WSL process marker contents');
  return meta;
}
export function activeWslCodexForWorktree(cwd) {
  if(process.platform!=='win32'||!fs.existsSync(pidDir))return [];
  const target=path.resolve(cwd).toLowerCase(),active=[];
  for(const name of fs.readdirSync(pidDir).filter(item=>item.endsWith('.pid.json'))) {
    try {
      const meta=readScopeMetadata(name);
      if(String(meta.cwd).toLowerCase()!==target)continue;
      const state=userSystemctl(meta.distro,['is-active',meta.unit],meta.runtimeDir);
      if(state.status===0||state.error||state.status===null||!/^(inactive|failed|unknown)$/m.test(state.stdout.trim()))active.push(meta.unit);
    }catch{active.push(name);}
  }
  return active;
}
function inactiveLegacyScope(name){
  const match=/^\d+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.pid$/.exec(name);
  if(!match)return false;
  const listed=spawnSync('wsl.exe',['--list','--quiet'],{timeout:10000,windowsHide:true});
  if(listed.status!==0||!listed.stdout?.length)return false;
  const distros=listed.stdout.toString('utf16le').split(/\r?\n/).map(value=>value.trim()).filter(value=>/^[A-Za-z0-9._-]{1,60}$/.test(value));
  if(!distros.length)return false;
  const unit=`ai-dev-workspace-${match[1]}.scope`;
  return distros.every(distro=>{
    const state=userSystemctl(distro,['is-active',unit]);
    if(state.error||state.status===null||state.status===0)return false;
    return /^(inactive|failed|unknown)$/m.test(state.stdout.trim())||/Failed to connect to bus: No such file or directory|execvpe\(\/usr\/bin\/systemctl\) failed: No such file or directory|env: can't execute '\/usr\/bin\/systemctl': No such file or directory/.test(state.stderr);
  });
}
export function reapStaleWslCodex() {
  if(process.platform!=='win32'||!fs.existsSync(pidDir))return [];
  const reaped=[];
  for(const metadata of fs.readdirSync(pidDir).filter(name=>name.endsWith('.pid.json'))) {
    const name=metadata.slice(0,-5),match=/^(\d+)-[0-9a-f-]+\.pid$/.exec(name);
    if(!match)continue;
    const owner=Number(match[1]);
    if(owner===process.pid)continue;
    let alive=true;try{process.kill(owner,0);}catch(error){alive=error.code!=='ESRCH';}
    if(alive)continue;
    let meta;try{meta=readScopeMetadata(metadata);}catch{
      const bytes=fs.readFileSync(path.join(pidDir,metadata));
      if(!bytes.length||bytes.some(byte=>byte!==0)||!inactiveLegacyScope(name))continue;
      const quarantine=path.join(pidDir,'quarantine'),stat=fs.lstatSync(quarantine,{throwIfNoEntry:false});
      if(stat&&!stat.isDirectory())continue;
      if(!stat)fs.mkdirSync(quarantine);
      if(fs.existsSync(path.join(quarantine,metadata))||fs.existsSync(path.join(quarantine,name)))continue;
      fs.renameSync(path.join(pidDir,metadata),path.join(quarantine,metadata));
      if(fs.existsSync(path.join(pidDir,name)))fs.renameSync(path.join(pidDir,name),path.join(quarantine,name));
      reaped.push(name);
      continue;
    }
    const launch={pidFile:path.join(pidDir,name),distro:meta.distro,runtimeDir:meta.runtimeDir,unit:meta.unit};
    if(stopWslCodex(launch,'KILL')){reaped.push(name);fs.rmSync(launch.pidFile,{force:true});fs.rmSync(`${launch.pidFile}.json`,{force:true});}
  }
  return reaped;
}

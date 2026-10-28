import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {gradleLockfiles,verifyGradleLocks,gradleLockPreflight} from './gradleLocks.mjs';
import {spawn,spawnSync} from 'node:child_process';
import {root} from './config.mjs';
import {codexProfileName,verifyCodexProfile} from './codexProfile.mjs';
import {childEnv,macChildEnv,redact,stopTree} from './provider.mjs';
import {wslCodexConfig,wslTrustedCommandLaunch,stopWslCodex,finishWslCodex,asynchronousProbe,activeWslCodexForWorktree} from './wslCodex.mjs';

export const strictWslChecks=stack=>process.platform==='win32'&&['node','react-native-expo','spring'].includes(stack);
const checkedSetup=new Set();
export function dependencyLinksSafe(mount,approvedLinks=new Map()){
  try{
    const base=fs.realpathSync(mount),stack=[base];
    if(base!==path.resolve(mount))return false;
    const device=fs.statSync(base).dev;
    if(device!==fs.statSync(path.dirname(base)).dev)return false;
    let visited=0;
    while(stack.length){
      const directory=stack.pop();
      for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
        if(++visited>500000)return false;
        const location=path.join(directory,entry.name);
        if(fs.statSync(location).dev!==device)return false;
        if(entry.isSymbolicLink()){
          const target=fs.realpathSync(location);
          if(!target.startsWith(base+path.sep)&&approvedLinks.get(location)!==target)return false;
        }else if(entry.isDirectory())stack.push(location);
      }
    }
    return true;
  }catch{return false;}
}
function reviewedWorkspaceLinks(cwd,prefix,locked){
  const base=path.resolve(cwd,prefix),links=new Map(),manifests=[];
  for(const [relative,meta] of Object.entries(locked.packages||{}))if(meta.link){
    const location=path.resolve(base,relative),target=path.resolve(base,String(meta.resolved||''));
    if(!relative.startsWith('node_modules/')||!location.startsWith(path.join(base,'node_modules')+path.sep)||!target.startsWith(base+path.sep)||!locked.packages[meta.resolved]||fs.realpathSync(target)!==target||fs.statSync(target).dev!==fs.statSync(base).dev)throw new Error('Unreviewed npm workspace link');
    const manifest=path.join(target,'package.json');
    if(fs.realpathSync(manifest)!==manifest||!fs.statSync(manifest).isFile())throw new Error('Unreviewed npm workspace manifest');
    links.set(location,target);manifests.push(manifest);
  }
  return {links,manifests:[...new Set(manifests)].sort()};
}
function npmSetupDigest(lock,manifest,command,workspace){
  const hash=createHash('sha256').update(fs.readFileSync(lock)).update(fs.readFileSync(manifest)).update(JSON.stringify(command));
  for(const file of workspace?.manifests||[])hash.update('\0'+path.relative(path.dirname(manifest),file)+'\0').update(fs.readFileSync(file));
  return hash.digest('hex');
}
export function cleanupStaleBoundaryCanaries(cwd){
  if(process.platform!=='win32')return [];
  const files=fs.readdirSync(cwd).filter(name=>/^\.workspace-(?:setup|isolation)-[0-9a-f-]{36}$/.test(name));
  if(!files.length)return [];
  if(activeWslCodexForWorktree(cwd).length)throw new Error('Active isolated scope owns a boundary canary');
  const removed=[];
  for(const name of files){
    const target=path.join(cwd,name),stat=fs.lstatSync(target);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64)throw new Error(`Unreviewed boundary canary: ${name}`);
    const content=fs.readFileSync(target,'utf8');
    if(!['ALLOWED_SETUP','ALLOWED_WRITE','ALLOWED_BOUNDARY'].includes(content))throw new Error(`Unreviewed boundary canary: ${name}`);
    fs.rmSync(target);removed.push(name);
  }
  return removed;
}
export function preparedNpmDependency(cwd,step,platform=process.platform){
  if(!step||!['node_modules','design-lab/node_modules'].includes(step.ifMissing))return false;
  const prefix=step.ifMissing==='node_modules'?'.':'design-lab';
  const lock=path.join(cwd,prefix,'package-lock.json'),manifest=path.join(cwd,prefix,'package.json');
  const hiddenLock=path.join(cwd,step.ifMissing,'.package-lock.json');
  if(!fs.existsSync(lock)||!fs.existsSync(manifest)||!fs.existsSync(hiddenLock))return false;
  const marker=path.join(root,'data','check-deps',`${createHash('sha256').update(path.resolve(cwd)+'|'+step.ifMissing).digest('hex')}.json`);
  if(!fs.existsSync(marker))return false;
  try{
    const installed=JSON.parse(fs.readFileSync(hiddenLock,'utf8'));
    const locked=JSON.parse(fs.readFileSync(lock,'utf8'));
    const workspace=platform==='darwin'?reviewedWorkspaceLinks(cwd,prefix,locked):null;
    const digest=npmSetupDigest(lock,manifest,step.command,workspace);
    const entries=Object.entries(installed.packages||{});
    const required=Object.entries(locked.packages||{}).filter(([name,meta])=>name&&!meta.optional);
    const base=path.resolve(cwd,prefix);
    const mount=path.join(cwd,step.ifMissing);
    if(fs.lstatSync(mount).isSymbolicLink()||fs.realpathSync(mount)!==path.resolve(mount))return false;
    const complete=entries.length>0&&entries.every(([relative,meta])=>{
      if(!relative||relative.split(/[\\/]/).includes('..'))return false;
      if(platform==='darwin'){
        const reviewed=locked.packages?.[relative];
        if(!reviewed||['version','resolved','integrity','link'].some(key=>reviewed[key]!==meta[key]))return false;
      }
      const location=path.resolve(base,relative);
      if(!location.startsWith(base+path.sep))return false;
      const target=meta?.link?path.resolve(base,String(meta.resolved||'')):location;
      return target.startsWith(base+path.sep)&&fs.existsSync(path.join(target,'package.json'))&&fs.realpathSync(target).startsWith(base+path.sep);
    });
    const record=JSON.parse(fs.readFileSync(marker,'utf8'));
    return record.digest===digest&&(platform!=='darwin'||record.platform==='darwin'&&dependencyLinksSafe(mount,workspace.links))&&complete&&required.every(([name])=>Object.hasOwn(installed.packages,name));
  }catch{return false;}
}
export function approvedIgnoredMounts(cwd,repoConfig){
  if(repoConfig.stack==='spring')return process.platform==='darwin'?new Set():new Set(['.gradle/','build/','out/']);
  return new Set((repoConfig.setup||[])
    .filter(step=>['node_modules','design-lab/node_modules'].includes(step.ifMissing))
    .filter(step=>preparedNpmDependency(cwd,step))
    .map(step=>`${step.ifMissing}/`));
}
export async function verifyWslSetupBoundary(cwd,mode='wsl-setup'){
  if(!['wsl-setup','wsl-check','wsl-check-generic','wsl-lab'].includes(mode))throw new Error('Invalid WSL check boundary mode');
  const config=wslCodexConfig(cwd),profileMode=mode==='wsl-check'?config.checkMode:mode;
  const key=`${config.distro}|${path.resolve(cwd)}|${profileMode}`;
  if(checkedSetup.has(key))return;
  verifyCodexProfile(profileMode);
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
    const permission=mode.startsWith('wsl-check')?'workspace-check-locked':mode==='wsl-lab'?'workspace-lab':'workspace-setup';
    const args=['/usr/bin/env',`CODEX_HOME=${config.codexHome}`,config.binary,'sandbox','-p',codexProfileName(profileMode),'-P',permission,'-C',config.worktree,'--','/bin/sh','-c',script,'probe',linux(allowed),linux(denied)];
    const result=await asynchronousProbe(wslTrustedCommandLaunch(cwd,args),90000);
    const expected=['ALLOWED_READ=1','OUTSIDE_READ=0','ALLOWED_WRITE=1'];
    // MXC may shadow a denied write and return success inside the sandbox. The
    // security boundary is the host canary: it must remain byte-for-byte intact.
    if(result.status!==0||expected.some(line=>!result.stdout?.includes(line))||!/OUTSIDE_WRITE=[01]/.test(result.stdout||'')||fs.readFileSync(allowed,'utf8')!=='ALLOWED_WRITE'||fs.readFileSync(denied,'utf8')!=='DENIED_SETUP')
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
    if(signal?.aborted){finishWslCodex(launch);resolve({ok:false,code:null,timedOut:false,output:'Cancelled before check start'});return;}
    const child=spawn(launch.executable,launch.args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],env:childEnv()});
    let output='',timedOut=false,done=false,watchdog=null;
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output=(output+chunk.toString('utf8')).slice(-12000);});
    const stop=()=>{if(launch.pidFile)stopWslCodex(launch);stopTree(child);};
    const armWatchdog=()=>{if(!watchdog){watchdog=setTimeout(()=>finish(null,'Check wrapper did not exit after termination'),5000);watchdog.unref();}};
    const timer=setTimeout(()=>{timedOut=true;stop();armWatchdog();},timeoutMs);
    const abort=()=>{stop();armWatchdog();};signal?.addEventListener('abort',abort,{once:true});
    const finish=(code,error)=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(watchdog);signal?.removeEventListener('abort',abort);const scopeStopped=finishWslCodex(launch);resolve({ok:code===0&&!timedOut&&!signal?.aborted&&scopeStopped,code,timedOut,output:redact([output,error,scopeStopped?'':'WSL process scope remained active'].filter(Boolean).join('\n'))});};
    child.on('error',error=>finish(null,String(error)));
    child.on('close',code=>finish(code));
  });
}
const gradleShell=String.raw`tr -d '\r' < gradlew | sh -s -- "$@"`;
const gradleEnvironment=(config,agent=null)=>['/usr/bin/env',`GRADLE_USER_HOME=${config.worktree}/.gradle/workspace-home`,'JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64',`JAVA_TOOL_OPTIONS=-XX:ActiveProcessorCount=2 -Djava.io.tmpdir=${config.worktree}/.gradle/workspace-tmp${agent?` -javaagent:${agent}`:''}`,`TMPDIR=${config.worktree}/.gradle/workspace-tmp`,`PATH=${config.searchPath}`];
function cachedByteBuddyAgent(cwd,config){
  const base=path.join(cwd,'.gradle','workspace-home','caches','modules-2','files-2.1','net.bytebuddy','byte-buddy-agent');
  if(!fs.existsSync(base))return null;
  const files=fs.readdirSync(base,{recursive:true}).filter(name=>/^byte-buddy-agent-[0-9.]+\.jar$/.test(path.basename(name)));
  if(files.length!==1)throw new Error('Expected exactly one cached Byte Buddy agent for the isolated Spring check');
  const file=path.join(base,files[0]);
  if(!fs.statSync(file).isFile()||fs.realpathSync(file)!==path.resolve(file))throw new Error('Invalid cached Byte Buddy agent path');
  return `${config.worktree}/.gradle/workspace-home/caches/modules-2/files-2.1/net.bytebuddy/byte-buddy-agent/${files[0].replaceAll('\\','/')}`;
}
function cachedGradleExecutable(cwd,config){
  const base=path.join(cwd,'.gradle','workspace-home','wrapper','dists');
  if(!fs.existsSync(base))throw new Error('Reviewed Gradle distribution is missing');
  const files=fs.readdirSync(base,{recursive:true}).filter(name=>/(?:^|[\\/])gradle-[^\\/]+[\\/]bin[\\/]gradle$/.test(name));
  if(files.length!==1)throw new Error('Expected exactly one cached Gradle executable');
  const file=path.join(base,files[0]);
  if(!fs.statSync(file).isFile()||fs.realpathSync(file)!==path.resolve(file))throw new Error('Invalid cached Gradle executable');
  return `${config.worktree}/.gradle/workspace-home/wrapper/dists/${files[0].replaceAll('\\','/')}`;
}
const wslGradleFiles=['build.gradle.kts','build.gradle','settings.gradle.kts','settings.gradle','gradle.properties','gradlew','gradle','buildSrc','build-logic',...gradleLockfiles];
export function reviewWslGradleLocks(cwd){
  const files=wslGradleFiles;
  const status=spawnSync('git',['status','--porcelain','--untracked-files=all','--',...files],{cwd,encoding:'utf8',timeout:10000,windowsHide:true});
  const ignoredBuildInputs=spawnSync('git',['ls-files','--others','--ignored','--exclude-standard','--','gradle','buildSrc','build-logic'],{cwd,encoding:'utf8',timeout:10000,windowsHide:true});
  if(status.status!==0||ignoredBuildInputs.status!==0||status.stdout.trim()||ignoredBuildInputs.stdout.trim())throw new Error('Gradle build inputs or wrapper changed in the task worktree');
  const tracked=spawnSync('git',['ls-files','-z','--',...gradleLockfiles],{cwd,encoding:'utf8',timeout:10000,windowsHide:true});
  if(tracked.status!==0||JSON.stringify(tracked.stdout.split('\0').filter(Boolean).sort())!==JSON.stringify([...gradleLockfiles].sort()))throw new Error('Required Gradle lockfiles are not tracked at their root paths');
  return verifyGradleLocks(cwd);
}
async function prepareWslGradle(cwd,step,signal){
  if(step.ifMissing!=='.gradle/workspace-home'||JSON.stringify(step.command)!==JSON.stringify(['./gradlew','dependencies','--configuration','testRuntimeClasspath','--no-daemon']))throw new Error('Only the reviewed Gradle dependency setup is allowed');
  const files=wslGradleFiles,lockHashes=reviewWslGradleLocks(cwd);
  const userHome=path.join(cwd,'.gradle','workspace-home');
  const initDir=path.join(userHome,'init.d');
  if(fs.existsSync(path.join(userHome,'init.gradle'))||fs.existsSync(path.join(userHome,'gradle.properties'))||fs.existsSync(initDir)&&fs.readdirSync(initDir).length)throw new Error('Unreviewed Gradle user-home script or properties');
  const wrapper=fs.readFileSync(path.join(cwd,'gradle','wrapper','gradle-wrapper.properties'),'utf8');
  if(!/distributionUrl=https\\?:\/\/services\.gradle\.org\/distributions\/gradle-[0-9.]+-bin\.zip/.test(wrapper))throw new Error('Unapproved Gradle distribution URL');
  const markerDir=path.join(root,'data','check-deps');fs.mkdirSync(markerDir,{recursive:true});
  const marker=path.join(markerDir,`${createHash('sha256').update(path.resolve(cwd)+'|gradle').digest('hex')}.json`);
  const digest=createHash('sha256');for(const file of files)if(fs.existsSync(path.join(cwd,file))&&fs.statSync(path.join(cwd,file)).isFile())digest.update(fs.readFileSync(path.join(cwd,file)));
  const configurations=['compileClasspath','testCompileClasspath','testRuntimeClasspath'];
  const initScript=`gradle.projectsEvaluated {\n  gradle.rootProject.tasks.register('workspaceResolveDependencies') {\n    doLast {\n      gradle.rootProject.allprojects.each { project ->\n        ${JSON.stringify(configurations)}.each { name ->\n          def configuration = project.configurations.findByName(name)\n          if (configuration != null && configuration.canBeResolved) {\n            configuration.files.each { artifact -> if (!artifact.isFile()) throw new GradleException("Missing artifact: " + artifact) }\n          }\n        }\n      }\n    }\n  }\n}\n`;
  digest.update(wrapper).update(JSON.stringify(step.command)).update(initScript);const expected=digest.digest('hex');
  if(fs.existsSync(marker)&&fs.existsSync(path.join(cwd,step.ifMissing))){
    try{const record=JSON.parse(fs.readFileSync(marker,'utf8'));if(record.digest===expected&&gradleLockfiles.every(name=>record.lockSha256?.[name]===lockHashes[name]))return {ok:true,output:'Previously prepared Gradle dependencies match the reviewed build files'};}catch{}
    throw new Error('Existing Gradle cache cannot enter a network-enabled setup after build inputs changed; use a fresh isolated worktree');
  }
  if(fs.existsSync(userHome))throw new Error('Unreviewed Gradle cache exists before network-enabled setup');
  const entireStatus=spawnSync('git',['status','--porcelain','--untracked-files=all'],{cwd,encoding:'utf8',timeout:10000,windowsHide:true});
  if(entireStatus.status!==0||entireStatus.stdout.trim())throw new Error('Network-enabled Gradle setup requires a clean committed task worktree');
  const config=nodeEnvironment(cwd);
  fs.mkdirSync(path.join(cwd,'.gradle','workspace-tmp'),{recursive:true});
  const java=spawnSync('wsl.exe',['-d',config.distro,'--exec','/usr/bin/java','-version'],{encoding:'utf8',timeout:10000,windowsHide:true});
  if(java.status!==0||!/version "21\./.test(java.stderr))throw new Error('WSL OpenJDK 21 is required for Spring checks');
  await verifyWslSetupBoundary(cwd);
  const initPath=path.join(cwd,'.gradle','workspace-setup.init.gradle');
  fs.writeFileSync(initPath,initScript,{mode:0o600});
  const sandbox=[config.binary,'sandbox','-p',codexProfileName('wsl-setup'),'-P','workspace-setup','-C',config.worktree,'--',...gradleEnvironment(config),'/bin/sh','-c',`${gradleLockPreflight(lockHashes)}; ${gradleShell}`,'gradlew','--init-script',`${config.worktree}/.gradle/workspace-setup.init.gradle`,'workspaceResolveDependencies','--no-daemon','--max-workers=2'];
  const result=await run(wslTrustedCommandLaunch(cwd,sandbox),cwd,900000,signal);
  if(!result.ok)return result;
  verifyGradleLocks(cwd,lockHashes);
  fs.writeFileSync(marker,JSON.stringify({digest:expected,lockSha256:lockHashes,step:step.ifMissing,preparedAt:new Date().toISOString()}));
  return result;
}
export function validateReviewedNpmSetup(cwd,step){
  if(fs.realpathSync(cwd)!==path.resolve(cwd))throw new Error('Dependency worktree must have a canonical path');
  const prefix=step.ifMissing==='node_modules'?null:step.ifMissing==='design-lab/node_modules'?'design-lab':null;
  const expected=['npm','ci',...(prefix?['--prefix',prefix]:[]),'--ignore-scripts','--no-audit','--no-fund'];
  if(!prefix&&step.ifMissing!=='node_modules'||JSON.stringify(step.command)!==JSON.stringify(expected))throw new Error('Only the reviewed npm ci --ignore-scripts setup is allowed');
  const protectedFiles=['package.json','package-lock.json','.npmrc',...(prefix?[`${prefix}/package.json`,`${prefix}/package-lock.json`,`${prefix}/.npmrc`]:[])];
  const earlyLock=path.join(cwd,prefix||'.','package-lock.json');
  if(fs.realpathSync(earlyLock)!==path.resolve(earlyLock)||!fs.statSync(earlyLock).isFile())throw new Error('Dependency lockfile crosses a symbolic link');
  const workspace=process.platform==='darwin'?reviewedWorkspaceLinks(cwd,prefix||'.',JSON.parse(fs.readFileSync(earlyLock,'utf8'))):null;
  for(const manifest of workspace?.manifests||[])protectedFiles.push(path.relative(cwd,manifest),path.relative(cwd,path.join(path.dirname(manifest),'.npmrc')));
  const reviewGit=args=>spawnSync(process.platform==='darwin'?'/usr/bin/git':'git',process.platform==='darwin'?['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null',...args]:args,{cwd,encoding:'utf8',timeout:10000,windowsHide:true,...(process.platform==='darwin'?{env:macChildEnv('/usr/bin:/bin',{GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'})}:{})});
  const changed=reviewGit(['diff','--no-ext-diff','--no-textconv','--name-only','HEAD','--',...protectedFiles]);
  const untracked=reviewGit(['ls-files','--others','--exclude-standard','--',...protectedFiles]);
  const ignoredConfig=reviewGit(['ls-files','--others','--ignored','--exclude-standard','--',...protectedFiles.filter(file=>path.basename(file)==='.npmrc')]);
  if(changed.status!==0||untracked.status!==0||ignoredConfig.status!==0||changed.stdout.trim()||untracked.stdout.trim()||ignoredConfig.stdout.trim())throw new Error('Dependency manifest or npm configuration changed in the task worktree');
  const lock=path.join(cwd,prefix||'.','package-lock.json'),manifest=path.join(cwd,prefix||'.','package.json');
  if([lock,manifest].some(file=>fs.realpathSync(file)!==path.resolve(file)||!fs.statSync(file).isFile()))throw new Error('Dependency manifest or lockfile crosses a symbolic link');
  const lockData=JSON.parse(fs.readFileSync(lock,'utf8'));
  for(const item of Object.values(lockData.packages||{}))if(item?.resolved){
    const resolved=String(item.resolved);
    if(resolved.includes('://')){const url=new URL(resolved);if(url.protocol!=='https:'||url.hostname!=='registry.npmjs.org'||!/^sha(?:256|384|512)-[A-Za-z0-9+/=]+$/.test(item.integrity||''))throw new Error('Dependency lockfile contains an unapproved remote registry or missing integrity hash');}
    else if(resolved.startsWith('/')||resolved.split(/[\\/]/).includes('..')||resolved.includes(':'))throw new Error('Dependency lockfile contains an unsafe local source');
  }
  const digest=npmSetupDigest(lock,manifest,step.command,workspace);
  const markerDir=path.join(root,'data','check-deps');fs.mkdirSync(markerDir,{recursive:true});
  const marker=path.join(markerDir,`${createHash('sha256').update(path.resolve(cwd)+'|'+step.ifMissing).digest('hex')}.json`);
  return {prefix,digest,marker,lock,manifest};
}
export async function prepareWslDependency(cwd,step,signal){
  if(step.ifMissing==='.gradle/workspace-home')return prepareWslGradle(cwd,step,signal);
  const {digest,marker}=validateReviewedNpmSetup(cwd,step);
  if(preparedNpmDependency(cwd,step))return {ok:true,output:'Previously prepared Linux dependencies match the locked manifest and installed package index'};
  const config=nodeEnvironment(cwd);
  await verifyWslSetupBoundary(cwd);
  const nonce=randomUUID(),npmCache=`/tmp/workspace-npm-${nonce}`,npmUser=`/tmp/workspace-npm-user-${nonce}`;
  const setup=['/usr/bin/env',`PATH=${config.searchPath}`,`npm_config_cache=${npmCache}`,`npm_config_userconfig=${npmUser}`,'npm_config_globalconfig=/dev/null','npm_config_registry=https://registry.npmjs.org/','/usr/bin/npm',...step.command.slice(1)];
  const sandbox=[config.binary,'sandbox','-p',codexProfileName('wsl-setup'),'-P','workspace-setup','-C',config.worktree,'--',...setup];
  let result=await run(wslTrustedCommandLaunch(cwd,sandbox),cwd,900000,signal);
  if(!result.ok&&!signal?.aborted&&/ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/.test(result.output)){
    const firstFailure=result.output.slice(-1200);
    const retry=await run(wslTrustedCommandLaunch(cwd,sandbox),cwd,900000,signal);
    result={...retry,output:`First dependency fetch failed transiently; one retry attempted.\nFirst failure: ${firstFailure}\nRetry: ${retry.output}`};
  }
  spawnSync('wsl.exe',['-d',config.distro,'--exec','/bin/rm','-rf','--',npmCache],{encoding:'utf8',timeout:60000,windowsHide:true});
  if(result.ok)fs.writeFileSync(marker,JSON.stringify({digest,step:step.ifMissing,preparedAt:new Date().toISOString()}));
  return result;
}
export async function runWslCheck(cwd,command,args,timeoutMs,signal){
  const config=nodeEnvironment(cwd);
  if(command==='gradlew.bat'||command==='./gradlew'){
    const marker=path.join(root,'data','check-deps',`${createHash('sha256').update(path.resolve(cwd)+'|gradle').digest('hex')}.json`);
    let lockHashes,preflight;
    try{lockHashes=JSON.parse(fs.readFileSync(marker,'utf8')).lockSha256;preflight=gradleLockPreflight(lockHashes);reviewWslGradleLocks(cwd);verifyGradleLocks(cwd,lockHashes);}catch{throw new Error('Reviewed Gradle lockfile marker is missing or changed');}
    await verifyWslSetupBoundary(cwd,'wsl-check-generic');
    fs.mkdirSync(path.join(cwd,'.gradle','workspace-tmp'),{recursive:true});
    const commandArgs=[...args,'--offline','--no-daemon','--rerun-tasks','--max-workers=2'];
    const sandbox=['/usr/bin/unshare','-Urn','/bin/sh','-c','/usr/sbin/ip link set lo up && exec "$@"','outer','/usr/bin/env',`CODEX_HOME=${config.codexHome}`,config.binary,'sandbox','-p',codexProfileName('wsl-check-generic'),'-P','workspace-check-locked','-C',config.worktree,'--',...gradleEnvironment(config,cachedByteBuddyAgent(cwd,config)),'/bin/sh','-c',`${preflight}; exec "$@"`,'gradle-check',cachedGradleExecutable(cwd,config),...commandArgs];
    const result=await run(wslTrustedCommandLaunch(cwd,sandbox),cwd,timeoutMs,signal);
    verifyGradleLocks(cwd,lockHashes);
    return result;
  }
  const executable=command==='npm'||command==='npm.cmd'?'/usr/bin/npm':command==='node'||command==='node.exe'?`${config.bin}/node`:null;
  if(!executable)throw new Error(`Unsupported isolated WSL check command: ${command}`);
  for(const relative of ['caches/modules-2/files-2.1','wrapper/dists'])fs.mkdirSync(path.join(cwd,'.gradle','workspace-home',relative),{recursive:true});
  await verifyWslSetupBoundary(cwd,'wsl-check');
  const sandbox=['sandbox','-p',config.profile,'-P',config.permission,'-C',config.worktree,'--','/usr/bin/env',`PATH=${config.searchPath}`,executable,...args];
  return run(wslTrustedCommandLaunch(cwd,['/usr/bin/env',`CODEX_HOME=${config.codexHome}`,config.binary,...sandbox]),cwd,timeoutMs,signal);
}

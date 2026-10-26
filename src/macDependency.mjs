import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {root} from './config.mjs';
import {codexProfileName,verifyCodexProfile} from './codexProfile.mjs';
import {macChildEnv,redact,stopTree,trackMacProcess,verifyMacProcessSupport} from './provider.mjs';
import {trustedMacFile,trustedMacRuntime,validateMacWorktree} from './macTrust.mjs';
import {preparedNpmDependency,validateReviewedNpmSetup} from './wslChecks.mjs';

export function sandboxRun(cwd,command,args,environment,signal,timeoutMs=900000){
  return new Promise(resolve=>{
    if(signal?.aborted){resolve({ok:false,code:null,timedOut:false,output:'Cancelled before macOS setup'});return;}
    verifyMacProcessSupport();
    const child=spawn(command,args,{cwd,env:environment,detached:true,stdio:['ignore','pipe','pipe']});
    const tracker=trackMacProcess(child,cwd);
    let output='',done=false,timedOut=false,watchdog;
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output=(output+chunk.toString()).slice(-12000);});
    const finish=(code,error)=>{if(done)return;if(signal?.aborted||timedOut)stopTree(child,'SIGKILL');const cleaned=tracker.finish();done=true;clearTimeout(timer);clearTimeout(watchdog);signal?.removeEventListener('abort',abort);resolve({ok:code===0&&!timedOut&&!signal?.aborted&&!error&&cleaned,code,timedOut,output:redact([output,error,cleaned?'':'macOS process cleanup could not be verified'].filter(Boolean).join('\n'))});};
    const stop=()=>{stopTree(child);watchdog??=setTimeout(()=>{stopTree(child,'SIGKILL');finish(null,'macOS setup process did not exit');},5000);watchdog.unref();};
    const timer=setTimeout(()=>{timedOut=true;stop();},timeoutMs);
    const abort=()=>stop();signal?.addEventListener('abort',abort,{once:true});
    child.on('error',error=>finish(null,error));child.on('close',code=>finish(code));
  });
}

function version(command,args,cwd,environment,pattern,label){
  const result=spawnSync(command,args,{cwd,env:environment,encoding:'utf8',timeout:10000});
  if(result.status!==0||!pattern.test(result.stdout.trim()))throw new Error(`Pinned macOS ${label} version check failed`);
  return result.stdout.trim();
}

export async function verifyMacSetupBoundary(cwd,runtime,signal,mode='posix-setup'){
  if(process.platform!=='darwin')throw new Error('macOS setup boundary requires macOS');
  validateMacWorktree(cwd);
  if(!['posix-setup','posix-lab'].includes(mode))throw new Error('Invalid macOS boundary mode');
  verifyCodexProfile(mode);
  const id=randomUUID(),allowed=path.join(cwd,`.workspace-setup-${id}`),denied=path.join(root,'data',`setup-denied-${id}`),linked=path.join(cwd,`.workspace-linked-${id}`);
  fs.mkdirSync(path.dirname(denied),{recursive:true});
  try{
    fs.writeFileSync(allowed,'ALLOWED_SETUP',{flag:'wx'});fs.writeFileSync(denied,'DENIED_SETUP',{flag:'wx'});fs.symlinkSync(denied,linked);
    const script='if [ "$(cat "$1" 2>/dev/null)" = ALLOWED_SETUP ]; then echo ALLOWED_READ=1; else echo ALLOWED_READ=0; fi; if cat "$2" >/dev/null 2>&1; then echo OUTSIDE_READ=1; else echo OUTSIDE_READ=0; fi; if cat "$3" >/dev/null 2>&1; then echo LINK_READ=1; else echo LINK_READ=0; fi; if printf ALLOWED_WRITE > "$1"; then echo ALLOWED_WRITE=1; else echo ALLOWED_WRITE=0; fi; if printf BAD_WRITE > "$2" 2>/dev/null; then echo OUTSIDE_WRITE=1; else echo OUTSIDE_WRITE=0; fi; if printf BAD_LINK > "$3" 2>/dev/null; then echo LINK_WRITE=1; else echo LINK_WRITE=0; fi';
    const args=['sandbox','-p',codexProfileName(mode),'-P',mode==='posix-lab'?'workspace-lab':'workspace-setup','-C',cwd,'--','/bin/sh','-c',script,'probe',allowed,denied,linked];
    const result=await sandboxRun(cwd,runtime.codex,args,macChildEnv(runtime.path),signal,90000);
    if(!result.ok||!result.output.includes('ALLOWED_READ=1')||!result.output.includes('OUTSIDE_READ=0')||!result.output.includes('LINK_READ=0')||!result.output.includes('ALLOWED_WRITE=1')||fs.readFileSync(allowed,'utf8')!=='ALLOWED_WRITE'||fs.readFileSync(denied,'utf8')!=='DENIED_SETUP')
      throw new Error(`macOS dependency sandbox boundary failed: ${result.output.slice(-500)}`);
  }finally{fs.rmSync(linked,{force:true});fs.rmSync(allowed,{force:true});fs.rmSync(denied,{force:true});}
}

export async function prepareMacDependency(cwd,step,signal){
  if(process.platform!=='darwin')throw new Error('Trusted macOS dependency preparation requires macOS');
  validateMacWorktree(cwd);
  if(step?.ifMissing==='.gradle/workspace-home')return (await import('./macGradle.mjs')).prepareMacGradle(cwd,step,signal);
  const {digest,marker}=validateReviewedNpmSetup(cwd,step);
  const runtime=trustedMacRuntime(cwd),npm=trustedMacFile('npm',cwd);
  const cache=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-mac-npm-'));
  try{
    // npm rejects loading the same file as both its user and global config.
    // Keep a distinct, empty per-run user config, never the host's .npmrc.
    const userConfig=path.join(cache,'user.npmrc');
    fs.writeFileSync(userConfig,'',{flag:'wx',mode:0o600});
    const environment=macChildEnv(runtime.path,{npm_config_userconfig:userConfig,npm_config_globalconfig:'/dev/null',npm_config_registry:'https://registry.npmjs.org/'});
    version(runtime.node,['--version'],cwd,environment,/^v22\./,'Node');
    version(runtime.node,[npm,'--version'],cwd,environment,/^(?:10|11)\./,'npm');
    version(runtime.codex,['--version'],cwd,environment,/\d+\.\d+/,'Codex');
    if(preparedNpmDependency(cwd,step))return {ok:true,output:'Previously prepared macOS dependencies match the locked manifest and installed package index'};
    const mount=path.join(cwd,step.ifMissing);
    if(fs.lstatSync(mount,{throwIfNoEntry:false})||fs.lstatSync(marker,{throwIfNoEntry:false}))throw new Error('Unverified dependency mount or marker exists; use a fresh isolated worktree');
    await verifyMacSetupBoundary(cwd,runtime,signal);
    const args=['sandbox','-p',codexProfileName('posix-setup'),'-P','workspace-setup','-C',cwd,'--',runtime.node,npm,...step.command.slice(1)];
    const result=await sandboxRun(cwd,runtime.codex,args,{...environment,npm_config_cache:cache},signal);
    if(!result.ok)return result;
    fs.writeFileSync(marker,JSON.stringify({digest,step:step.ifMissing,platform:'darwin',preparedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});
    if(!preparedNpmDependency(cwd,step)){fs.rmSync(marker,{force:true});return {ok:false,code:null,timedOut:false,output:'Installed dependency index failed locked-install validation'};}
    return result;
  }finally{
    if(path.dirname(cache)===os.tmpdir()&&path.basename(cache).startsWith('workspace-mac-npm-'))fs.rmSync(cache,{recursive:true,force:true});
  }
}

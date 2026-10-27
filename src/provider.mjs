import { spawn,spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {root} from './config.mjs';
import {codexProfileName,verifyCodexProfile} from './codexProfile.mjs';
import {wslCodexLaunch,stopWslCodex,finishWslCodex} from './wslCodex.mjs';
import {trustedMacFile,trustedMacRuntime,validateMacWorktree} from './macTrust.mjs';
import {validMacGradleContainer,cleanupMacGradleContainer} from './macGradleContainer.mjs';

const macProcessTrees=new WeakMap();
const macRegistry=()=>path.join(root,'data','mac-processes');
function macProcessTable(){
  const result=spawnSync('/usr/bin/python3',['-I',path.join(root,'scripts','mac-process-table.py')],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:3000,maxBuffer:4*1024*1024});
  if(result.status!==0)throw new Error('Cannot inspect macOS child process tree');
  const rows=new Map();
  for(const row of JSON.parse(result.stdout)){
    if(!Number.isInteger(row.pid)||!Number.isInteger(row.parent)||!/^\d+:\d+$/.test(row.identity))throw new Error('Invalid macOS process identity');
    rows.set(row.pid,row);
  }
  if(!rows.has(process.pid))throw new Error('Unrecognized macOS process table');
  return rows;
}
export function verifyMacProcessSupport(){
  if(process.platform==='darwin')macProcessTable();
}
function rememberMacDescendants(table,pid,tracked){
  if(!table.has(pid)||tracked.has(pid)&&tracked.get(pid)!==table.get(pid).identity)return;
  const descendants=new Set([pid]);let changed=true;
  while(changed){changed=false;for(const row of table.values())if(descendants.has(row.parent)&&!descendants.has(row.pid)){descendants.add(row.pid);changed=true;}}
  for(const id of descendants){const row=table.get(id);if(row&&!tracked.has(id))tracked.set(id,row.identity);}
}
function readMacProcessRecords(){
  const dir=macRegistry();if(!fs.existsSync(dir))return [];
  const stat=fs.lstatSync(dir);
  if(!stat.isDirectory()||fs.realpathSync(dir)!==dir||stat.uid!==process.getuid()||stat.mode&0o077)throw new Error('Untrusted macOS process registry');
  return fs.readdirSync(dir).filter(name=>name.endsWith('.json')).map(name=>{
    const file=path.join(dir,name),stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.uid!==process.getuid()||stat.mode&0o077||stat.size>1000000)throw new Error('Untrusted macOS process checkpoint');
    const record=JSON.parse(fs.readFileSync(file,'utf8'));
    if(record.version!==2||record.workspace!==root||!path.isAbsolute(record.cwd)||!Number.isInteger(record.owner?.pid)||record.owner.pid<=1||!/^\d+:\d+$/.test(record.owner.identity)||!Number.isInteger(record.pid)||record.pid<=1||!Array.isArray(record.processes)||record.processes.some(([pid,identity])=>!Number.isInteger(pid)||pid<=1||pid===process.pid||!/^\d+:\d+$/.test(identity)))throw new Error('Invalid macOS process checkpoint; local recovery required');
    if(record.container&&!validMacGradleContainer(record.container))throw new Error('Invalid macOS Gradle container checkpoint');
    return {file,record};
  });
}
export function activeMacProcessesForWorktree(cwd){
  if(process.platform!=='darwin')return [];
  return readMacProcessRecords().filter(({record})=>record.cwd===path.resolve(cwd)).map(({file})=>path.basename(file));
}
export function reapStaleMacProcesses(){
  if(process.platform!=='darwin')return [];
  const removed=[];
  for(const {file,record} of readMacProcessRecords()){
    const current=macProcessTable();
    if(current.get(record.owner.pid)?.identity===record.owner.identity)continue;
    const tracked=new Map(record.processes);
    if(current.get(record.pid)?.identity===tracked.get(record.pid))rememberMacDescendants(current,record.pid,tracked);
    for(const [pid,identity] of [...tracked].reverse())if(current.get(pid)?.identity===identity)try{process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
    const after=macProcessTable();
    if([...tracked].some(([pid,identity])=>after.get(pid)?.identity===identity))throw new Error('macOS orphan cleanup incomplete; worktree remains blocked');
    if(record.container)cleanupMacGradleContainer(record.container,record.cwd);
    fs.rmSync(file);removed.push(path.basename(file));
  }
  return removed;
}
export function registerMacGradleContainer(cwd,container){
  if(process.platform!=='darwin'||!validMacGradleContainer(container))throw new Error('Invalid macOS Gradle resource');
  fs.mkdirSync(macRegistry(),{recursive:true,mode:0o700});readMacProcessRecords();
  const table=macProcessTable(),file=path.join(macRegistry(),`${process.pid}-${randomUUID()}.json`);
  const record={version:2,workspace:root,cwd:path.resolve(cwd),owner:{pid:process.pid,identity:table.get(process.pid).identity},pid:process.pid,processes:[],container};
  // Persist before Docker create/start, including the creation-before-start crash window.
  const temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(record),{flag:'wx',mode:0o600});fs.renameSync(temporary,file);
  return {finish:()=>{cleanupMacGradleContainer(container,cwd);fs.rmSync(file);}};
}
export function trackMacProcess(child,cwd){
  if(process.platform!=='darwin')return {finish:()=>true};
  const tracked=new Map(),file=path.join(macRegistry(),`${process.pid}-${randomUUID()}.json`);
  let timer,failed=false;
  const persist=()=>{
    const table=macProcessTable();rememberMacDescendants(table,child.pid,tracked);macProcessTrees.set(child,tracked);
    const record={version:2,workspace:root,cwd:path.resolve(cwd),owner:{pid:process.pid,identity:table.get(process.pid).identity},pid:child.pid,processes:[...tracked]};
    const temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(record),{mode:0o600});fs.renameSync(temporary,file);
  };
  try{
    fs.mkdirSync(macRegistry(),{recursive:true,mode:0o700});readMacProcessRecords();
    if(!child.pid)return {finish:()=>false};
    persist(); // Written before provider stdin is released to the CLI.
    timer=setInterval(()=>{try{persist();}catch{failed=true;clearInterval(timer);stopTree(child,'SIGKILL');}},250);timer.unref();
  }catch(error){stopTree(child,'SIGKILL');throw error;}
  return {finish:()=>{
    clearInterval(timer);
    try{
    if(stopTree(child,'SIGKILL')===false)return false;
    const table=macProcessTable();
    if([...tracked].some(([pid,identity])=>table.get(pid)?.identity===identity))return false;
    fs.rmSync(file,{force:true});return !failed;
    }catch{return false;}
  }};
}
export function stopTree(child,signal='SIGTERM') {
  if(!child?.pid)return;
  if(process.platform==='darwin'){
    // Codex commands can create their own process groups. Capture descendants
    // before terminating the CLI, and retain identities for forced cleanup after
    // the parent exits. Never signal a PID whose identity has since changed.
    let current;
    try{current=macProcessTable();}catch{
      // A failed inspection must not crash the supervisor or report cleanup.
      if(child.exitCode===null)try{process.kill(-child.pid,signal);}catch{child.kill(signal);}
      return false;
    }
    const tracked=macProcessTrees.get(child)||new Map();
    if(child.exitCode===null){
      rememberMacDescendants(current,child.pid,tracked);
      macProcessTrees.set(child,tracked);
    }
    let stopped=true;
    for(const [pid,identity] of [...tracked].reverse())if(current.get(pid)?.identity===identity){try{process.kill(pid,signal);}catch(error){if(error.code!=='ESRCH')stopped=false;}}
    return stopped;
  }
  if(child.exitCode!==null)return;
  if(process.platform==='win32') {
    const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    killer.on('error',()=>child.kill());
  } else {
    try {process.kill(-child.pid,signal);} catch {child.kill(signal);}
  }
}

export const redact = (value) => {
  let output=String(value).replace(/(?:sk-[A-Za-z0-9_-]{16,}|Bearer\s+\S+|GATEWAY_API_KEY\s*[=:]\s*\S+)/gi,'[REDACTED]').replace(/((?:api[_-]?key|access[_-]?token|client[_-]?secret|password|secret)\s*[:=]\s*["']?)[^\s"',;]+/gi,'$1[REDACTED]');
  for(const [key,secret] of Object.entries(process.env)) if(/(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(key)&&typeof secret==='string'&&secret.length>=8) output=output.split(secret).join('[REDACTED]');
  return output;
};
export function childEnv() {return {...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|AUTH|^WORKSPACE_)/i.test(key))),CI:'1'};}
export function macChildEnv(searchPath,overrides={}){
  const env=childEnv();
  for(const name of Object.keys(env))if(/^(?:NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|OPENSSL_.*|SSL_CERT_FILE|SSL_CERT_DIR|BASH_ENV|ENV|PYTHONPATH|GIT_.*|npm_config_.*|NPM_CONFIG_.*|DYLD_.*|LD_.*)$/i.test(name))delete env[name];
  // Do not load host OpenSSL engines/configuration. TLS verification remains on.
  return {...env,PATH:searchPath,OPENSSL_CONF:'/dev/null',...overrides};
}
export function createProviderLineParser(onLine,onOversized,maxLength=1_000_000){
  let pending='',discarding=false;
  return {
    feed(chunk){
      pending+=chunk;
      let index;
      while((index=pending.indexOf('\n'))>=0){
        const line=pending.slice(0,index);pending=pending.slice(index+1);
        if(discarding){discarding=false;continue;}
        if(line.length>maxLength){onOversized();continue;}
        onLine(line);
      }
      if(pending.length>maxLength){pending='';discarding=true;onOversized();}
    },
    flush(){if(!discarding&&pending)onLine(pending);pending='';discarding=false;}
  };
}
export function providerArgs(provider, {readOnly=false,sessionId=null}={}) {
  if(sessionId && !/^[A-Za-z0-9_-]{8,120}$/.test(sessionId)) throw new Error('Invalid provider session ID');
  if (provider==='claude') return [
    '-p','--output-format','stream-json','--verbose','--max-turns','12',
    '--restricted','--strict-mcp-config','--permission-prompts','none',
    '--permission-mode',readOnly?'plan':'acceptEdits',
    '--tools',readOnly?'Read,Glob,Grep':'Read,Edit,Write,Glob,Grep',
    '--disallowedTools','Bash(git commit*)','Bash(git push*)','Bash(git reset*)','Bash(git clean*)','Bash(git checkout*)','Bash(npm install*)','Bash(npx eas*)',
    ...(sessionId?['--resume',sessionId]:[])
  ];
  if (provider==='codex') return ['-p',codexProfileName(process.platform==='win32'?(readOnly?'wsl-readonly':'wsl'):(readOnly?'posix-readonly':'posix')),'-a','never','exec',...(sessionId?['resume']:[]),'--json',...(sessionId?[sessionId]:[]),'-'];
  throw new Error('Unknown provider');
}
export function resolveClaudeExecutable(cwd) {
  if(process.platform==='darwin')return trustedMacFile('claude',cwd);
  const inside=(candidate,parent)=>{
    const value=process.platform==='win32'?candidate.toLowerCase():candidate;
    const base=process.platform==='win32'?parent.toLowerCase():parent;
    return value===base||value.startsWith(base+path.sep);
  };
  const taskRoot=fs.realpathSync(cwd),workspaceRoot=fs.realpathSync(root);
  for(const entry of (process.env.PATH||process.env.Path||'').split(path.delimiter)){
    if(!path.isAbsolute(entry)||process.platform==='win32'&&entry.startsWith('\\\\'))continue;
    const candidate=path.join(entry,process.platform==='win32'?'claude.exe':'claude');
    try{
      const target=fs.realpathSync(candidate);
      if(inside(target,taskRoot)||inside(target,workspaceRoot))continue;
      fs.accessSync(target,fs.constants.X_OK);
      if(!fs.statSync(target).isFile())continue;
      return target;
    }catch{}
  }
  throw new Error('Trusted Claude executable missing outside Workspace and task worktree');
}
export async function runProvider({provider,cwd,prompt,readOnly=false,sessionId=null,timeoutMs=600000,onEvent=()=>{},signal}) {
  if(process.platform==='darwin'){validateMacWorktree(cwd);verifyMacProcessSupport();}
  const args=providerArgs(provider,{readOnly,sessionId});
  const mac=process.platform==='darwin'?trustedMacRuntime(cwd):null;
  if(provider==='codex'&&process.platform!=='win32') verifyCodexProfile(readOnly?'posix-readonly':'posix');
  const macExecutable=mac&&(provider==='codex'?mac.codex:resolveClaudeExecutable(cwd));
  if(mac){
    const checked=spawnSync(macExecutable,['--version'],{cwd,env:macChildEnv(mac.path),encoding:'utf8',timeout:10000});
    if(checked.status!==0||!/\d+\.\d+/.test(checked.stdout.trim()))throw new Error(`Pinned macOS ${provider} version check failed`);
  }
  const launch=provider==='codex'&&process.platform==='win32'?await wslCodexLaunch(cwd,readOnly,args):null;
  if(signal?.aborted){finishWslCodex(launch);return {ok:false,code:null,timedOut:false,sessionId,result:'',usage:null,stderr:'Cancelled before provider start'};}
  return new Promise(resolve=>{
    const exe=launch?.executable||macExecutable||(provider==='claude'?resolveClaudeExecutable(cwd):provider);
    const child=spawn(exe,launch?.args||args,{cwd,windowsHide:true,shell:false,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe'],env:mac?macChildEnv(mac.path):childEnv()});
    const macTracker=trackMacProcess(child,cwd);
    let stderr='',last='',threadId=sessionId,reportedThreadId=sessionId,usage=null,finished=false,timedOut=false,watchdog=null,cleanupFailed=false;
    const stop=()=>{if(launch)stopWslCodex(launch);if(stopTree(child)===false)cleanupFailed=true;};
    const armWatchdog=()=>{if(!watchdog){watchdog=setTimeout(()=>{if(!finished){if(launch)stopWslCodex(launch,'KILL');stopTree(child,'SIGKILL');complete(null,'Provider wrapper did not exit after termination');}},5000);watchdog.unref();}};
    const timer=setTimeout(()=>{timedOut=true;stop();armWatchdog();},timeoutMs);
    const abort=()=>{stop();armWatchdog();}; signal?.addEventListener('abort',abort,{once:true});
    const complete=(code,error)=>{if(finished)return;if((signal?.aborted||timedOut)&&stopTree(child,'SIGKILL')===false)cleanupFailed=true;if(!macTracker.finish())cleanupFailed=true;finished=true;clearTimeout(timer);clearTimeout(watchdog);signal?.removeEventListener('abort',abort);const scopeStopped=finishWslCodex(launch);resolve({ok:code===0&&!signal?.aborted&&!timedOut&&!error&&scopeStopped&&!cleanupFailed,code,timedOut,sessionId:threadId,result:redact(last).slice(0,20000),usage,stderr:redact([stderr,error,cleanupFailed?'macOS descendant cleanup could not be verified':'',scopeStopped?'':'WSL process scope remained active'].filter(Boolean).join('\n')).slice(-4000)});};
    const parser=createProviderLineParser(line=>{
      try {
        const event=JSON.parse(line);
        if(event.session_id) threadId=event.session_id;
        if(event.type==='thread.started') threadId=event.thread_id;
        if(threadId && threadId!==reportedThreadId) {reportedThreadId=threadId;onEvent({type:'session',sessionId:threadId});}
        if(event.usage) usage=event.usage;
        if(event.type==='result') {last=event.result || last; usage=event.usage || usage;}
        if(event.type==='item.completed' && event.item?.type==='agent_message') last=event.item.text || last;
        if(event.type==='assistant' && event.message?.content) last=event.message.content.filter(x=>x.type==='text').map(x=>x.text).join('\n') || last;
        const commandExecution=event.item?.type==='command_execution'?{
          command:redact(event.item.command||'').slice(0,4000),exitCode:event.item.exit_code,
          output:redact(event.item.aggregated_output||'').slice(-4000)
        }:undefined;
        onEvent({type:event.type || 'message',summary:redact(JSON.stringify(event)).slice(0,4000),...(commandExecution?{commandExecution}:{})});
      } catch { onEvent({type:'raw',summary:redact(line).slice(0,1000)}); }
    },()=>onEvent({type:'raw',summary:'Oversized provider event discarded'}));
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>parser.feed(chunk));
    child.stderr.on('data',chunk=>{stderr+=chunk;if(stderr.length>20000) stderr=stderr.slice(-20000);});
    child.on('error',error=>complete(null,error));
    child.on('close',code=>{parser.flush();complete(code);});
    child.stdin.end(prompt);
  });
}
export async function probeProvider(provider,cwd) {
  const prompt='Reply with exactly MOMENTORY_PROVIDER_OK. Do not use tools or modify files.';
  return runProvider({provider,cwd,prompt,readOnly:true,timeoutMs:120000});
}

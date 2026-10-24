import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {root} from './config.mjs';
import {codexProfileName,verifyCodexProfile} from './codexProfile.mjs';
import {wslCodexLaunch,stopWslCodex,finishWslCodex} from './wslCodex.mjs';

export function stopTree(child,signal='SIGTERM') {
  if(!child?.pid || child.exitCode!==null) return;
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
  const inside=(candidate,parent)=>{
    const value=process.platform==='win32'?candidate.toLowerCase():candidate;
    const base=process.platform==='win32'?parent.toLowerCase():parent;
    return value===base||value.startsWith(base+path.sep);
  };
  for(const entry of (process.env.PATH||process.env.Path||'').split(path.delimiter)){
    if(!path.isAbsolute(entry)||process.platform==='win32'&&entry.startsWith('\\\\'))continue;
    const candidate=path.join(entry,process.platform==='win32'?'claude.exe':'claude');
    try{
      const target=fs.realpathSync(candidate);
      if(inside(target,path.resolve(cwd))||inside(target,path.resolve(root)))continue;
      fs.accessSync(target,fs.constants.X_OK);
      if(!fs.statSync(target).isFile())continue;
      return target;
    }catch{}
  }
  throw new Error('Trusted Claude executable missing outside Workspace and task worktree');
}
export async function runProvider({provider,cwd,prompt,readOnly=false,sessionId=null,timeoutMs=600000,onEvent=()=>{},signal}) {
  const args=providerArgs(provider,{readOnly,sessionId});
  if(provider==='codex'&&process.platform!=='win32') verifyCodexProfile(readOnly?'posix-readonly':'posix');
  const launch=provider==='codex'&&process.platform==='win32'?await wslCodexLaunch(cwd,readOnly,args):null;
  if(signal?.aborted){finishWslCodex(launch);return {ok:false,code:null,timedOut:false,sessionId,result:'',usage:null,stderr:'Cancelled before provider start'};}
  return new Promise(resolve=>{
    const exe=launch?.executable||(provider==='claude'?resolveClaudeExecutable(cwd):provider);
    const child=spawn(exe,launch?.args||args,{cwd,windowsHide:true,shell:false,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe'],env:childEnv()});
    let stderr='',last='',threadId=sessionId,reportedThreadId=sessionId,usage=null,finished=false,timedOut=false,watchdog=null;
    const stop=()=>{if(launch)stopWslCodex(launch);stopTree(child);};
    const armWatchdog=()=>{if(!watchdog){watchdog=setTimeout(()=>{if(!finished){if(launch)stopWslCodex(launch,'KILL');stopTree(child);complete(null,'Provider wrapper did not exit after termination');}},5000);watchdog.unref();}};
    const timer=setTimeout(()=>{timedOut=true;stop();armWatchdog();},timeoutMs);
    const abort=()=>{stop();armWatchdog();}; signal?.addEventListener('abort',abort,{once:true});
    const complete=(code,error)=>{if(finished)return;finished=true;clearTimeout(timer);clearTimeout(watchdog);signal?.removeEventListener('abort',abort);const scopeStopped=finishWslCodex(launch);resolve({ok:code===0&&!signal?.aborted&&!timedOut&&!error&&scopeStopped,code,timedOut,sessionId:threadId,result:redact(last).slice(0,20000),usage,stderr:redact([stderr,error,scopeStopped?'':'WSL process scope remained active'].filter(Boolean).join('\n')).slice(-4000)});};
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
        onEvent({type:event.type || 'message',summary:redact(JSON.stringify(event)).slice(0,4000)});
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

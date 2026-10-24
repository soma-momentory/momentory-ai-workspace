import { spawn } from 'node:child_process';
import {codexProfileName,verifyCodexProfile} from './codexProfile.mjs';
import {wslCodexLaunch,stopWslCodex,finishWslCodex} from './wslCodex.mjs';

export function stopTree(child) {
  if(!child?.pid || child.exitCode!==null) return;
  if(process.platform==='win32') {
    const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    killer.on('error',()=>child.kill());
  } else {
    try {process.kill(-child.pid,'SIGTERM');} catch {child.kill();}
  }
}

export const redact = (value) => {
  let output=String(value).replace(/(?:sk-[A-Za-z0-9_-]{16,}|Bearer\s+\S+|GATEWAY_API_KEY\s*[=:]\s*\S+)/gi,'[REDACTED]').replace(/((?:api[_-]?key|access[_-]?token|client[_-]?secret|password|secret)\s*[:=]\s*["']?)[^\s"',;]+/gi,'$1[REDACTED]');
  for(const [key,secret] of Object.entries(process.env)) if(/(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(key)&&typeof secret==='string'&&secret.length>=8) output=output.split(secret).join('[REDACTED]');
  return output;
};
export function childEnv() {return {...Object.fromEntries(Object.entries(process.env).filter(([key])=>!/(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|AUTH|^WORKSPACE_)/i.test(key))),CI:'1'};}
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
export function runProvider({provider,cwd,prompt,readOnly=false,sessionId=null,timeoutMs=600000,onEvent=()=>{},signal}) {
  return new Promise((resolve,reject)=>{
    const args=providerArgs(provider,{readOnly,sessionId});
    if(provider==='codex'&&process.platform!=='win32') verifyCodexProfile(readOnly?'posix-readonly':'posix');
    const launch=provider==='codex'&&process.platform==='win32'?wslCodexLaunch(cwd,readOnly,args):null;
    const exe=launch?.executable||provider;
    const child=spawn(exe,launch?.args||args,{cwd,windowsHide:true,shell:process.platform==='win32'&&exe!=='wsl.exe',detached:process.platform!=='win32',stdio:['pipe','pipe','pipe'],env:childEnv()});
    let buffer='',stderr='',last='',threadId=sessionId,reportedThreadId=sessionId,usage=null,finished=false,timedOut=false;
    const stop=()=>{if(launch)stopWslCodex(launch);stopTree(child);};
    const timer=setTimeout(()=>{ timedOut=true;stop(); setTimeout(()=>{if(!finished){if(launch)stopWslCodex(launch,'KILL');stopTree(child);}},5000).unref(); },timeoutMs);
    const abort=()=>stop(); signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',chunk=>{
      buffer+=chunk.toString('utf8');
      let index;
      while((index=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,index); buffer=buffer.slice(index+1);
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
      }
    });
    child.stderr.on('data',chunk=>{stderr+=chunk.toString('utf8'); if(stderr.length>20000) stderr=stderr.slice(-20000);});
    child.on('error',error=>{finished=true;clearTimeout(timer);finishWslCodex(launch);reject(error);});
    child.on('close',code=>{
      finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);finishWslCodex(launch);
      resolve({ok:code===0 && !signal?.aborted && !timedOut,code,timedOut,sessionId:threadId,result:redact(last).slice(0,20000),usage,stderr:redact(stderr).slice(-4000)});
    });
    child.stdin.end(prompt);
  });
}
export async function probeProvider(provider,cwd) {
  const prompt='Reply with exactly MOMENTORY_PROVIDER_OK. Do not use tools or modify files.';
  return runProvider({provider,cwd,prompt,readOnly:true,timeoutMs:120000});
}

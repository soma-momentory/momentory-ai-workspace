import { spawn } from 'node:child_process';
import { settings, root } from './config.mjs';
import {createBackup} from './backup.mjs';
import fs from 'node:fs';
import path from 'node:path';

const config=settings();
const controlLog=process.env.WORKSPACE_DESKTOP_CONTROL==='1'?path.join(root,'data','desktop-control-events.jsonl'):null;
function record(event,details={}){
  if(!controlLog)return;
  try{fs.appendFileSync(controlLog,JSON.stringify({at:new Date().toISOString(),actor:'launcher',actorPid:process.pid,event,...details})+'\n',{mode:0o600});}
  catch(error){console.error('Launcher event log failed:',error);}
}
if(!process.env.WORKSPACE_BACKUP_KEY)throw new Error('Backup key missing. Run npm run backup:init before starting the launcher.');
if(process.env.WORKSPACE_DATA_FILE&&(!process.env.WORKSPACE_PROJECTS_FILE||!process.env.WORKSPACE_BACKUP_ENV_FILE||!process.env.WORKSPACE_SCREENSHOTS_DIR))throw new Error('Custom WORKSPACE_DATA_FILE requires explicit projects, backup environment and screenshots paths');
let stopping=false,server=null,childFailure=false;
const workers=new Map();
const unexpectedExits=new Map();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const running=child=>child.exitCode===null&&child.signalCode===null;
function mayRestart(name,details){
  if(stopping)return false;
  if(!controlLog)return true;
  const now=Date.now();
  const recent=(unexpectedExits.get(name)||[]).filter(time=>now-time<5*60*1000);
  recent.push(now);
  unexpectedExits.set(name,recent);
  if(recent.length<2)return true;
  record('repeated-unexpected-exit',{name,occurrences:recent.length,windowMs:5*60*1000,...details});
  process.exitCode=1;
  void stop();
  return false;
}
function launch(name,file,onExit,env=process.env) {
  const child=spawn(process.execPath,[file],{cwd:root,env,stdio:['inherit','inherit','inherit','ipc'],windowsHide:true});
  record('child-start',{name,pid:child.pid,file});
  child.on('error',error=>{childFailure=true;record('child-error',{name,pid:child.pid,message:error.message,code:error.code});});
  child.on('exit',(code,signal)=>{if(code!==0||signal||!stopping)childFailure=true;record('child-exit',{name,pid:child.pid,code,signal,normalStopRequested:stopping});console.error(`${name} exited (${code})`);onExit({code,signal});});
  return child;
}
async function waitForServer(){for(let i=0;i<60&&!stopping;i++){try{const response=await fetch(`http://${config.host}:${config.port}/api/session`);if(response.status===401)return true;}catch{}await wait(500);}if(stopping)return false;throw new Error('Server did not start');}
async function startServer(){if(stopping)return;server=launch('server','src/server.mjs',async details=>{server=null;if(mayRestart('server',details)){await wait(2000);if(!stopping)startServer();}});}
async function startWorker(slot){if(stopping)return;workers.set(slot,launch(`worker/${slot}`,'src/worker.mjs',async details=>{workers.delete(slot);if(mayRestart(`worker/${slot}`,details)){await wait(2000);if(!stopping)startWorker(slot);}},{...process.env,WORKER_SLOT:slot}));}
async function stop(){
  if(stopping)return;
  stopping=true;
  record('stop-request');
  const children=[...workers.values(),server].filter(Boolean);
  for(const child of children)if(running(child)){
    try{child.send('stop');}catch(error){childFailure=true;record('child-stop-error',{pid:child.pid,message:error.message});}
  }
  for(let i=0;i<30&&children.some(running);i++)await wait(1000);
  const remaining=children.filter(running);
  for(const child of remaining)record('child-stop-timeout',{pid:child.pid});
  if(remaining.length)process.exitCode=1;
  if(remaining.length&&controlLog){
    console.error('Controlled shutdown timed out; children were not killed');
    return;
  }
  for(const child of remaining)child.kill();
  for(let i=0;i<5&&children.some(running);i++)await wait(1000);
  if(children.some(running)){
    console.error('Workspace child remained after forced shutdown');
    return;
  }
  if(childFailure)process.exitCode=1;
  process.disconnect?.();
}
process.on('SIGINT',()=>{record('signal',{signal:'SIGINT'});stop();});process.on('SIGTERM',()=>{record('signal',{signal:'SIGTERM'});stop();});
process.on('message',message=>{if(message==='stop')stop();});
process.on('uncaughtException',error=>{record('exception',{message:error.message,stack:error.stack});console.error(error);process.exit(1);});
process.on('exit',code=>record('process-exit',{code,normalStopRequested:stopping}));
await startServer();
if(await waitForServer()&&!stopping){
  try{createBackup();}catch(error){await stop();throw new Error(`Initial Workspace backup failed: ${error.message}`);}
  if(!stopping){
    setInterval(()=>{try{createBackup();}catch(error){console.error(`Scheduled Workspace backup failed: ${error.message}`);stop().then(()=>{process.exitCode=1;});}},24*60*60*1000).unref();
    await startWorker('claude');await startWorker('codex');
  }
}

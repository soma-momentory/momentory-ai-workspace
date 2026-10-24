import { spawn } from 'node:child_process';
import { settings, root } from './config.mjs';

const config=settings();
let stopping=false,server=null;
const workers=new Map();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function launch(name,file,onExit,env=process.env) {
  const child=spawn(process.execPath,[file],{cwd:root,env,stdio:['inherit','inherit','inherit','ipc'],windowsHide:true});
  child.on('exit',(code)=>{console.error(`${name} exited (${code})`);onExit();});
  return child;
}
async function waitForServer(){for(let i=0;i<60&&!stopping;i++){try{const response=await fetch(`http://${config.host}:${config.port}/api/session`);if(response.status===401)return;}catch{}await wait(500);}throw new Error('Server did not start');}
async function startServer(){server=launch('server','src/server.mjs',async()=>{server=null;if(!stopping){await wait(2000);startServer();}});}
async function startWorker(slot){workers.set(slot,launch(`worker/${slot}`,'src/worker.mjs',async()=>{workers.delete(slot);if(!stopping){await wait(2000);startWorker(slot);}},{...process.env,WORKER_SLOT:slot}));}
async function stop(){if(stopping)return;stopping=true;const children=[...workers.values(),server].filter(Boolean);for(const child of children) child.send('stop');for(let i=0;i<30&&children.some(child=>child.exitCode===null);i++)await wait(1000);for(const child of children) if(child.exitCode===null)child.kill();process.disconnect?.();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
process.on('message',message=>{if(message==='stop')stop();});
await startServer();await waitForServer();await startWorker('claude');await startWorker('codex');

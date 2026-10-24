import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { root, loadEnv } from './config.mjs';
import { projects } from './projects.mjs';
import { executeTask } from './engine.mjs';

loadEnv();
const base=`http://127.0.0.1:${process.env.WORKSPACE_PORT || 4178}`;
if(!process.env.WORKER_TOKEN) throw new Error('WORKER_TOKEN missing');
const dataDir=path.join(root,'data');fs.mkdirSync(dataDir,{recursive:true});
const slot=process.env.WORKER_SLOT || 'claude';
if(!['claude','codex'].includes(slot)) throw new Error('Invalid WORKER_SLOT');
const lockFile=path.join(dataDir,`worker-${slot}.lock`);
try {fs.writeFileSync(lockFile,String(process.pid),{flag:'wx'});}
catch(error){
  if(error.code!=='EEXIST') throw error;
  const oldPid=Number(fs.readFileSync(lockFile,'utf8'));
  let alive=true;try{process.kill(oldPid,0);}catch(check){alive=check.code!=='ESRCH';}
  if(alive)throw new Error(`Worker already running (PID ${oldPid})`);
  fs.rmSync(lockFile);fs.writeFileSync(lockFile,String(process.pid),{flag:'wx'});
}
process.on('exit',()=>{try{if(fs.readFileSync(lockFile,'utf8')===String(process.pid))fs.rmSync(lockFile);}catch{}});
const idFile=path.join(dataDir,`worker-${slot}-id`);
const id=process.env.WORKER_ID || (fs.existsSync(idFile)?fs.readFileSync(idFile,'utf8').trim():(()=>{const value=randomUUID();fs.writeFileSync(idFile,value);return value;})());
const kind='local';
const name=`${process.env.WORKER_NAME || os.hostname()} / ${slot}`;
const capabilities=[...projects().values()].flatMap(project=>Object.entries(project.repositories).filter(([,repo])=>fs.existsSync(repo.path)).map(([key])=>`${project.id}:${key}`));
const headers={'Content-Type':'application/json','Authorization':`Bearer ${process.env.WORKER_TOKEN}`};
async function api(endpoint,body) {
  for(let attempt=0;attempt<3;attempt++) {
    try {
      const response=await fetch(new URL(endpoint,base),{method:'POST',headers,body:JSON.stringify(body)});
      if(!response.ok) throw new Error(`${endpoint}: HTTP ${response.status} ${await response.text()}`);
      return response.json();
    } catch(error) {
      if(attempt===2||String(error).includes('HTTP ')) throw error;
      await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
    }
  }
}
let active=null,controller=null,stopping=false;
process.on('SIGINT',()=>{stopping=true;controller?.abort();});
process.on('SIGTERM',()=>{stopping=true;controller?.abort();});
process.on('message',message=>{if(message==='stop'){stopping=true;controller?.abort();}});
async function loop() {
  while(!stopping) {
    try {
      const response=await api('/api/worker/heartbeat',{id,name,kind,capabilities,activeTask:active});
      if(response.control==='cancel' || response.control==='pause') controller?.abort();
      if(!active) {
        const claim=await api('/api/worker/claim',{id,capabilities,provider:slot});
        if(claim.task) {
          const task=claim.task;active=task.id;controller=new AbortController();
          let lastHeartbeat=Date.now();
          const heartbeat=setInterval(async()=>{
            try {
              const state=await api('/api/worker/heartbeat',{id,name,kind,capabilities,activeTask:task.id});
              lastHeartbeat=Date.now();
              if(state.control==='cancel'||state.control==='pause') controller.abort();
            } catch(error) {console.error(error.message);if(Date.now()-lastHeartbeat>25000||String(error).includes('HTTP 409'))controller.abort();}
          },5000);
          const pendingEvents=new Set();
          const emit=(event,payload)=>{const pending=api('/api/worker/event',{id,taskId:task.id,event,payload}).catch(error=>console.error(error.message)).finally(()=>pendingEvents.delete(pending));pendingEvents.add(pending);};
          const save=fields=>api('/api/worker/patch',{id,taskId:task.id,fields});
          const candidate=(provider,proposal)=>api('/api/worker/candidate',{id,taskId:task.id,provider,proposal});
          const evaluate=(candidateId,evaluation)=>api('/api/worker/evaluation',{id,taskId:task.id,candidateId,evaluation});
          try {
            const result=await executeTask(task,{emit,save,candidate,evaluate,signal:controller.signal});
            await Promise.allSettled([...pendingEvents]);
            const checkpoint=path.join(dataDir,`${task.id}.result.json`);
            fs.writeFileSync(`${checkpoint}.tmp`,JSON.stringify(result));fs.renameSync(`${checkpoint}.tmp`,checkpoint);
            try {await api('/api/worker/complete',{id,taskId:task.id,...result});}
            catch(error) {await api('/api/worker/orphan-result',{id,taskId:task.id,...result}).catch(()=>{});throw error;}
          } catch(error) {
            const stranded=fs.existsSync(path.join(root,'worktrees',task.project_id,task.id));
            try {await api('/api/worker/complete',{id,taskId:task.id,status:controller.signal.aborted?'CANCELLED':stranded?'UNVERIFIED':'FAILED',result:{error:String(error),stranded},verification:{ok:false,reason:String(error)}});}
            catch(completeError){console.error(`Completion unavailable for ${task.id}: ${completeError.message}`);}
          } finally {clearInterval(heartbeat);active=null;controller=null;}
        }
      }
    } catch(error) {console.error(error.message);}
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
}
loop().finally(()=>process.disconnect?.());

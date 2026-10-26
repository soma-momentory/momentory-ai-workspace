import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {backupFixture} from './backup-fixture.mjs';

const root=path.resolve(import.meta.dirname,'..'),run=randomUUID(),port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolve(value));});});
const token=randomBytes(32).toString('hex'),workerToken=randomBytes(32).toString('hex'),base=`http://127.0.0.1:${port}`;
const db=path.join(root,'data',`collaboration-${run}.sqlite`);
const child=spawn(process.execPath,['src/local.mjs'],{cwd:root,env:{...process.env,WORKSPACE_PORT:String(port),WORKSPACE_TOKEN:token,WORKER_TOKEN:workerToken,WORKSPACE_DATA_FILE:db,...backupFixture(db,token,workerToken)},stdio:['ignore','pipe','pipe','ipc']});
let logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>logs=(logs+chunk.toString()).slice(-12000));
let cookie='';const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(route,method='GET',value){const response=await fetch(base+route,{method,headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:value===undefined?undefined:JSON.stringify(value)});const body=await response.json();assert.ok(response.ok,`${route} ${response.status} ${JSON.stringify(body)}`);return {body,response};}
async function waitTask(id,statuses,timeout=240000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const {body}=await api(`/api/tasks/${id}`);if(statuses.includes(body.task.status))return body;await delay(1000);}throw new Error(`Timed out ${id}: ${logs}`);}
try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await delay(250);}assert.ok(ready,logs);
  const login=await api('/api/login','POST',{token});cookie=login.response.headers.get('set-cookie').split(';')[0];
  const create=async input=>(await api('/api/tasks','POST',{projectId:'sample',repo:'app',mode:'FAST',maxAttempts:1,...input})).body.task;
  const claude=await create({goal:'Create docs/claude-design.md with a concrete, short sample app interface design proposal and acceptance criteria. Do not edit code.',provider:'claude',completionCriteria:'The design document exists and contains acceptance criteria.'});
  const codex=await create({goal:'Add an exported farewell(name) function to index.mjs and a matching node:test assertion in index.test.mjs. Keep the existing greeting test passing.',provider:'codex',completionCriteria:'Both greeting and farewell assertions pass.'});
  await Promise.all([waitTask(claude.id,['RUNNING'],60000),waitTask(codex.id,['RUNNING'],60000)]);
  const human=await create({goal:'Decide the sample interface tone and record the decision',type:'HUMAN_TASK',completionCriteria:'A tone decision with rationale is recorded.'});
  const follow=await create({goal:'Create docs/followup.md summarizing the accepted proposal in docs/claude-design.md. Preserve that source document.',provider:'codex',dependsOn:[claude.id],completionCriteria:'The follow-up references the accepted design document.'});
  assert.equal((await api(`/api/tasks/${follow.id}`)).body.task.status,'QUEUED');
  const overview=(await api('/api/overview?project=sample')).body;
  assert.ok(overview.humanActions.some(item=>item.taskId===human.id&&item.ready));
  const humanDone=(await api(`/api/tasks/${human.id}/control`,'POST',{action:'complete',evidence:'Use a calm, clear tone; it fits the sample interface and can be evaluated without AI output.'})).body.task;
  assert.equal(humanDone.status,'DONE');
  const [claudeResult,codexResult]=await Promise.all([waitTask(claude.id,['AWAITING_APPROVAL','FAILED','UNVERIFIED']),waitTask(codex.id,['AWAITING_APPROVAL','FAILED','UNVERIFIED'])]);
  assert.equal(claudeResult.task.status,'AWAITING_APPROVAL',JSON.stringify(claudeResult.task.result));
  assert.equal(codexResult.task.status,'AWAITING_APPROVAL',JSON.stringify(codexResult.task.result));
  assert.ok(claudeResult.task.result.diff.changedFiles.includes('docs/claude-design.md'));
  assert.ok(codexResult.task.result.diff.changedFiles.includes('index.mjs'));
  const cStart=Date.parse(claudeResult.events.find(e=>e.kind==='claimed').created_at),cEnd=Date.parse(claudeResult.events.find(e=>e.kind==='completed').created_at);
  const xStart=Date.parse(codexResult.events.find(e=>e.kind==='claimed').created_at),xEnd=Date.parse(codexResult.events.find(e=>e.kind==='completed').created_at);
  assert.ok(cStart<xEnd&&xStart<cEnd,'Claude and Codex did not overlap');
  const packet=claudeResult.decisions[0];assert.ok(packet.details.question&&packet.details.options&&packet.details.basis);
  await api(`/api/decisions/${packet.id}`,'POST',{status:'APPROVED'});
  const next=await waitTask(follow.id,['AWAITING_APPROVAL','FAILED','UNVERIFIED']);
  assert.equal(next.task.status,'AWAITING_APPROVAL',JSON.stringify(next.task.result));
  assert.ok(fs.existsSync(path.join(next.task.worktree,'docs','claude-design.md')),'Approved source document was not inherited');
  assert.ok(fs.existsSync(path.join(next.task.worktree,'docs','followup.md')));
  console.log(JSON.stringify({status:'PASS',parallel:true,newTasksWhileAiRunning:true,humanStatus:humanDone.status,claude:claudeResult.task.id,codex:codexResult.task.id,followup:follow.id,events:claudeResult.events.length+codexResult.events.length+next.events.length,decisionPacket:packet.details.question},null,2));
}finally{const exited=new Promise(resolve=>child.once('exit',resolve));child.send('stop');await Promise.race([exited,delay(35000)]);if(child.exitCode===null)child.kill();}

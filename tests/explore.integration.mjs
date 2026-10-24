import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {executeTask} from '../src/engine.mjs';

const task={id:randomUUID(),project_id:'sample',repo:'app',type:'AI_TASK',goal:'Explore two substantially different layouts for a simple daily task list, with clear information hierarchy and accessibility tradeoffs.',completion_criteria:'Present distinct alternatives and independent Claude and Codex evaluations.',mode:'EXPLORE',provider:'claude',dependsOn:[]};
const proposals=[],evaluations=[];
const result=await executeTask(task,{candidate:async(provider,proposal)=>{const id=randomUUID();proposals.push({id,provider,proposal});return {id};},evaluate:async(id,evaluation)=>{evaluations.push({id,evaluation});},save:async()=>{},emit:()=>{}});
assert.equal(result.status,'AWAITING_DESIGN_SELECTION',JSON.stringify(result.result));
assert.ok(proposals.some(item=>item.provider==='claude'));
assert.ok(proposals.some(item=>item.provider==='codex'));
assert.equal(evaluations.length,proposals.length);
assert.ok(evaluations.every(item=>item.evaluation.claude.ok&&item.evaluation.codex.ok));
console.log(JSON.stringify({status:result.status,taskId:task.id,proposalCount:proposals.length,evaluationCount:evaluations.length,providers:[...new Set(proposals.map(item=>item.provider))],visualVerification:result.verification},null,2));

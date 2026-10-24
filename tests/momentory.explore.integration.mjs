import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {captureDesign} from '../src/design.mjs';
import {executeTask} from '../src/engine.mjs';

const task={id:randomUUID(),project_id:'momentory',repo:'fe',type:'AI_TASK',goal:'Explore distinct Momentory home hero arrangements and visual priorities while keeping the same content.',completion_criteria:'Two independent providers produce editable Studio drafts, matched browser screenshots and evaluations.',mode:'EXPLORE',provider:'claude',dependsOn:[]};
const proposals=[],evaluations=[];
const result=await executeTask(task,{
  candidate:async(provider,proposal)=>{
    const id=randomUUID();
    const screenshot=proposal.exported?await captureDesign(id,proposal.exported,proposal.screen,'momentory'):null;
    proposals.push({id,provider,proposal,screenshot});
    return {id};
  },
  evaluate:async(id,evaluation)=>{evaluations.push({id,evaluation});},
  save:async()=>{},
  emit:(event,payload)=>{if(['design_schema_rejected','dependencies'].includes(event))console.log(JSON.stringify({event,payload}));},
});
const rendered=proposals.filter(item=>item.screenshot);
assert.equal(result.status,'AWAITING_DESIGN_SELECTION',JSON.stringify(result.result));
assert.ok(rendered.some(item=>item.provider==='claude'),'No rendered Claude Studio draft');
assert.ok(rendered.some(item=>item.provider==='codex'),'No rendered Codex Studio draft');
assert.equal(evaluations.length,proposals.length);
console.log(JSON.stringify({status:'PASS',taskId:task.id,proposals:proposals.map(({id,provider,proposal,screenshot})=>({id,provider,name:proposal.name,screen:proposal.screen,rendered:!!screenshot,changes:Object.keys(proposal.studioPatch||{})})),evaluations:evaluations.length,worktree:result.worktree},null,2));

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {repository} from '../src/projects.mjs';
import {applySelectedDesign,validateExport} from '../src/design.mjs';

const source=path.join(repository('momentory','fe').path,'src','design','studioApproved.json');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-design-safe-'));
const target=path.join(dir,'src','design','studioApproved.json'),script=path.join(dir,'expo-lab','scripts','apply-design.mjs');
const canary=path.join(dir,`script-ran-${randomUUID()}`);
fs.mkdirSync(path.dirname(target),{recursive:true});fs.mkdirSync(path.dirname(script),{recursive:true});
fs.copyFileSync(source,target);fs.writeFileSync(script,`require('node:fs').writeFileSync(${JSON.stringify(canary)},'UNSAFE')`);
try{
  const approved=JSON.parse(fs.readFileSync(target,'utf8'));
  const exported={version:1,name:'Trusted data apply',design:{...approved,'home.hero.borderRadius':24}};
  const applied=await applySelectedDesign(exported,'momentory',dir);
  assert.deepEqual(applied.changedKeys,['home.hero.borderRadius']);
  assert.equal(JSON.parse(fs.readFileSync(target,'utf8'))['home.hero.borderRadius'],24);
  const repeated=await applySelectedDesign(exported,'momentory',dir);
  assert.equal(repeated.alreadyApplied,true,'A safe retry must reuse the applied design');
  assert.equal(fs.existsSync(canary),false,'Untrusted worktree script executed');
  await assert.rejects(validateExport({version:1,name:'Invalid',design:{...approved,'home.hero.borderRadius':999}},'momentory',dir),/Invalid home.hero.borderRadius/);
  console.log(JSON.stringify({status:'PASS',untrustedScriptExecuted:false,changedKeys:applied.changedKeys}));
}finally{fs.rmSync(dir,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {repository} from '../src/projects.mjs';
import {validateMomentoryDesign} from '../src/momentorySchema.mjs';

const fe=repository('momentory','fe').path;
const approved=JSON.parse(fs.readFileSync(path.join(fe,'src','design','studioApproved.json'),'utf8'));
assert.ok(Array.isArray(approved['home.hero.structure']),'Point WORKSPACE_REPO_MOMENTORY_FE at the structural FE branch');
const {validateDesign}=await import(pathToFileURL(path.join(fe,'expo-lab','scripts','apply-design.mjs')).href);
const structure=[{id:'group-one',kind:'group',children:[{id:'text-one',kind:'text',text:'오늘의 한 걸음'}]}];
const cases=[
  approved,
  {...approved,'home.hero.borderRadius':23},
  {...approved,'home.hero.structure':structure},
  {...approved,'home.hero.structure':[{id:'x',kind:'script',text:'run'}]},
  {...approved,'home.hero.structure':[{id:'same',kind:'text',text:'a'},{id:'same',kind:'text',text:'b'}]},
  {...approved,'home.hero.structure':[{id:'bad',kind:'text',text:'safe\u200Devil'}]},
  {...approved,'home.hero.structure':[{id:'bad',kind:'text',text:'safe\u202Eevil'}]},
  {...approved,'home.hero.structure':[{id:'bad',kind:'text',text:'x'.repeat(81)}]},
  {...approved,'home.hero.structure':[{id:'outer',kind:'group',children:[{id:'inner',kind:'group',children:[]}]}]},
  {...approved,'home.hero.borderRadius':100},
  {...approved,'unknown.key':'#123456'}
];
for(const [index,design] of cases.entries()){
  let core,feResult,coreError,feError;
  try{core=validateMomentoryDesign(design,approved);}catch(error){coreError=error;}
  try{feResult=validateDesign(design,approved);}catch(error){feError=error;}
  assert.equal(!!coreError,!!feError,`Schema acceptance drift in case ${index}`);
  if(!coreError)assert.deepEqual(core,feResult,`Schema normalization drift in case ${index}`);
}
console.log(JSON.stringify({status:'PASS',cases:cases.length,sharedAcceptance:true}));

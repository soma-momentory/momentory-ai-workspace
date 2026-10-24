import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {root} from '../src/config.mjs';
import {prepareWslDependency} from '../src/wslChecks.mjs';

if(process.platform!=='win32')throw new Error('Windows WSL2 required');
const base=path.join(root,'data'),dir=path.join(base,`wsl-deps-${randomUUID()}`);
assert.equal(fs.existsSync(dir),false);fs.mkdirSync(dir);
const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',windowsHide:true});
const step={ifMissing:'node_modules',command:['npm','ci','--ignore-scripts','--no-audit','--no-fund']};
try{
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'workspace-deps-fixture',version:'1.0.0',private:true}));
  fs.writeFileSync(path.join(dir,'package-lock.json'),JSON.stringify({name:'workspace-deps-fixture',version:'1.0.0',lockfileVersion:3,requires:true,packages:{'':{name:'workspace-deps-fixture',version:'1.0.0'}}}));
  git('init');git('add','package.json','package-lock.json');git('-c','user.name=Workspace Test','-c','user.email=workspace@example.invalid','commit','-m','fixture');
  const first=await prepareWslDependency(dir,step);assert.equal(first.ok,true,first.output);
  fs.mkdirSync(path.join(dir,'node_modules'),{recursive:true});
  const second=await prepareWslDependency(dir,step);assert.equal(second.ok,true);assert.match(second.output,/Previously prepared/);
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'workspace-deps-fixture',version:'2.0.0'}));
  await assert.rejects(prepareWslDependency(dir,step),/manifest or npm configuration changed/);
  await assert.rejects(prepareWslDependency(dir,{...step,command:[...step.command,'--ignore-scripts=false']}),/reviewed npm ci/);
  fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'workspace-deps-fixture',version:'1.0.0',private:true}));
  const unsafe=JSON.parse(fs.readFileSync(path.join(dir,'package-lock.json'),'utf8'));
  unsafe.packages.bad={resolved:'https://example.invalid/evil.tgz'};
  fs.writeFileSync(path.join(dir,'package-lock.json'),JSON.stringify(unsafe));
  git('add','package-lock.json');git('-c','user.name=Workspace Test','-c','user.email=workspace@example.invalid','commit','-m','unsafe fixture');
  await assert.rejects(prepareWslDependency(dir,step),/unapproved remote registry/);
  console.log(JSON.stringify({status:'PASS',boundedSetup:true,lockedManifest:true,markerOutsideWorktree:true}));
}finally{if(path.resolve(dir).startsWith(path.resolve(base)+path.sep))fs.rmSync(dir,{recursive:true,force:true});}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {trustedMacFile} from '../src/macTrust.mjs';
import {macChildEnv} from '../src/provider.mjs';
import {prepareMacDependency,verifyMacSetupBoundary} from '../src/macDependency.mjs';
import {dependencyLinksSafe,preparedNpmDependency,validateReviewedNpmSetup} from '../src/wslChecks.mjs';

const step={ifMissing:'node_modules',command:['npm','ci','--ignore-scripts','--no-audit','--no-fund']};

test('reviewed npm setup rejects modified inputs and symbolic-link escapes',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-mac-policy-'));
  let marker;
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'});
  try{
    git('init','-b','test');
    fs.writeFileSync(path.join(dir,'package.json'),'{}\n');
    fs.writeFileSync(path.join(dir,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{'':{name:'fixture'},'node_modules/pkg':{resolved:'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz',integrity:'sha512-AAAA'}}}));
    git('add','package.json','package-lock.json');
    git('-c','user.name=Workspace Test','-c','user.email=workspace@example.invalid','commit','-m','fixture');
    assert.match(validateReviewedNpmSetup(dir,step).digest,/^[a-f0-9]{64}$/);
    assert.throws(()=>validateReviewedNpmSetup(dir,{...step,command:[...step.command,'--ignore-scripts=false']}),/reviewed npm ci/);
    fs.writeFileSync(path.join(dir,'package-lock.json'),JSON.stringify({packages:{'node_modules/pkg':{resolved:'https://other.example/pkg.tgz',integrity:'sha512-AAAA'}}}));
    assert.throws(()=>validateReviewedNpmSetup(dir,step),/manifest or npm configuration changed/);
    git('checkout','--','package-lock.json');
    fs.writeFileSync(path.join(dir,'.gitignore'),'.npmrc\n');fs.writeFileSync(path.join(dir,'.npmrc'),'registry=https://other.example/\n');
    assert.throws(()=>validateReviewedNpmSetup(dir,step),/manifest or npm configuration changed/);
    fs.rmSync(path.join(dir,'.npmrc'));
    const mount=path.join(dir,'node_modules');fs.mkdirSync(mount);
    assert.equal(dependencyLinksSafe(mount),true);
    const pkg=path.join(mount,'pkg');fs.mkdirSync(pkg);fs.writeFileSync(path.join(pkg,'package.json'),'{}');
    fs.writeFileSync(path.join(mount,'.package-lock.json'),JSON.stringify({packages:{'node_modules/pkg':{version:'1.0.0'}}}));
    const reviewed=validateReviewedNpmSetup(dir,step);marker=reviewed.marker;
    assert.equal(preparedNpmDependency(dir,step,'darwin'),false);
    fs.writeFileSync(marker,JSON.stringify({digest:reviewed.digest}));
    assert.equal(preparedNpmDependency(dir,step,'darwin'),false,'A Windows-style marker cannot authorize macOS dependencies');
    fs.writeFileSync(marker,JSON.stringify({digest:reviewed.digest,platform:'darwin'}));
    assert.equal(preparedNpmDependency(dir,step,'darwin'),true);
    const outside=path.join(dir,'outside');fs.mkdirSync(outside);
    fs.symlinkSync(outside,path.join(mount,'escape'),process.platform==='win32'?'junction':'dir');
    assert.equal(dependencyLinksSafe(mount),false);
    assert.equal(preparedNpmDependency(dir,step,'darwin'),false,'A link escape invalidates an issued marker');
  }finally{if(marker)fs.rmSync(marker,{force:true});fs.rmSync(dir,{recursive:true,force:true});}
});

test('macOS child environment discards executable and npm configuration injection',()=>{
  const previous=process.env.NODE_OPTIONS;
  try{
    process.env.NODE_OPTIONS='--require=/tmp/untrusted.js';
    const env=macChildEnv('/trusted/bin:/usr/bin:/bin');
    assert.equal(env.PATH,'/trusted/bin:/usr/bin:/bin');
    assert.equal(env.NODE_OPTIONS,undefined);
    assert.equal(env.WORKSPACE_TOKEN,undefined);
  }finally{if(previous===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=previous;}
});

test('macOS dependency commands refuse to run on Windows',async()=>{
  if(process.platform==='darwin')return;
  await assert.rejects(prepareMacDependency(process.cwd(),step),/requires macOS/);
  await assert.rejects(verifyMacSetupBoundary(process.cwd(),{}),/requires macOS/);
});

test('pinned macOS executable policy rejects missing config and worktree shims',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-mac-shim-'));
  try{
    const shim=path.join(dir,'codex');fs.writeFileSync(shim,'shim');
    assert.throws(()=>trustedMacFile('codex',dir,{}),/must be configured/);
    assert.throws(()=>trustedMacFile('codex',dir,{WORKSPACE_MAC_CODEX:shim,WORKSPACE_MAC_CODEX_SHA256:'0'.repeat(64)}),/Untrusted macOS codex path/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

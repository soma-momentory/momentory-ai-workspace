import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {trustedMacFile} from '../src/macTrust.mjs';
import {macChildEnv} from '../src/provider.mjs';
import {prepareMacDependency,verifyMacSetupBoundary} from '../src/macDependency.mjs';
import {dependencyLinksSafe,preparedNpmDependency,validateReviewedNpmSetup} from '../src/wslChecks.mjs';

const step={ifMissing:'node_modules',command:['npm','ci','--ignore-scripts','--no-audit','--no-fund']};

test('reviewed npm setup rejects modified inputs and symbolic-link escapes',()=>{
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workspace-mac-policy-')));
  let marker;
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'});
  try{
    git('init','-b','test');
    fs.writeFileSync(path.join(dir,'package.json'),'{}\n');
    fs.writeFileSync(path.join(dir,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{'':{name:'fixture'},'node_modules/pkg':{resolved:'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz',integrity:'sha512-AAAA'}}}));
    git('add','package.json','package-lock.json');
    git('-c','user.name=Workspace Test','-c','user.email=workspace@example.invalid','commit','-m','fixture');
    assert.match(validateReviewedNpmSetup(dir,step).digest,/^[a-f0-9]{64}$/);
    if(process.platform==='darwin'){
      const previous=process.env.PATH,previousGit=process.env.GIT_DIR;
      fs.writeFileSync(path.join(dir,'git'),'#!/bin/sh\ntouch UNSANDBOXED_GIT_RAN\n',{mode:0o755});
      try{process.env.PATH=dir;process.env.GIT_DIR='/missing/attacker/repo';assert.match(validateReviewedNpmSetup(dir,step).digest,/^[a-f0-9]{64}$/);assert.equal(fs.existsSync(path.join(dir,'UNSANDBOXED_GIT_RAN')),false);}
      finally{process.env.PATH=previous;if(previousGit===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=previousGit;fs.rmSync(path.join(dir,'git'));}
    }
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
    fs.writeFileSync(path.join(mount,'.package-lock.json'),JSON.stringify({packages:{'node_modules/pkg':{resolved:'https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz',integrity:'sha512-AAAA'}}}));
    const reviewed=validateReviewedNpmSetup(dir,step);marker=reviewed.marker;
    assert.equal(preparedNpmDependency(dir,step,'darwin'),false);
    fs.writeFileSync(marker,JSON.stringify({digest:reviewed.digest}));
    assert.equal(preparedNpmDependency(dir,step,'darwin'),false,'A Windows-style marker cannot authorize macOS dependencies');
    fs.writeFileSync(marker,JSON.stringify({digest:reviewed.digest,platform:'darwin'}));
    assert.equal(preparedNpmDependency(dir,step,'darwin'),true);
    const index=path.join(mount,'.package-lock.json'),indexBytes=fs.readFileSync(index);
    fs.writeFileSync(index,JSON.stringify({packages:{'node_modules/pkg':{version:'99.0.0'}}}));
    assert.equal(preparedNpmDependency(dir,step,'darwin'),false,'A substituted installed index cannot reuse an approval marker');
    fs.writeFileSync(index,indexBytes);
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
    assert.equal(env.OPENSSL_CONF,'/dev/null');
  }finally{if(previous===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=previous;}
});

test('macOS dependency commands refuse to run on other platforms',{skip:process.platform==='darwin'},async()=>{
  await assert.rejects(prepareMacDependency(process.cwd(),step),/requires macOS/);
  await assert.rejects(verifyMacSetupBoundary(process.cwd(),{}),/requires macOS/);
});

test('macOS executable pins reject replacement, writable files, links and PATH shims',{skip:process.platform!=='darwin'},()=>{
  const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workspace-mac-pins-')));
  const cwd=path.join(base,'task'),bin=path.join(base,'bin');fs.mkdirSync(cwd);fs.mkdirSync(bin);
  const file=path.join(bin,'codex'),alias=path.join(bin,'alias');
  const originalPath=process.env.PATH;
  try{
    fs.writeFileSync(file,'#!/bin/sh\nexit 0\n',{mode:0o755});
    const env={WORKSPACE_MAC_CODEX:file,WORKSPACE_MAC_CODEX_SHA256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
    process.env.PATH=cwd;fs.writeFileSync(path.join(cwd,'codex'),'malicious shim',{mode:0o755});
    assert.equal(trustedMacFile('codex',cwd,env),file);
    fs.appendFileSync(file,'# replaced\n');assert.throws(()=>trustedMacFile('codex',cwd,env),/checksum changed/);
    env.WORKSPACE_MAC_CODEX_SHA256=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    fs.chmodSync(file,0o777);assert.throws(()=>trustedMacFile('codex',cwd,env),/ownership or permissions/);fs.chmodSync(file,0o755);
    fs.chmodSync(bin,0o777);assert.throws(()=>trustedMacFile('codex',cwd,env),/ownership or permissions/);fs.chmodSync(bin,0o755);
    fs.symlinkSync(file,alias);assert.throws(()=>trustedMacFile('codex',cwd,{...env,WORKSPACE_MAC_CODEX:alias}),/symbolic link/);
  }finally{process.env.PATH=originalPath;fs.rmSync(base,{recursive:true,force:true});}
});

test('macOS Gradle preparation stays explicitly blocked',{skip:process.platform!=='darwin'},async()=>{
  await assert.rejects(prepareMacDependency(process.cwd(),{ifMissing:'.gradle/workspace-home'}),/Gradle.*not implemented/);
});

test('real macOS locked npm preparation and marker validation',{
  skip:process.platform!=='darwin'||process.env.RUN_MAC_DEPENDENCY_INTEGRATION!=='1',timeout:180000
},async()=>{
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workspace-mac-install-')));
  let marker;
  const git=(...args)=>execFileSync('/usr/bin/git',args,{cwd:dir,encoding:'utf8'}).trim();
  try{
    // Official registry metadata, independently fixed in this reviewed test.
    fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'workspace-mac-fixture',version:'1.0.0',private:true,dependencies:{'is-number':'7.0.0'},scripts:{preinstall:'touch LIFECYCLE_RAN'}}));
    fs.writeFileSync(path.join(dir,'package-lock.json'),JSON.stringify({name:'workspace-mac-fixture',version:'1.0.0',lockfileVersion:3,requires:true,packages:{'':{name:'workspace-mac-fixture',version:'1.0.0',hasInstallScript:true,dependencies:{'is-number':'7.0.0'}},'node_modules/is-number':{version:'7.0.0',resolved:'https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz',integrity:'sha512-41Cifkg6e8TylSpdtTpeLVMqvSBEVzTttHvERD741+pnZ8ANv0004MRL43QKPDlK9cGvNp6NZWZUBlbGXYxxng=='}}}));
    git('init','-b','test');git('add','.');git('-c','user.name=Workspace Test','-c','user.email=workspace@example.invalid','commit','-m','Reviewed macOS npm fixture');
    const reviewed=validateReviewedNpmSetup(dir,step);marker=reviewed.marker;
    console.log(JSON.stringify({fixtureHead:git('rev-parse','HEAD'),reviewedDigest:reviewed.digest,lockSha256:createHash('sha256').update(fs.readFileSync(reviewed.lock)).digest('hex'),command:step.command}));
    const result=await prepareMacDependency(dir,step);assert.equal(result.ok,true,result.output);
    assert.equal(fs.existsSync(path.join(dir,'LIFECYCLE_RAN')),false);
    assert.equal(preparedNpmDependency(dir,step),true);
    const reused=await prepareMacDependency(dir,step);assert.equal(reused.ok,true);assert.match(reused.output,/Previously prepared/);
    const original=fs.readFileSync(marker);const record=JSON.parse(original);record.digest='0'.repeat(64);fs.writeFileSync(marker,JSON.stringify(record));
    assert.equal(preparedNpmDependency(dir,step),false);await assert.rejects(prepareMacDependency(dir,step),/Unverified dependency mount or marker/);
    fs.writeFileSync(marker,original);
    fs.symlinkSync(path.dirname(dir),path.join(dir,'node_modules','escape'));assert.equal(preparedNpmDependency(dir,step),false);
    await assert.rejects(prepareMacDependency(dir,step),/Unverified dependency mount or marker/);
    console.log(JSON.stringify({npmInstall:'PASS',lifecycle:'NOT_EXECUTED',markerReuse:'PASS',markerTamper:'DENIED',linkEscape:'DENIED'}));
  }finally{if(marker)fs.rmSync(marker,{force:true});fs.rmSync(dir,{recursive:true,force:true});}
});

test('pinned macOS executable policy rejects missing config and worktree shims',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-mac-shim-'));
  try{
    const shim=path.join(dir,'codex');fs.writeFileSync(shim,'shim');
    assert.throws(()=>trustedMacFile('codex',dir,{}),/must be configured/);
    assert.throws(()=>trustedMacFile('codex',dir,{WORKSPACE_MAC_CODEX:shim,WORKSPACE_MAC_CODEX_SHA256:'0'.repeat(64)}),/Untrusted macOS codex path/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

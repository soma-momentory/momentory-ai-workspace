import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {trustedMacFile,validateMacWorktree} from '../src/macTrust.mjs';
import {macChildEnv,activeMacProcessesForWorktree} from '../src/provider.mjs';
import {prepareMacDependency,verifyMacSetupBoundary} from '../src/macDependency.mjs';
import {dependencyLinksSafe,preparedNpmDependency,validateReviewedNpmSetup} from '../src/wslChecks.mjs';
import {runMacGradleCheck,verifyMacGradleMaterials} from '../src/macGradle.mjs';
import {root} from '../src/config.mjs';
import {cleanupMacGradleContainer} from '../src/macGradleContainer.mjs';

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
  const previous=process.env.WORKSPACE_MAC_GRADLE_POLICY,cwd=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workspace-no-gradle-policy-')));
  try{delete process.env.WORKSPACE_MAC_GRADLE_POLICY;await assert.rejects(prepareMacDependency(cwd,{ifMissing:'.gradle/workspace-home',command:['./gradlew','dependencies','--configuration','testRuntimeClasspath','--no-daemon']}),/Gradle.*blocked/);}
  finally{if(previous===undefined)delete process.env.WORKSPACE_MAC_GRADLE_POLICY;else process.env.WORKSPACE_MAC_GRADLE_POLICY=previous;fs.rmSync(cwd,{recursive:true,force:true});}
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
    await assert.rejects(prepareMacDependency(dir,step),/Unverified dependency mount or marker|symbolic link escapes/);
    console.log(JSON.stringify({npmInstall:'PASS',lifecycle:'NOT_EXECUTED',markerReuse:'PASS',markerTamper:'DENIED',linkEscape:'DENIED'}));
  }finally{if(marker)fs.rmSync(marker,{force:true});fs.rmSync(dir,{recursive:true,force:true});}
});

test('reviewed npm workspace links bind their tracked manifest and reject substitutions',()=>{
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workspace-reviewed-link-')));let marker;
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'});
  try{
    fs.mkdirSync(path.join(dir,'lab'));fs.writeFileSync(path.join(dir,'lab','package.json'),'{"name":"reviewed-lab","version":"1.0.0"}');
    fs.writeFileSync(path.join(dir,'package.json'),'{"name":"fixture","workspaces":["lab"]}');
    const packages={'':{name:'fixture',workspaces:['lab']},lab:{name:'reviewed-lab',version:'1.0.0'},'node_modules/reviewed-lab':{resolved:'lab',link:true}};
    fs.writeFileSync(path.join(dir,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages}));
    git('init','-b','test');git('add','.');git('-c','user.name=Workspace Test','-c','user.email=workspace@example.invalid','commit','-m','Reviewed workspace fixture');
    const mount=path.join(dir,'node_modules');fs.mkdirSync(mount);fs.symlinkSync(path.join(dir,'lab'),path.join(mount,'reviewed-lab'),process.platform==='win32'?'junction':'dir');fs.writeFileSync(path.join(mount,'.package-lock.json'),JSON.stringify({packages:{lab:packages.lab,'node_modules/reviewed-lab':packages['node_modules/reviewed-lab']}}));
    const reviewed=validateReviewedNpmSetup(dir,step);marker=reviewed.marker;fs.writeFileSync(marker,JSON.stringify({digest:reviewed.digest,platform:'darwin'}));
    assert.equal(dependencyLinksSafe(mount),false,'Unlisted external links remain denied');
    if(process.platform==='darwin'){
      assert.equal(preparedNpmDependency(dir,step),true,'Exact reviewed workspace link should be supported');validateMacWorktree(dir);
      fs.writeFileSync(path.join(dir,'lab','package.json'),'{"name":"reviewed-lab","version":"99.0.0"}');
      assert.equal(preparedNpmDependency(dir,step),false);assert.throws(()=>validateReviewedNpmSetup(dir,step),/manifest or npm configuration changed/);
      git('checkout','--','lab/package.json');fs.rmSync(path.join(mount,'reviewed-lab'));fs.symlinkSync(path.dirname(dir),path.join(mount,'reviewed-lab'));
      assert.equal(preparedNpmDependency(dir,step),false);assert.throws(()=>validateMacWorktree(dir),/symbolic link escapes/);
    }
  }finally{if(marker)fs.rmSync(marker,{force:true});fs.rmSync(dir,{recursive:true,force:true});}
});

test('actual macOS mounted volume and symbolic links fail closed',{
  skip:process.platform!=='darwin'||process.env.RUN_MAC_MOUNT_INTEGRATION!=='1',timeout:120000
},async()=>{
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workspace-real-mount-'))),mount=path.join(dir,'node_modules'),image=path.join(dir,'boundary.dmg');fs.mkdirSync(mount);
  const run=(...args)=>execFileSync('/usr/bin/hdiutil',args,{encoding:'utf8',timeout:30000});
  try{
    run('create','-size','16m','-fs','HFS+','-volname','WorkspaceBoundary',image);console.log(run('attach','-nobrowse','-mountpoint',mount,image));
    assert.notEqual(fs.statSync(mount).dev,fs.statSync(dir).dev);assert.equal(dependencyLinksSafe(mount),false);assert.throws(()=>validateMacWorktree(dir),/Unapproved macOS mount/);
    await assert.rejects(prepareMacDependency(dir,step),/Unapproved macOS mount/);
    console.log('PASS: actual mounted dependency tree denied before execution');
    const project=path.join(dir,'link-only-project');fs.mkdirSync(project);
    fs.symlinkSync(mount,path.join(project,'mounted-alias'));
    assert.throws(()=>validateMacWorktree(project),/symbolic link escapes/);
    console.log('PASS: link-only project cannot alias the externally mounted volume');
  }finally{
    if(fs.statSync(mount).dev!==fs.statSync(dir).dev)run('detach',mount);
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('pinned macOS executable policy rejects missing config and worktree shims',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-mac-shim-'));
  try{
    const shim=path.join(dir,'codex');fs.writeFileSync(shim,'shim');
    assert.throws(()=>trustedMacFile('codex',dir,{}),/must be configured/);
    assert.throws(()=>trustedMacFile('codex',dir,{WORKSPACE_MAC_CODEX:shim,WORKSPACE_MAC_CODEX_SHA256:'0'.repeat(64)}),/Untrusted macOS codex path/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('unapproved Gradle review proposals cannot authorize setup or checks',{skip:process.platform!=='darwin'},async()=>{
  const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workspace-gradle-review-'))),cwd=path.join(base,'project'),file=path.join(base,'review.json');fs.mkdirSync(cwd);
  const oldPolicy=process.env.WORKSPACE_MAC_GRADLE_POLICY,oldSha=process.env.WORKSPACE_MAC_GRADLE_POLICY_SHA256;
  try{
    fs.writeFileSync(file,JSON.stringify({version:2,reviewOnly:true}),{mode:0o600});process.env.WORKSPACE_MAC_GRADLE_POLICY=file;process.env.WORKSPACE_MAC_GRADLE_POLICY_SHA256=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    await assert.rejects(prepareMacDependency(cwd,{ifMissing:'.gradle/workspace-home',command:['./gradlew','dependencies','--configuration','testRuntimeClasspath','--no-daemon']}),/Unapproved Gradle review proposal/);
    await assert.rejects(runMacGradleCheck(cwd,['test'],1000),/Unapproved Gradle review proposal/);
  }finally{
    if(oldPolicy===undefined)delete process.env.WORKSPACE_MAC_GRADLE_POLICY;else process.env.WORKSPACE_MAC_GRADLE_POLICY=oldPolicy;
    if(oldSha===undefined)delete process.env.WORKSPACE_MAC_GRADLE_POLICY_SHA256;else process.env.WORKSPACE_MAC_GRADLE_POLICY_SHA256=oldSha;
    fs.rmSync(base,{recursive:true,force:true});
  }
});

test('real macOS isolated Gradle workers and malicious input regression',{
  skip:process.platform!=='darwin'||process.env.RUN_MAC_GRADLE_INTEGRATION!=='1',timeout:180000
},async()=>{
  const source=process.env.WORKSPACE_TEST_GRADLE_WORKTREE;assert.ok(source,'Set the reviewed controlled Gradle fixture path');
  const cwd=path.join(root,'data',`gradle-regression-${randomUUID()}`),marker=path.join(root,'data/check-deps',createHash('sha256').update(cwd+'|mac-gradle').digest('hex')+'.json');
  execFileSync('/usr/bin/git',['clone','--no-hardlinks',source,cwd],{stdio:'ignore'});
  const server=http.createServer((_req,res)=>res.end('SYNTHETIC_OTHER_PROJECT_SERVICE'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const target=path.join(cwd,'attack-targets.txt'),targets=fs.readFileSync(target,'utf8').trim().split('\n');targets[0]=String(server.address().port);fs.writeFileSync(target,targets.join('\n')+'\n');
    assert.equal(await(await fetch(`http://127.0.0.1:${server.address().port}`)).text(),'SYNTHETIC_OTHER_PROJECT_SERVICE');
    const prepared=await prepareMacDependency(cwd,{ifMissing:'.gradle/workspace-home',command:['./gradlew','dependencies','--configuration','testRuntimeClasspath','--no-daemon']});assert.equal(prepared.ok,true,prepared.output);
    const reused=await prepareMacDependency(cwd,{ifMissing:'.gradle/workspace-home',command:['./gradlew','dependencies','--configuration','testRuntimeClasspath','--no-daemon']});
    assert.equal(reused.ok,true);assert.match(reused.output,/Previously prepared reviewed macOS Gradle materials/);
    const check=await runMacGradleCheck(cwd,['clean','check'],120000);assert.equal(check.ok,true,check.output);
    assert.match(check.output,/WORKSPACE_TEST_COUNTS tests=5 failed=0 skipped=0/);assert.match(check.output,/WORKER_API_IPC_OK/);assert.match(check.output,/MALICIOUS_BUILD_INPUTS_DENIED/);
    assert.equal(check.isolation.network,'none');assert.equal(check.isolation.user,'65532:65532');assert.ok(check.isolation.mounts.every(mount=>!mount.writable));
    assert.equal(fs.existsSync(path.join(cwd,'command-attempt.txt')),false);assert.equal(fs.existsSync(path.join(cwd,'generated-control.txt')),false);assert.equal(fs.readFileSync(path.join(cwd,'.env.canary'),'utf8'),'SYNTHETIC_PROJECT_SECRET');
    const oversized=path.join(cwd,'oversized-input.bin'),fd=fs.openSync(oversized,'wx');fs.ftruncateSync(fd,64*1024*1024+1);fs.closeSync(fd);
    try{await assert.rejects(runMacGradleCheck(cwd,['test'],1000),/source snapshot byte limit/);}finally{fs.unlinkSync(oversized);}
    const verification=path.join(cwd,'gradle/verification-metadata.xml'),original=fs.readFileSync(verification);fs.appendFileSync(verification,'\n');
    await assert.rejects(runMacGradleCheck(cwd,['test'],1000),/Gradle build inputs changed/);fs.writeFileSync(verification,original);
    const policy=JSON.parse(fs.readFileSync(process.env.WORKSPACE_MAC_GRADLE_POLICY)),artifact=path.join(policy.repository,'org/jetbrains/annotations/26.0.2/annotations-26.0.2.jar'),bytes=fs.readFileSync(artifact);
    try{fs.appendFileSync(artifact,'TAMPER');await assert.rejects(verifyMacGradleMaterials(cwd),/artifact checksum/);}finally{fs.writeFileSync(artifact,bytes);}
    const addedArtifact=path.join(policy.repository,`unapproved-${randomUUID()}.jar`);fs.writeFileSync(addedArtifact,'UNAPPROVED_ARTIFACT',{flag:'wx'});
    try{
      await assert.rejects(verifyMacGradleMaterials(cwd),/Unreviewed Gradle artifact exists/);
      await assert.rejects(runMacGradleCheck(cwd,['test'],1000),/Unreviewed Gradle artifact exists/);
    }finally{fs.unlinkSync(addedArtifact);}
    const oldPolicy=process.env.WORKSPACE_MAC_GRADLE_POLICY,oldSha=process.env.WORKSPACE_MAC_GRADLE_POLICY_SHA256,unapproved=path.join(fs.realpathSync(os.tmpdir()),`gradle-policy-${randomUUID()}.json`);
    try{
      const changed=structuredClone(policy);changed.artifacts[0].url='https://unapproved.example.invalid/artifact';fs.writeFileSync(unapproved,JSON.stringify(changed),{mode:0o600});process.env.WORKSPACE_MAC_GRADLE_POLICY=unapproved;process.env.WORKSPACE_MAC_GRADLE_POLICY_SHA256=createHash('sha256').update(fs.readFileSync(unapproved)).digest('hex');
      await assert.rejects(verifyMacGradleMaterials(cwd),/Unapproved Gradle artifact source/);
    }finally{process.env.WORKSPACE_MAC_GRADLE_POLICY=oldPolicy;process.env.WORKSPACE_MAC_GRADLE_POLICY_SHA256=oldSha;fs.rmSync(unapproved,{force:true});}
    const home=path.join(cwd,'.gradle/workspace-home');fs.mkdirSync(home,{recursive:true});fs.writeFileSync(path.join(home,'unapproved.jar'),'POISONED_CACHE');
    await assert.rejects(runMacGradleCheck(cwd,['test'],1000),/Unreviewed macOS Gradle cache/);fs.rmSync(path.join(cwd,'.gradle'),{recursive:true});
    const originalMarker=fs.readFileSync(marker);fs.writeFileSync(marker,JSON.stringify({version:2,platform:'darwin',digest:'0'.repeat(64),isolation:'colima-network-none'}));
    await assert.rejects(runMacGradleCheck(cwd,['test'],1000),/preparation is not approved/);fs.writeFileSync(marker,originalMarker);
    const control={name:`momentory-gradle-${randomUUID()}`,docker:policy.execution.docker,sha256:policy.execution.dockerSha256,socket:policy.execution.socket};
    const docker=(...args)=>execFileSync(trustedMacFile('docker',cwd,{WORKSPACE_MAC_DOCKER:control.docker,WORKSPACE_MAC_DOCKER_SHA256:control.sha256}),['--host',`unix://${control.socket}`,'--config',path.join(root,'data/docker-control'),...args],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8'}).trim();
    const unrelated=docker('create','--pull=never','--name',control.name,'--network=none','--read-only','--cap-drop=ALL','--user=65532:65532',policy.execution.image,'/bin/true');
    assert.match(unrelated,/^[a-f0-9]{64}$/);
    try{assert.throws(()=>cleanupMacGradleContainer(control,cwd),/ownership differs/);assert.equal(docker('inspect','--format','{{.Id}}',unrelated),unrelated);}finally{docker('rm',unrelated);}
    const crashMode=path.join(cwd,'crash-mode');fs.writeFileSync(crashMode,'CONTROLLED_CANCEL_AND_TIMEOUT\n');
    const abort=new AbortController(),pending=runMacGradleCheck(cwd,['test'],30000,abort.signal).then(result=>({result}),error=>({error:String(error)}));
    let ready=false;
    for(let i=0;i<120;i++){
      await new Promise(resolve=>setTimeout(resolve,100));
      const names=docker('ps','--filter',`label=momentory.worktree=${createHash('sha256').update(cwd).digest('hex')}`,'--format','{{.Names}}');
      if(names&&docker('logs',names).includes('GRADLE_CRASH_CHILD_READY')){ready=true;break;}
    }
    abort.abort();const cancelled=await pending;assert.ok(ready,'Cancellation must interrupt actual Gradle descendants');assert.ok(cancelled.error||!cancelled.result.ok);assert.deepEqual(activeMacProcessesForWorktree(cwd),[]);
    const timeout=await runMacGradleCheck(cwd,['test'],1000);assert.equal(timeout.ok,false);assert.equal(timeout.timedOut,true);assert.deepEqual(activeMacProcessesForWorktree(cwd),[]);
    fs.unlinkSync(crashMode);const recovered=await runMacGradleCheck(cwd,['test'],120000);assert.equal(recovered.ok,true,recovered.output);assert.match(recovered.output,/WORKSPACE_TEST_COUNTS tests=5 failed=0 skipped=0/);
    assert.equal((await verifyMacGradleMaterials(cwd)).ok,true);assert.deepEqual(activeMacProcessesForWorktree(cwd),[]);
    console.log(JSON.stringify({gradle:'PASS',testWorkerTests:5,workerApi:'PASS',networkNone:'PASS',hostLoopbackDenied:true,sourceSecretAndArtifactDenial:true,oversizedSource:'DENIED',metadataTamper:'DENIED',artifactTamper:'DENIED',unapprovedArtifact:'DENIED',reviewedMaterialReuse:true,unapprovedCache:'DENIED',markerTamper:'DENIED',wrongContainerOwner:'DENIED',cancelledDescendantsReaped:true,timeoutNamespaceReaped:true,freshCheckRecovery:true}));
  }finally{
    await new Promise(resolve=>server.close(resolve));
    if(!activeMacProcessesForWorktree(cwd).length){fs.rmSync(marker,{force:true});fs.rmSync(cwd,{recursive:true,force:true});}
  }
});

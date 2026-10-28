import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {gradleLockfiles,verifyGradleLocks,gradleLockPreflight} from '../src/gradleLocks.mjs';
import {reviewWslGradleLocks} from '../src/wslChecks.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(){
  const cwd=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'workspace-gradle-locks-')));
  execFileSync('git',['init','-q'],{cwd});
  execFileSync('git',['config','user.email','fixture@example.invalid'],{cwd});
  execFileSync('git',['config','user.name','Fixture'],{cwd});
  execFileSync('git',['config','core.autocrlf','false'],{cwd});
  fs.writeFileSync(path.join(cwd,'build.gradle.kts'),'plugins { java }\n');
  fs.writeFileSync(path.join(cwd,gradleLockfiles[0]),'org.example:one:1=compileClasspath\n');
  fs.writeFileSync(path.join(cwd,gradleLockfiles[1]),'org.example:two:1=classpath\n');
  execFileSync('git',['add','.'],{cwd});execFileSync('git',['commit','-qm','Synthetic Gradle fixture'],{cwd});
  return cwd;
}
function withFixture(fn){const cwd=fixture();try{fn(cwd,verifyGradleLocks(cwd));}finally{fs.rmSync(cwd,{recursive:true,force:true});}}

test('approved raw lockfile bytes and tracked WSL inputs pass',()=>withFixture((cwd,approved)=>{
  assert.deepEqual(verifyGradleLocks(cwd,approved),approved);
  assert.deepEqual(reviewWslGradleLocks(cwd),approved);
  assert.match(gradleLockPreflight(approved),/sha256sum gradle\.lockfile/);
  assert.match(gradleLockPreflight(approved),/sha256sum buildscript-gradle\.lockfile/);
}));

for(const name of gradleLockfiles){
  test(`${name}: modified bytes are rejected before Gradle`,()=>withFixture((cwd,approved)=>{
    fs.appendFileSync(path.join(cwd,name),'tampered\n');
    assert.throws(()=>verifyGradleLocks(cwd,approved),/checksum changed/);
    assert.throws(()=>reviewWslGradleLocks(cwd),/build inputs/);
  }));
  test(`${name}: deletion is rejected before Gradle`,()=>withFixture((cwd,approved)=>{
    fs.unlinkSync(path.join(cwd,name));
    assert.throws(()=>verifyGradleLocks(cwd,approved),/missing/);
    assert.throws(()=>reviewWslGradleLocks(cwd),/build inputs/);
  }));
}

test('an older lockfile cannot inherit a newer approval',()=>withFixture((cwd,approved)=>{
  fs.writeFileSync(path.join(cwd,gradleLockfiles[0]),'org.example:one:0=compileClasspath\n');
  assert.throws(()=>verifyGradleLocks(cwd,approved),/checksum changed/);
}));

test('a change after initial verification invalidates the execution snapshot',()=>withFixture((cwd,approved)=>{
  verifyGradleLocks(cwd,approved);
  const snapshot=path.join(cwd,'snapshot');fs.mkdirSync(snapshot);
  for(const name of gradleLockfiles)fs.copyFileSync(path.join(cwd,name),path.join(snapshot,name));
  fs.appendFileSync(path.join(snapshot,gradleLockfiles[1]),'race\n');
  assert.throws(()=>verifyGradleLocks(snapshot,approved),/checksum changed/);
}));

test('a lockfile symbolic link or path alias is rejected',()=>withFixture((cwd,approved)=>{
  const name=gradleLockfiles[0],file=path.join(cwd,name),target=path.join(cwd,'other.lock');
  fs.renameSync(file,target);
  try{fs.symlinkSync(target,file,'file');}catch(error){
    if(error.code!=='EPERM'||process.platform!=='win32')throw error;
    // An unprivileged Windows account may not create file symlinks. Exercise
    // the same verifier on WSL's native filesystem instead.
    const source=path.resolve('src/gradleLocks.mjs').replaceAll('\\','/');
    const converted=spawnSync('wsl.exe',['-d','Ubuntu','--exec','/usr/bin/wslpath','-u',source],{encoding:'utf8',timeout:10000});
    assert.equal(converted.status,0,converted.stderr);
    const script=`import fs from 'node:fs'; import path from 'node:path'; const {verifyGradleLocks}=await import('file://${converted.stdout.trim()}'); const dir=fs.mkdtempSync('/tmp/workspace-gradle-symlink-'); const target=path.join(dir,'target.lock'); const link=path.join(dir,'gradle.lockfile'); const other=path.join(dir,'buildscript-gradle.lockfile'); try { fs.writeFileSync(target,'approved'); fs.writeFileSync(other,'approved'); fs.symlinkSync(target,link); try { verifyGradleLocks(dir); process.exitCode=1; } catch(error) { if(!/aliases another path/.test(error.message)) throw error; } } finally { fs.unlinkSync(link); fs.unlinkSync(target); fs.unlinkSync(other); fs.rmdirSync(dir); }`;
    const result=spawnSync('wsl.exe',['-d','Ubuntu','--exec','/usr/bin/node','--input-type=module','-e',script],{encoding:'utf8',timeout:10000});
    assert.equal(result.status,0,result.stderr);
    return;
  }
  assert.throws(()=>verifyGradleLocks(cwd,approved),/aliases another path/);
}));

test('a hard-linked lockfile alias is rejected',()=>withFixture((cwd,approved)=>{
  const file=path.join(cwd,gradleLockfiles[1]),alias=path.join(cwd,'other.lock');
  fs.linkSync(file,alias);
  assert.throws(()=>verifyGradleLocks(cwd,approved),/aliases another path/);
}));

test('a directory junction cannot alias approved root lockfiles',t=>withFixture((cwd,approved)=>{
  const alias=path.join(path.dirname(cwd),`${path.basename(cwd)}-alias`);
  try{fs.symlinkSync(cwd,alias,process.platform==='win32'?'junction':'dir');}
  catch(error){if(error.code==='EPERM'){t.skip('Directory junction privilege unavailable');return;}throw error;}
  try{assert.throws(()=>verifyGradleLocks(alias,approved),/aliases another path/);}
  finally{fs.unlinkSync(alias);}
}));

test('Git LF blob is distinct from CRLF execution bytes and approval pins execution bytes',()=>withFixture((cwd)=>{
  const name=gradleLockfiles[0],file=path.join(cwd,name),gitBytes=execFileSync('git',['show',`HEAD:${name}`],{cwd});
  const checkout=Buffer.from(gitBytes.toString('utf8').replaceAll('\n','\r\n'));
  fs.writeFileSync(file,checkout);
  assert.notEqual(hash(gitBytes),hash(checkout));
  assert.throws(()=>verifyGradleLocks(cwd,{...verifyGradleLocks(cwd),[name]:hash(gitBytes)}),/checksum changed/);
  assert.equal(verifyGradleLocks(cwd)[name],hash(checkout));
}));

test('unchanged approval metadata cannot authorize a changed lockfile',()=>withFixture((cwd,approved)=>{
  const policy={inputs:{...approved}};
  fs.appendFileSync(path.join(cwd,gradleLockfiles[1]),'new dependency\n');
  assert.throws(()=>verifyGradleLocks(cwd,policy.inputs),/checksum changed/);
}));

test('WSL input inventory rejects an absent root lockfile',()=>withFixture((cwd)=>{
  execFileSync('git',['rm','-q',gradleLockfiles[1]],{cwd});
  execFileSync('git',['commit','-qm','Synthetic incomplete input inventory'],{cwd});
  assert.throws(()=>reviewWslGradleLocks(cwd),/Required Gradle lockfiles/);
}));

test('Mac snapshot approval rejects an absent root lockfile or policy hash',()=>withFixture((cwd,approved)=>{
  const snapshot=path.join(cwd,'snapshot');fs.mkdirSync(snapshot);
  fs.copyFileSync(path.join(cwd,gradleLockfiles[0]),path.join(snapshot,gradleLockfiles[0]));
  assert.throws(()=>verifyGradleLocks(snapshot,approved),/missing/);
  fs.copyFileSync(path.join(cwd,gradleLockfiles[1]),path.join(snapshot,gradleLockfiles[1]));
  assert.throws(()=>verifyGradleLocks(snapshot,{[gradleLockfiles[0]]:approved[gradleLockfiles[0]]}),/checksum changed/);
}));

test('WSL rejects changed execution bytes immediately before Gradle',{skip:process.platform!=='win32'},()=>withFixture((cwd,approved)=>{
  const distro='Ubuntu-22.04';
  const converted=spawnSync('wsl.exe',['-d',distro,'--exec','/usr/bin/wslpath','-u',cwd.replaceAll('\\','/')],{encoding:'utf8',timeout:10000});
  if(converted.status!==0)throw new Error('Required WSL fixture path is unavailable');
  const script=`cd "$1" || exit 24; ${gradleLockPreflight(approved)}`;
  const args=['-d',distro,'--exec','/bin/sh','-c',script,'gradle-lock-preflight',converted.stdout.trim()];
  assert.equal(spawnSync('wsl.exe',args,{encoding:'utf8',timeout:10000}).status,0);
  fs.appendFileSync(path.join(cwd,gradleLockfiles[0]),'changed after review\n');
  const rejected=spawnSync('wsl.exe',args,{encoding:'utf8',timeout:10000});
  assert.equal(rejected.status,23,rejected.stderr);
  assert.match(rejected.stderr,/Gradle lockfile checksum changed/);
}));

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {root} from '../src/config.mjs';
import {prepareWslDependency,runWslCheck} from '../src/wslChecks.mjs';
import {verifyGradleLocks} from '../src/gradleLocks.mjs';
import {installCodexProfiles} from '../src/codexProfile.mjs';

assert.equal(process.platform,'win32','Run only on Windows with the existing WSL sandbox');
const wrapper=process.env.WORKSPACE_TEST_GRADLE_WRAPPER_DIR;
assert.ok(wrapper&&fs.realpathSync(wrapper)===path.resolve(wrapper),'Set a canonical reviewed Gradle wrapper fixture directory');
const cwd=path.join(root,'data',`gradle-lock-fixture-${randomUUID()}`);
const codexHome=path.join(root,'data',`gradle-lock-codex-home-${randomUUID()}`),previousCodexHome=process.env.CODEX_HOME;
process.env.CODEX_HOME=codexHome;installCodexProfiles();
fs.mkdirSync(path.join(cwd,'gradle','wrapper'),{recursive:true});
const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true});
const marker=path.join(root,'data','check-deps',`${createHash('sha256').update(path.resolve(cwd)+'|gradle').digest('hex')}.json`);
let success=false;
try{
  for(const name of ['gradlew','gradle/wrapper/gradle-wrapper.jar','gradle/wrapper/gradle-wrapper.properties']){
    const target=path.join(cwd,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(wrapper,name),target);
  }
  fs.writeFileSync(path.join(cwd,'settings.gradle.kts'),'rootProject.name = "synthetic-lock-fixture"\n');
  fs.writeFileSync(path.join(cwd,'build.gradle.kts'),'plugins { java }\ndependencyLocking { lockAllConfigurations() }\n');
  fs.writeFileSync(path.join(cwd,'gradle.lockfile'),'# Synthetic dependency lock\nempty=compileClasspath,testCompileClasspath,testRuntimeClasspath\n');
  fs.writeFileSync(path.join(cwd,'buildscript-gradle.lockfile'),'# Synthetic buildscript lock\nempty=classpath\n');
  git('init','-q');git('config','user.name','Gradle Fixture');git('config','user.email','fixture@example.invalid');git('config','core.autocrlf','false');git('add','.');git('commit','-qm','Synthetic Gradle lock fixture');
  const hashes=verifyGradleLocks(cwd);
  const step={ifMissing:'.gradle/workspace-home',command:['./gradlew','dependencies','--configuration','testRuntimeClasspath','--no-daemon']};
  const prepared=await prepareWslDependency(cwd,step);assert.equal(prepared.ok,true,prepared.output);
  const record=JSON.parse(fs.readFileSync(marker,'utf8'));assert.deepEqual(record.lockSha256,hashes);
  const reused=await prepareWslDependency(cwd,step);assert.equal(reused.ok,true,reused.output);
  fs.writeFileSync(marker,JSON.stringify({...record,lockSha256:undefined}));
  await assert.rejects(runWslCheck(cwd,'./gradlew',['check'],180000),/lockfile marker/);
  fs.writeFileSync(marker,JSON.stringify(record));
  const lock=path.join(cwd,'gradle.lockfile'),original=fs.readFileSync(lock);
  fs.appendFileSync(lock,'# changed after preparation\n');
  await assert.rejects(runWslCheck(cwd,'./gradlew',['check'],180000),/lockfile marker/);
  fs.writeFileSync(lock,original);
  const checked=await runWslCheck(cwd,'./gradlew',['check'],180000);assert.equal(checked.ok,true,checked.output);
  assert.match(checked.output,/BUILD SUCCESSFUL/);
  console.log(JSON.stringify({status:'PASS',fixture:cwd,wrapperSha256:createHash('sha256').update(fs.readFileSync(path.join(cwd,'gradle/wrapper/gradle-wrapper.jar'))).digest('hex'),lockSha256:hashes,prepared:true,reused:true,missingMarkerRejected:true,changedLockRejected:true,offlineCheck:true}));
  success=true;
}finally{
  if(success){fs.rmSync(marker,{force:true});fs.rmSync(cwd,{recursive:true,force:true});fs.rmSync(codexHome,{recursive:true,force:true});}
  else console.error(`Synthetic fixture retained for diagnosis: ${cwd}; isolated CODEX_HOME: ${codexHome}`);
  if(previousCodexHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previousCodexHome;
}

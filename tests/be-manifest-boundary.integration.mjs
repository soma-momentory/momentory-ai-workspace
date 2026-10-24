import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {root} from '../src/config.mjs';
import {repository} from '../src/projects.mjs';
import {prepareWslDependency} from '../src/wslChecks.mjs';

const cwd=process.env.WORKSPACE_TEST_BE_WORKTREE;
assert.ok(cwd&&path.resolve(cwd).startsWith(path.join(root,'worktrees')+path.sep),'Use an isolated BE worktree');
const file=path.join(cwd,'build.gradle.kts'),original=fs.readFileSync(file),buildSrc=path.join(cwd,'buildSrc'),injected=path.join(buildSrc,'injected.gradle'),initDir=path.join(cwd,'.gradle','workspace-home','init.d'),init=path.join(initDir,'injected.gradle'),properties=path.join(cwd,'.gradle','workspace-home','gradle.properties');
const source=path.join(cwd,'src','main','resources','application.yml'),originalSource=fs.readFileSync(source);
const marker=path.join(root,'data','check-deps',`${createHash('sha256').update(path.resolve(cwd)+'|gradle').digest('hex')}.json`),originalMarker=fs.readFileSync(marker);
assert.equal(fs.existsSync(buildSrc),false,'Use a clean test worktree without buildSrc');
assert.equal(fs.existsSync(init),false,'Do not overwrite a Gradle init script');
try{
  fs.appendFileSync(file,'\n// unreviewed dependency change\n');
  await assert.rejects(prepareWslDependency(cwd,repository('momentory','be').setup[0]),/Gradle build inputs or wrapper changed/);
  fs.writeFileSync(file,original);
  fs.mkdirSync(buildSrc);fs.writeFileSync(injected,'println "untrusted"\n');
  await assert.rejects(prepareWslDependency(cwd,repository('momentory','be').setup[0]),/Gradle build inputs or wrapper changed/);
  fs.rmSync(injected);fs.rmdirSync(buildSrc);
  fs.mkdirSync(initDir,{recursive:true});fs.writeFileSync(init,'println "untrusted"\n');
  await assert.rejects(prepareWslDependency(cwd,repository('momentory','be').setup[0]),/Unreviewed Gradle user-home script or properties/);
  fs.rmSync(init);
  fs.writeFileSync(properties,'systemProp.http.proxyHost=untrusted.example\n');
  await assert.rejects(prepareWslDependency(cwd,repository('momentory','be').setup[0]),/Unreviewed Gradle user-home script or properties/);
  fs.rmSync(properties);
  fs.appendFileSync(source,'\n# changed source before dependency retry\n');fs.writeFileSync(marker,JSON.stringify({digest:'invalid'}));
  await assert.rejects(prepareWslDependency(cwd,repository('momentory','be').setup[0]),/Existing Gradle cache cannot enter a network-enabled setup/);
  console.log(JSON.stringify({status:'PASS',modifiedGradleManifestDenied:true,buildSrcInjectionDenied:true,initScriptDenied:true,userPropertiesDenied:true,dirtyRetryDenied:true}));
}finally{fs.writeFileSync(file,original);fs.writeFileSync(source,originalSource);fs.writeFileSync(marker,originalMarker);if(fs.existsSync(injected))fs.rmSync(injected);if(fs.existsSync(buildSrc))fs.rmdirSync(buildSrc);if(fs.existsSync(init))fs.rmSync(init);if(fs.existsSync(properties))fs.rmSync(properties);}

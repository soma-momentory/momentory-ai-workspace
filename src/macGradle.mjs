import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {root} from './config.mjs';
import {trustedMacFile,trustedMacRuntime,validateMacWorktree} from './macTrust.mjs';
import {codexProfileName,verifyCodexProfile} from './codexProfile.mjs';
import {macChildEnv} from './provider.mjs';
import {sandboxRun} from './macDependency.mjs';

const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inside=(file,base)=>file===base||file.startsWith(base+path.sep);
const buildPaths=['gradlew','gradlew.bat','build.gradle','build.gradle.kts','settings.gradle','settings.gradle.kts','gradle.properties','gradle','buildSrc','build-logic'];
export function macToolTreeDigest(directory){
  const base=fs.realpathSync(directory),device=fs.statSync(base).dev,hash=createHash('sha256');
  if(base!==path.resolve(directory)||device!==fs.statSync(path.dirname(base)).dev)throw new Error('Untrusted macOS tool directory or mount');
  const files=fs.readdirSync(base,{recursive:true}).sort();
  if(files.length>20000)throw new Error('macOS tool tree exceeds limit');
  for(const relative of ['',...files]){
    const file=path.join(base,relative),stat=fs.lstatSync(file);
    if(stat.dev!==device||stat.isSymbolicLink()||!stat.isFile()&&!stat.isDirectory()||stat.uid!==0&&stat.uid!==process.getuid()||stat.mode&0o022)throw new Error('Untrusted macOS tool tree entry');
    hash.update(relative+'\0'+(stat.mode&0o777)+'\0');if(stat.isFile())hash.update(sha(file));
  }
  return hash.digest('hex');
}
function reviewedGradle(cwd){
  if(process.platform!=='darwin')throw new Error('macOS Gradle requires macOS');
  validateMacWorktree(cwd);
  if(!process.env.WORKSPACE_MAC_GRADLE_POLICY)throw new Error('Trusted macOS Gradle preparation is blocked: reviewed policy not configured');
  const policyFile=trustedMacFile('gradlePolicy',cwd),policy=JSON.parse(fs.readFileSync(policyFile,'utf8'));
  const java=trustedMacFile('java',cwd),runtime=trustedMacRuntime(cwd);
  const gradle=trustedMacFile('gradle',cwd);
  if(gradle!==path.join(policy.gradle.home,'bin','gradle'))throw new Error('Untrusted macOS Gradle executable');
  if(policy.version!==1||policy.jdk.major!==21||java!==path.join(policy.jdk.home,'bin','java')||!/^9\.1\.0$/.test(policy.gradle.version)||!Array.isArray(policy.artifacts)||!policy.inputs)throw new Error('Unsupported macOS Gradle policy');
  for(const bundle of [policy.jdk,policy.gradle]){
    if(!path.isAbsolute(bundle.home)||!path.isAbsolute(bundle.archive)||fs.realpathSync(bundle.archive)!==bundle.archive||inside(bundle.home,path.resolve(cwd))||inside(bundle.home,root)||sha(bundle.archive)!==bundle.sha256||macToolTreeDigest(bundle.home)!==bundle.treeSha256)throw new Error('macOS Gradle/JDK archive or installed tree checksum changed');
  }
  if(!/^https:\/\/github\.com\/adoptium\/temurin21-binaries\/releases\/download\//.test(policy.jdk.source)||policy.gradle.source!==`https://services.gradle.org/distributions/gradle-${policy.gradle.version}-bin.zip`)throw new Error('Unapproved JDK or Gradle source');
  const git=args=>{
    const result=spawnSync('/usr/bin/git',['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null',...args],{cwd,env:macChildEnv('/usr/bin:/bin',{GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'}),encoding:'utf8',timeout:10000});
    if(result.status!==0)throw new Error('Gradle input review failed');return result.stdout;
  };
  if(git(['status','--porcelain','--untracked-files=all','--',...buildPaths]).trim()||git(['ls-files','--others','--ignored','--exclude-standard','--',...buildPaths]).trim())throw new Error('Gradle build inputs changed or contain unreviewed scripts');
  const inputs=git(['ls-files','-z','--',...buildPaths]).split('\0').filter(Boolean).sort();
  if(JSON.stringify(inputs)!==JSON.stringify(Object.keys(policy.inputs).sort()))throw new Error('Gradle build input inventory differs from reviewed policy');
  for(const file of inputs){const location=path.join(cwd,file);if(fs.realpathSync(location)!==location||sha(location)!==policy.inputs[file])throw new Error('Gradle build input checksum changed');}
  const properties=fs.readFileSync(path.join(cwd,'gradle/wrapper/gradle-wrapper.properties'),'utf8').replaceAll('\\:',':');
  if(!properties.split(/\r?\n/).includes(`distributionUrl=${policy.gradle.source}`)||!properties.split(/\r?\n/).includes(`distributionSha256Sum=${policy.gradle.sha256}`)||sha(path.join(cwd,'gradle/wrapper/gradle-wrapper.jar'))!==policy.gradle.wrapperSha256)throw new Error('Gradle Wrapper source or SHA-256 is not approved');
  const home=path.join(cwd,'.gradle','workspace-home');
  if(fs.existsSync(path.join(home,'init.gradle'))||fs.existsSync(path.join(home,'gradle.properties'))||fs.existsSync(path.join(home,'init.d'))&&fs.readdirSync(path.join(home,'init.d')).length)throw new Error('Unreviewed Gradle user-home configuration');
  const repo=policy.repository;
  if(!path.isAbsolute(repo)||fs.realpathSync(repo)!==repo||inside(repo,cwd)||inside(repo,root)||fs.statSync(repo).mode&0o022)throw new Error('Untrusted macOS Gradle artifact repository');
  for(let part=repo;;part=path.dirname(part)){
    const stat=fs.lstatSync(part);
    if(stat.isSymbolicLink()||stat.uid!==0&&stat.uid!==process.getuid()||stat.mode&0o022)throw new Error('Untrusted macOS Gradle repository permissions');
    if(part===path.dirname(part))break;
  }
  validateMacWorktree(repo);
  const expected=new Set();
  for(const artifact of policy.artifacts){
    if(!/^[A-Za-z0-9_.+/-]+$/.test(artifact.path)||artifact.path.split('/').includes('..')||artifact.path.startsWith('/')||!/^[a-f0-9]{64}$/.test(artifact.sha256)||artifact.url!==`https://repo.maven.apache.org/maven2/${artifact.path}`)throw new Error('Unapproved Gradle artifact source');
    expected.add(artifact.path);
  }
  for(const file of fs.readdirSync(repo,{recursive:true}))if(fs.lstatSync(path.join(repo,file)).isFile()&&!expected.has(file))throw new Error('Unreviewed Gradle artifact exists');
  return {policy,java,runtime,home,repo,digest:sha(policyFile)};
}
async function ensureArtifacts(config,signal,download=true){
  for(const artifact of config.policy.artifacts){
    if(signal?.aborted)throw new Error('Cancelled before Gradle download');
    const file=path.join(config.repo,artifact.path);
    if(!fs.existsSync(file)){
      if(!download)throw new Error('Approved offline Gradle artifact is missing');
      fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
      const response=await fetch(artifact.url,{redirect:'error',headers:{'Accept-Encoding':'identity'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
      if(response.status!==200)throw new Error('Approved Gradle artifact download failed');
      const chunks=[];let length=0;
      for await(const chunk of response.body){length+=chunk.length;if(length>50*1024*1024)throw new Error('Gradle artifact exceeds download limit');chunks.push(chunk);}
      const data=Buffer.concat(chunks);
      if(createHash('sha256').update(data).digest('hex')!==artifact.sha256)throw new Error('Gradle artifact download checksum mismatch');
      const temporary=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(temporary,data,{flag:'wx',mode:0o600});fs.renameSync(temporary,file);
    }
    if(fs.realpathSync(file)!==file||fs.statSync(file).dev!==fs.statSync(config.repo).dev||sha(file)!==artifact.sha256)throw new Error('Gradle artifact checksum or path changed');
  }
}
const marker=cwd=>path.join(root,'data','check-deps',createHash('sha256').update(path.resolve(cwd)+'|mac-gradle').digest('hex')+'.json');
export async function verifyMacGradleMaterials(cwd,signal){
  const config=reviewedGradle(cwd);await ensureArtifacts(config,signal,false);
  return {ok:true,policySha256:config.digest,jdkSha256:config.policy.jdk.sha256,gradleSha256:config.policy.gradle.sha256,wrapperSha256:config.policy.gradle.wrapperSha256,verifiedArtifacts:config.policy.artifacts.length};
}
async function invoke(cwd,args,config,signal,timeoutMs=900000){
  verifyCodexProfile('posix-gradle');
  const quote=s=>"'"+s.replaceAll('\\','\\\\').replaceAll("'","\\'")+"'";
  const init=path.join(cwd,'.gradle','workspace-repositories.init.gradle');
  const content=`def localRepo = new File(${quote(config.repo)}).toURI()\ngradle.beforeSettings { settings -> settings.pluginManagement.repositories { clear(); maven { url = localRepo } } }\ngradle.projectsEvaluated { gradle.rootProject.allprojects { project -> project.repositories { clear(); maven { url = localRepo } }; project.buildscript.repositories { clear(); maven { url = localRepo } } } }\n`;
  fs.mkdirSync(config.home,{recursive:true});fs.writeFileSync(init,content,{mode:0o600});
  const environment=macChildEnv(config.runtime.path,{JAVA_HOME:config.policy.jdk.home,GRADLE_USER_HOME:config.home,JAVA_TOOL_OPTIONS:'',JDK_JAVA_OPTIONS:'',_JAVA_OPTIONS:'',GRADLE_OPTS:'',JAVA_OPTS:'',GRADLE_RO_DEP_CACHE:''});
  const command=[path.join(config.policy.gradle.home,'bin','gradle'),...args,'--offline','--no-daemon','--max-workers=2','-Dorg.gradle.jvmargs=','--init-script',init];
  return sandboxRun(cwd,config.runtime.codex,['sandbox','-p',codexProfileName('posix-gradle'),'-P','workspace-gradle','-C',cwd,'--',...command],environment,signal,timeoutMs);
}
export async function prepareMacGradle(cwd,step,signal){
  if(step?.ifMissing!=='.gradle/workspace-home'||JSON.stringify(step.command)!==JSON.stringify(['./gradlew','dependencies','--configuration','testRuntimeClasspath','--no-daemon']))throw new Error('Only reviewed Gradle dependency preparation is allowed');
  const config=reviewedGradle(cwd),file=marker(cwd);
  await ensureArtifacts(config,signal);
  if(fs.existsSync(file)){
    const previous=JSON.parse(fs.readFileSync(file));if(previous.digest===config.digest&&previous.platform==='darwin'&&fs.existsSync(config.home))return {ok:true,output:'Previously prepared reviewed macOS Gradle dependencies'};
    throw new Error('Unverified macOS Gradle approval marker');
  }
  if(fs.existsSync(config.home))throw new Error('Unreviewed macOS Gradle cache exists; use a fresh worktree');
  const result=await invoke(cwd,['dependencies','--configuration','testRuntimeClasspath'],config,signal);
  if(result.ok){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({digest:config.digest,platform:'darwin'}),{flag:'wx',mode:0o600});}
  return result;
}
export async function runMacGradleCheck(cwd,args,timeoutMs,signal){
  if(JSON.stringify(args)!==JSON.stringify(['test']))throw new Error('Only reviewed offline macOS Gradle test checks are allowed');
  const config=reviewedGradle(cwd);await ensureArtifacts(config,signal,false);
  const previous=fs.existsSync(marker(cwd))?JSON.parse(fs.readFileSync(marker(cwd))):null;
  if(previous?.digest!==config.digest||previous.platform!=='darwin'||!fs.existsSync(config.home))throw new Error('macOS Gradle preparation is not approved');
  return invoke(cwd,['test','--rerun-tasks'],config,signal,timeoutMs);
}

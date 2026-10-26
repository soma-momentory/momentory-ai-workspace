import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {root} from './config.mjs';
import {trustedMacFile,trustedMacRuntime,validateMacWorktree} from './macTrust.mjs';
import {macChildEnv,registerMacGradleContainer,activeMacProcessesForWorktree} from './provider.mjs';
import {sandboxRun} from './macDependency.mjs';
import {macGradleContainer} from './macGradleContainer.mjs';

const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inside=(file,base)=>file===base||file.startsWith(base+path.sep);
const buildPaths=['gradlew','gradlew.bat','build.gradle','build.gradle.kts','settings.gradle','settings.gradle.kts','gradle.properties','gradle','buildSrc','build-logic'];
export function macGradleVerificationMetadata(artifacts){
  const components=new Map();
  for(const item of artifacts){
    const parts=item.path.split('/'),name=parts.pop(),version=parts.pop(),module=parts.pop(),group=parts.join('.');
    if(!parts.length||![...parts,name,version,module].every(value=>/^[A-Za-z0-9_.+-]+$/.test(value))||!/^[a-f0-9]{64}$/.test(item.sha256))throw new Error('Invalid Gradle verification artifact');
    const key=`${group}:${module}:${version}`;
    if(!components.has(key))components.set(key,{group,module,version,artifacts:[]});
    components.get(key).artifacts.push(`         <artifact name="${name}"><sha256 value="${item.sha256}" origin="Reviewed pinned artifact inventory"/></artifact>`);
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<verification-metadata xmlns="https://schema.gradle.org/dependency-verification">\n   <configuration><verify-metadata>true</verify-metadata><verify-signatures>false</verify-signatures></configuration>\n   <components>\n'+[...components.values()].sort((a,b)=>`${a.group}:${a.module}:${a.version}`.localeCompare(`${b.group}:${b.module}:${b.version}`)).map(item=>`      <component group="${item.group}" name="${item.module}" version="${item.version}">\n${item.artifacts.sort().join('\n')}\n      </component>`).join('\n')+'\n   </components>\n</verification-metadata>\n';
}
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
function reviewedGradle(cwd,{reviewOnly=false}={}){
  if(process.platform!=='darwin')throw new Error('macOS Gradle requires macOS');
  validateMacWorktree(cwd);
  if(!process.env.WORKSPACE_MAC_GRADLE_POLICY)throw new Error('Trusted macOS Gradle preparation is blocked: reviewed policy not configured');
  const policyFile=trustedMacFile('gradlePolicy',cwd),policy=JSON.parse(fs.readFileSync(policyFile,'utf8'));
  if(Boolean(policy.reviewOnly)!==reviewOnly)throw new Error('Unapproved Gradle review proposal cannot authorize setup or checks');
  const java=trustedMacFile('java',cwd),runtime=trustedMacRuntime(cwd);
  const gradle=trustedMacFile('gradle',cwd);
  if(gradle!==path.join(policy.gradle.home,'bin','gradle'))throw new Error('Untrusted macOS Gradle executable');
  if(![1,2].includes(policy.version)||policy.jdk.major!==21||java!==path.join(policy.jdk.home,'bin','java')||!/^9\.1\.0$/.test(policy.gradle.version)||!Array.isArray(policy.artifacts)||!policy.inputs)throw new Error('Unsupported macOS Gradle policy');
  for(const bundle of [policy.jdk,policy.gradle,...(policy.version===2?[policy.linuxJdk]:[])]){
    if(!bundle)throw new Error('Reviewed Linux JDK is not configured');
    if(!path.isAbsolute(bundle.home)||!path.isAbsolute(bundle.archive)||fs.realpathSync(bundle.archive)!==bundle.archive||inside(bundle.home,path.resolve(cwd))||inside(bundle.home,root)||sha(bundle.archive)!==bundle.sha256||macToolTreeDigest(bundle.home)!==bundle.treeSha256)throw new Error('macOS Gradle/JDK archive or installed tree checksum changed');
  }
  if(!/^https:\/\/github\.com\/adoptium\/temurin21-binaries\/releases\/download\//.test(policy.jdk.source)||policy.gradle.source!==`https://services.gradle.org/distributions/gradle-${policy.gradle.version}-bin.zip`)throw new Error('Unapproved JDK or Gradle source');
  if(policy.version===2&&policy.linuxJdk.source!=='https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jdk_aarch64_linux_hotspot_21.0.13_9.tar.gz')throw new Error('Unapproved isolated JDK source');
  const git=args=>{
    const result=spawnSync('/usr/bin/git',['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null',...args],{cwd,env:macChildEnv('/usr/bin:/bin',{GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null'}),encoding:'utf8',timeout:10000});
    if(result.status!==0)throw new Error('Gradle input review failed');return result.stdout;
  };
  if(git(['status','--porcelain','--untracked-files=all','--',...buildPaths]).trim()||git(['ls-files','--others','--ignored','--exclude-standard','--',...buildPaths]).trim())throw new Error('Gradle build inputs changed or contain unreviewed scripts');
  const inputs=git(['ls-files','-z','--',...buildPaths]).split('\0').filter(Boolean).sort();
  if(JSON.stringify(inputs)!==JSON.stringify(Object.keys(policy.inputs).sort()))throw new Error('Gradle build input inventory differs from reviewed policy');
  for(const file of inputs){const location=path.join(cwd,file);if(fs.realpathSync(location)!==location||sha(location)!==policy.inputs[file])throw new Error('Gradle build input checksum changed');}
  if(policy.version===2&&!reviewOnly){
    const verification='gradle/verification-metadata.xml';
    if(!/^[a-f0-9]{64}$/.test(policy.verificationMetadataSha256||'')||policy.inputs[verification]!==policy.verificationMetadataSha256||fs.readFileSync(path.join(cwd,verification),'utf8')!==macGradleVerificationMetadata(policy.artifacts))throw new Error('Gradle verification metadata is not bound to the reviewed artifact inventory');
  }
  if(reviewOnly&&fs.existsSync(path.join(cwd,'gradle/verification-metadata.xml')))throw new Error('Metadata review requires a separate candidate without existing verification approvals');
  const properties=fs.readFileSync(path.join(cwd,'gradle/wrapper/gradle-wrapper.properties'),'utf8').replaceAll('\\:',':');
  if(!properties.split(/\r?\n/).includes(`distributionUrl=${policy.gradle.source}`)||!properties.split(/\r?\n/).includes(`distributionSha256Sum=${policy.gradle.sha256}`)||sha(path.join(cwd,'gradle/wrapper/gradle-wrapper.jar'))!==policy.gradle.wrapperSha256)throw new Error('Gradle Wrapper source or SHA-256 is not approved');
  const home=path.join(cwd,'.gradle','workspace-home');
  if(['init.gradle','init.gradle.kts','gradle.properties'].some(file=>fs.existsSync(path.join(home,file)))||fs.existsSync(path.join(home,'init.d'))&&fs.readdirSync(path.join(home,'init.d')).length)throw new Error('Unreviewed Gradle user-home configuration');
  if(policy.version===2&&fs.existsSync(home)&&fs.readdirSync(home).length)throw new Error('Unreviewed macOS Gradle cache cannot be reused');
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
    if(!/^[A-Za-z0-9_.+/-]+$/.test(artifact.path)||artifact.path.split('/').includes('..')||artifact.path.startsWith('/')||!/^[a-f0-9]{64}$/.test(artifact.sha256)||![`https://repo.maven.apache.org/maven2/${artifact.path}`,`https://plugins.gradle.org/m2/${artifact.path}`].includes(artifact.url))throw new Error('Unapproved Gradle artifact source');
    if(expected.has(artifact.path))throw new Error('Duplicate Gradle artifact approval');expected.add(artifact.path);
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
      fs.mkdirSync(path.dirname(file),{recursive:true,mode:config.policy.version===2?0o755:0o700});
      const response=await fetch(artifact.url,{redirect:'error',headers:{'Accept-Encoding':'identity'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
      if(response.status!==200)throw new Error('Approved Gradle artifact download failed');
      const chunks=[];let length=0;
      for await(const chunk of response.body){length+=chunk.length;if(length>50*1024*1024)throw new Error('Gradle artifact exceeds download limit');chunks.push(chunk);}
      const data=Buffer.concat(chunks);
      if(createHash('sha256').update(data).digest('hex')!==artifact.sha256)throw new Error('Gradle artifact download checksum mismatch');
      const temporary=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(temporary,data,{flag:'wx',mode:config.policy.version===2?0o644:0o600});fs.renameSync(temporary,file);
    }
    if(fs.realpathSync(file)!==file||fs.statSync(file).dev!==fs.statSync(config.repo).dev||sha(file)!==artifact.sha256)throw new Error('Gradle artifact checksum or path changed');
  }
}
const marker=cwd=>path.join(root,'data','check-deps',createHash('sha256').update(path.resolve(cwd)+'|mac-gradle').digest('hex')+'.json');
export async function verifyMacGradleMaterials(cwd,signal){
  const config=reviewedGradle(cwd);await ensureArtifacts(config,signal,false);
  return {ok:true,policySha256:config.digest,jdkSha256:config.policy.jdk.sha256,gradleSha256:config.policy.gradle.sha256,wrapperSha256:config.policy.gradle.wrapperSha256,verifiedArtifacts:config.policy.artifacts.length};
}
async function invoke(cwd,args,config,signal,timeoutMs=900000,{reviewOnly=false}={}){
  if(config.policy.version!==2)throw new Error('macOS Gradle execution is blocked: reviewed v2 isolation and dependency metadata required');
  if(activeMacProcessesForWorktree(cwd).length)throw new Error('Active or unreaped macOS process blocks Gradle execution');
  const runRoot=path.join(root,'data','gradle-runs');fs.mkdirSync(runRoot,{recursive:true,mode:0o700});
  if(fs.realpathSync(runRoot)!==runRoot||fs.statSync(runRoot).uid!==process.getuid()||fs.statSync(runRoot).mode&0o077)throw new Error('Untrusted Gradle control root');
  const temporary=path.join(runRoot,`momentory-gradle-${randomUUID()}`);fs.mkdirSync(temporary,{mode:0o700});
  const init=path.join(temporary,'repositories.init.gradle');
  const content=`def localRepo = new File('/trusted/maven').toURI()
gradle.beforeSettings { settings -> settings.pluginManagement.repositories { clear(); maven { url = localRepo } } }
gradle.beforeProject { project -> project.layout.buildDirectory.set(new File('/tmp/gradle-builds', project.path.replace(':', '_'))) }
gradle.projectsEvaluated {
  gradle.rootProject.allprojects { project ->
    project.layout.buildDirectory.set(new File('/tmp/gradle-builds', project.path.replace(':', '_')))
    project.repositories { clear(); maven { url = localRepo } }
    project.buildscript.repositories { clear(); maven { url = localRepo } }
    ['compileClasspath','testCompileClasspath','testRuntimeClasspath'].each { name ->
      def configuration = project.configurations.findByName(name)
      if (configuration != null && configuration.canBeResolved) configuration.files.each { artifact -> if (!artifact.isFile()) throw new GradleException('Missing reviewed dependency') }
    }
    project.tasks.withType(org.gradle.api.tasks.testing.Test).configureEach {
      afterSuite { descriptor, result -> if (descriptor.parent == null) println('WORKSPACE_TEST_COUNTS tests=' + result.testCount + ' failed=' + result.failedTestCount + ' skipped=' + result.skippedTestCount) }
    }
  }
}
`;
  fs.writeFileSync(init,content,{mode:0o644});let scope;
  try{
    const container=macGradleContainer(cwd,config.policy,temporary,init,args,timeoutMs,{reviewOnly});
    scope=registerMacGradleContainer(cwd,container.value);
    const isolation=container.create();
    const result=await sandboxRun(cwd,container.runtime.binary,container.startArgs,container.runtime.environment,signal,timeoutMs,{outputLimit:reviewOnly?2000000:12000});
    // The source, tool bundles and repository must still match before issuing any approval.
    reviewedGradle(cwd,{reviewOnly});await ensureArtifacts(config,signal,false);
    return {...result,isolation};
  }finally{
    if(scope)scope.finish();
    for(const [name,mode] of [['denied-file',0o600],['denied-directory',0o700]])if(fs.existsSync(path.join(temporary,name)))fs.chmodSync(path.join(temporary,name),mode);
    fs.rmSync(temporary,{recursive:true,force:true});
  }
}
export async function reviewMacGradleMetadata(cwd,signal,{phase='metadata'}={}){
  // Discovery executes unapproved cached bytes only inside the same networkless
  // VM container. Its draft is never a dependency approval or a check result.
  if(!['metadata','check'].includes(phase))throw new Error('Unsupported Gradle review phase');
  const config=reviewedGradle(cwd,{reviewOnly:true});await ensureArtifacts(config,signal,false);
  const tasks=phase==='check'?['clean','check']:['dependencies','--configuration','testRuntimeClasspath'];
  const result=await invoke(cwd,[...tasks,'--write-verification-metadata','sha256'],config,signal,300000,{reviewOnly:true});
  const metadata=/WORKSPACE_REVIEW_METADATA_BEGIN\n([\s\S]*?)\nWORKSPACE_REVIEW_METADATA_END/.exec(result.output)?.[1]||null;
  const testReports=/WORKSPACE_REVIEW_TESTS_BEGIN\n([\s\S]*?)\nWORKSPACE_REVIEW_TESTS_END/.exec(result.output)?.[1]||null;
  return {status:'PENDING_REVIEW',phase,resolutionCompleted:result.ok,metadata,testReports,execution:result,approvalIssued:false};
}
export async function prepareMacGradle(cwd,step,signal){
  if(step?.ifMissing!=='.gradle/workspace-home'||JSON.stringify(step.command)!==JSON.stringify(['./gradlew','dependencies','--configuration','testRuntimeClasspath','--no-daemon']))throw new Error('Only reviewed Gradle dependency preparation is allowed');
  const config=reviewedGradle(cwd),file=marker(cwd);
  if(config.policy.version!==2)throw new Error('macOS Gradle preparation is blocked: reviewed v2 isolation and dependency metadata required');
  await ensureArtifacts(config,signal);
  if(fs.existsSync(file)){
    const previous=JSON.parse(fs.readFileSync(file));if(previous.version===2&&previous.digest===config.digest&&previous.platform==='darwin'&&previous.isolation==='colima-network-none')return {ok:true,output:'Previously prepared reviewed macOS Gradle materials; runtime caches are always fresh'};
    throw new Error('Unverified macOS Gradle approval marker');
  }
  if(fs.existsSync(config.home))throw new Error('Unreviewed macOS Gradle cache exists; use a fresh worktree');
  const result=await invoke(cwd,['dependencies','--configuration','testRuntimeClasspath'],config,signal);
  if(result.ok){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({version:2,digest:config.digest,platform:'darwin',isolation:'colima-network-none'}),{flag:'wx',mode:0o600});}
  return result;
}
export async function runMacGradleCheck(cwd,args,timeoutMs,signal){
  if(![['test'],['clean','check']].some(allowed=>JSON.stringify(args)===JSON.stringify(allowed)))throw new Error('Only reviewed offline macOS Gradle test checks are allowed');
  const config=reviewedGradle(cwd);await ensureArtifacts(config,signal,false);
  const previous=fs.existsSync(marker(cwd))?JSON.parse(fs.readFileSync(marker(cwd))):null;
  if(previous?.version!==2||previous.digest!==config.digest||previous.platform!=='darwin'||previous.isolation!=='colima-network-none')throw new Error('macOS Gradle preparation is not approved');
  return invoke(cwd,[...args,'--rerun-tasks'],config,signal,timeoutMs);
}

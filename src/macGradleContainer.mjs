import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {root} from './config.mjs';
import {trustedMacFile} from './macTrust.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const environment={PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8'};
export function validMacGradleContainer(value){
  return value&&/^momentory-gradle-[0-9a-f-]{36}$/.test(value.name)&&path.isAbsolute(value.docker||'')&&/^[a-f0-9]{64}$/.test(value.sha256||'')&&value.socket===path.join(os.homedir(),'.colima/default/docker.sock');
}
function control(value,cwd){
  if(!validMacGradleContainer(value))throw new Error('Invalid macOS Gradle container checkpoint');
  const binary=trustedMacFile('docker',cwd,{WORKSPACE_MAC_DOCKER:value.docker,WORKSPACE_MAC_DOCKER_SHA256:value.sha256});
  const socket=fs.lstatSync(value.socket);
  if(!socket.isSocket()||socket.uid!==process.getuid()||socket.mode&0o077||fs.realpathSync(value.socket)!==value.socket)throw new Error('Untrusted Colima control socket');
  const directory=path.join(root,'data','docker-control');fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(directory);
  if(!stat.isDirectory()||stat.uid!==process.getuid()||stat.mode&0o077||fs.realpathSync(directory)!==directory)throw new Error('Untrusted Docker control configuration');
  const file=path.join(directory,'config.json');
  if(!fs.existsSync(file))fs.writeFileSync(file,'{}\n',{flag:'wx',mode:0o600});
  if(fs.lstatSync(file).isSymbolicLink()||fs.readFileSync(file,'utf8')!=='{}\n')throw new Error('Docker control must not load host credentials or helpers');
  return {binary,args:['--host',`unix://${value.socket}`,'--config',directory],environment};
}
function command(value,cwd,args){
  const runtime=control(value,cwd),result=spawnSync(runtime.binary,[...runtime.args,...args],{cwd,env:environment,encoding:'utf8',timeout:20000,maxBuffer:4*1024*1024});
  if(result.status!==0)throw new Error(`Isolated Gradle Docker control failed: ${(result.stderr||result.error?.message||'').slice(-1000)}`);
  return result.stdout.trim();
}
function labels(cwd,value){return {'momentory.workspace':digest(root),'momentory.worktree':digest(path.resolve(cwd)),'momentory.execution':value.name};}
function owned(value,cwd){
  const ids=command(value,cwd,['ps','--all','--no-trunc','--filter',`name=^/${value.name}$`,'--format','{{.ID}}']).split('\n').filter(Boolean);
  if(!ids.length)return null;
  if(ids.length!==1||!/^[a-f0-9]{64}$/.test(ids[0]))throw new Error('Ambiguous Gradle container identity');
  const item=JSON.parse(command(value,cwd,['inspect',ids[0]]))[0];
  if(item.Name!==`/${value.name}`||Object.entries(labels(cwd,value)).some(([key,expected])=>item.Config.Labels?.[key]!==expected))throw new Error('Gradle container ownership differs from checkpoint');
  return item;
}
export function cleanupMacGradleContainer(value,cwd){
  const item=owned(value,cwd);
  if(item)command(value,cwd,['rm','--force',item.Id]);
  if(owned(value,cwd))throw new Error('Gradle container cleanup incomplete');
  const directory=path.join(root,'data','gradle-runs',value.name);
  if(fs.existsSync(directory)){
    const stat=fs.lstatSync(directory);
    if(!stat.isDirectory()||stat.uid!==process.getuid()||stat.mode&0o077||fs.realpathSync(directory)!==directory||fs.readdirSync(directory).some(name=>!['repositories.init.gradle','source'].includes(name)))throw new Error('Gradle control directory needs local inspection');
    fs.rmSync(directory,{recursive:true});
  }
}
export function macGradleContainer(cwd,policy,temporary,init,args,timeoutMs,{reviewOnly=false}={}){
  const execution=policy.execution;
  if(execution?.type!=='colima-network-none'||!/^ubuntu@sha256:[a-f0-9]{64}$/.test(execution.image||'')||!/^sha256:[a-f0-9]{64}$/.test(execution.imageId||''))throw new Error('Reviewed isolated Gradle runtime is not configured');
  const value={name:path.basename(temporary),docker:execution.docker,sha256:execution.dockerSha256,socket:execution.socket};
  const runtime=control(value,cwd),info=JSON.parse(command(value,cwd,['info','--format','{{json .}}']));
  if(info.OSType!=='linux'||info.Architecture!=='aarch64'||!info.SecurityOptions?.some(value=>value.startsWith('name=seccomp'))||!info.SecurityOptions.includes('name=apparmor'))throw new Error('Unsupported isolated Gradle daemon security boundary');
  const image=JSON.parse(command(value,cwd,['image','inspect',execution.image]))[0];
  if(image.Id!==execution.imageId||image.Os!=='linux'||image.Architecture!=='arm64'||!image.RepoDigests.includes(execution.image)||Object.keys(image.Config.Volumes||{}).length)throw new Error('Gradle base image differs from reviewed digest');
  const source=path.join(temporary,'source'),device=fs.statSync(cwd).dev;let count=0,bytes=0;
  // Gradle requires a writable project. Copy only non-secret source into a private
  // snapshot, mount that read-only, then build its disposable in-container copy.
  fs.cpSync(cwd,source,{recursive:true,filter:file=>{
    const relative=path.relative(cwd,file),name=path.basename(file);
    if(relative&&(/^\.env|\.(pem|key)$|^credentials\.json$/i.test(name)||['.git','.gradle','build','out','.codex','.claude','.agents','.aws','.ssh','.npmrc'].includes(name)))return false;
    const stat=fs.lstatSync(file);
    if(++count>500000||relative.split(path.sep).length>32||stat.dev!==device||stat.isSymbolicLink()||!stat.isFile()&&!stat.isDirectory())throw new Error('Unapproved Gradle source snapshot entry');
    if(stat.isFile()&&(stat.size>64*1024*1024||(bytes+=stat.size)>256*1024*1024))throw new Error('Gradle source snapshot byte limit exceeded');
    return true;
  }});
  for(const name of ['',...fs.readdirSync(source,{recursive:true})]){
    const file=path.join(source,name),stat=fs.lstatSync(file);
    fs.chmodSync(file,stat.isDirectory()||stat.mode&0o111?0o755:0o644);
  }
  const mounts=[[source,'/source'],[policy.linuxJdk.home,'/trusted/jdk'],[policy.gradle.home,'/trusted/gradle'],[policy.repository,'/trusted/maven'],[init,'/trusted/init.gradle']];
  if(mounts.length>256||mounts.some(pair=>pair.some(value=>/[,\n\r]/.test(value))))throw new Error('Unsupported isolated Gradle mount path');
  const create=['create','--pull=never','--name',value.name,'--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges=true','--security-opt=apparmor=docker-default','--user=65532:65532','--pids-limit=256','--memory=2g','--memory-swap=2g','--cpus=2','--ipc=private','--cgroupns=private','--init','--workdir=/work','--entrypoint=/bin/sh','--tmpfs','/tmp:rw,nosuid,nodev,size=1536m,mode=1777','--tmpfs','/work:rw,nosuid,nodev,size=512m,mode=1777'];
  for(const [key,label] of Object.entries(labels(cwd,value)))create.push('--label',`${key}=${label}`);
  for(const [source,target] of mounts)create.push('--mount',`type=bind,source=${source},target=${target},readonly,bind-propagation=rprivate,bind-recursive=disabled`);
  for(const value of ['HOME=/tmp/home','JAVA_HOME=/trusted/jdk','PATH=/trusted/jdk/bin:/usr/bin:/bin','GRADLE_USER_HOME=/tmp/gradle-user','LANG=C.UTF-8'])create.push('--env',value);
  const shell=reviewOnly?'cp -R /source/. /work/ && /usr/bin/timeout --signal=KILL "$@"; status=$?; if [ -f /work/gradle/verification-metadata.xml ]; then printf "\\nWORKSPACE_REVIEW_METADATA_BEGIN\\n"; head -c 1500000 /work/gradle/verification-metadata.xml; printf "\\nWORKSPACE_REVIEW_METADATA_END\\n"; fi; printf "\\nWORKSPACE_REVIEW_TESTS_BEGIN\\n"; find /tmp/gradle-builds -type f -name "TEST-*.xml" -exec grep -h -m 1 "<testsuite " {} \\; 2>/dev/null | head -c 200000; printf "\\nWORKSPACE_REVIEW_TESTS_END\\n"; exit "$status"':'cp -R /source/. /work/ && exec /usr/bin/timeout --signal=KILL "$@"';
  create.push(execution.image,'-c',shell,'gradle',String(Math.ceil(timeoutMs/1000)+5),'/trusted/gradle/bin/gradle',...args,'--offline','--no-daemon','--no-configuration-cache','--no-build-cache','--no-watch-fs','--max-workers=2','-Dorg.gradle.jvmargs=','--dependency-verification=strict','--project-cache-dir','/tmp/gradle-project','--init-script','/trusted/init.gradle');
  return {value,runtime,create:()=>{
    command(value,cwd,create);const item=owned(value,cwd),host=item?.HostConfig;
    if(!item||host.NetworkMode!=='none'||!host.ReadonlyRootfs||host.Privileged||item.Config.User!=='65532:65532'||host.PidMode||host.IpcMode!=='private'||host.CgroupnsMode!=='private'||item.AppArmorProfile!=='docker-default'||host.Memory!==2147483648||host.PidsLimit!==256||host.CapAdd?.length||!host.CapDrop?.includes('ALL')||!host.SecurityOpt?.includes('no-new-privileges=true')||host.PortBindings&&Object.keys(host.PortBindings).length||item.Mounts.some(mount=>mount.Type!=='bind'||mount.RW||!mounts.some(([source,target])=>source===mount.Source&&target===mount.Destination)))throw new Error('Gradle container isolation differs from reviewed launch');
    return {id:item.Id,network:host.NetworkMode,user:item.Config.User,readOnly:true,capabilities:host.CapDrop,security:host.SecurityOpt,mounts:item.Mounts.map(({Source,Destination,RW})=>({source:Source,target:Destination,writable:RW}))};
  },startArgs:[...runtime.args,'start','--attach',value.name]};
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {root} from './config.mjs';
import {trustedMacFile} from './macTrust.mjs';

export const codexProfileName=mode=>mode==='posix-gradle'?'ai-dev-workspace-posix-gradle':mode==='check'?'ai-dev-workspace-check':mode==='wsl'?'ai-dev-workspace-wsl':mode==='wsl-generic'?'ai-dev-workspace-wsl-generic':mode==='wsl-design'?'ai-dev-workspace-wsl-design':mode==='wsl-both'?'ai-dev-workspace-wsl-both':mode==='wsl-check'?'ai-dev-workspace-wsl-check':mode==='wsl-check-generic'?'ai-dev-workspace-wsl-check-generic':mode==='wsl-check-design'?'ai-dev-workspace-wsl-check-design':mode==='wsl-check-both'?'ai-dev-workspace-wsl-check-both':mode==='wsl-readonly'?'ai-dev-workspace-wsl-readonly':mode==='wsl-setup'?'ai-dev-workspace-wsl-setup':mode==='wsl-lab'?'ai-dev-workspace-wsl-lab':mode==='posix'?'ai-dev-workspace-posix':mode==='posix-readonly'?'ai-dev-workspace-posix-readonly':mode==='posix-setup'?'ai-dev-workspace-posix-setup':mode==='posix-check'?'ai-dev-workspace-posix-check':mode==='posix-lab'?'ai-dev-workspace-posix-lab':mode===true?'ai-dev-workspace-readonly':'ai-dev-workspace-isolated';
const codexHome=()=>process.env.CODEX_HOME || path.join(os.homedir(),'.codex');
const locations=mode=>{
  const name=`${codexProfileName(mode)}.config.toml`;
  return {source:path.join(root,'profiles',name),target:path.join(codexHome(),name)};
};
const expectedProfile=(mode,source)=>{
  let content=fs.readFileSync(source,'utf8');
  content=content
    .replace('"__WORKSPACE_DATA__"',JSON.stringify(path.join(root,'data')))
    .replace('"__WORKSPACE_ENV__"',JSON.stringify(path.join(root,'.env')));
  if(['posix-setup','posix-check','posix-lab'].includes(mode)){
    const node=trustedMacFile('node',root),npm=trustedMacFile('npm',root);
    content=content.replace('"__MAC_NODE_DIR__"',JSON.stringify(path.dirname(node)))
      .replace('"__MAC_NPM_ROOT__"',JSON.stringify(path.dirname(path.dirname(npm))));
  }
  if(mode==='posix-gradle'){
    const policy=JSON.parse(fs.readFileSync(trustedMacFile('gradlePolicy',root),'utf8'));
    for(const [token,value] of [['__MAC_JDK_HOME__',policy.jdk.home],['__MAC_GRADLE_HOME__',policy.gradle.home],['__MAC_GRADLE_REPO__',policy.repository]]){
      if(!path.isAbsolute(value)||fs.realpathSync(value)!==value)throw new Error('Untrusted macOS Gradle runtime path');
      content=content.replace(JSON.stringify(token),JSON.stringify(value));
    }
  }
  const insideHome=!path.relative(os.homedir(),root).startsWith('..')&&!path.isAbsolute(path.relative(os.homedir(),root));
  if(insideHome) content=content.replace('"~" = "deny"\n','');
  return Buffer.from(content);
};
export function installCodexProfiles() {
  fs.mkdirSync(codexHome(),{recursive:true});
  if(process.platform==='darwin')for(const name of ['node','npm','codex','claude'])trustedMacFile(name,root);
  for(const mode of [false,true,'check','wsl','wsl-generic','wsl-design','wsl-both','wsl-check','wsl-check-generic','wsl-check-design','wsl-check-both','wsl-readonly','wsl-setup','wsl-lab','posix','posix-readonly',...(process.platform==='darwin'?['posix-setup','posix-check','posix-lab',...(process.env.WORKSPACE_MAC_GRADLE_POLICY?['posix-gradle']:[])]:[])]) {
    const {source,target}=locations(mode),expected=expectedProfile(mode,source);
    if(fs.existsSync(target)) {
      const current=fs.readFileSync(target);
      if(!current.equals(expected)) {
        const beforeData=Buffer.from(expected.toString().replace('"data" = "deny"\n',''));
        const beforeDns=Buffer.from(expected.toString().replace('"/etc/resolv.conf" = "read"\n','').replace('"/mnt/wsl/resolv.conf" = "read"\n',''));
        const beforeBoth=Buffer.from(beforeDns.toString().replace('"data" = "deny"\n',''));
        const beforeEtc=Buffer.from(expected.toString().replace('"/etc" = "read"\n','"/etc/resolv.conf" = "read"\n'));
        const beforeReadonlyDeps=Buffer.from(expected.toString().replace('"node_modules" = "read"\n','').replace('"expo-lab/node_modules" = "read"\n',''));
        const withInvalidNodePattern=Buffer.from(expected.toString().replace('"node_modules" = "read"\n"expo-lab/node_modules" = "read"\n','"**/node_modules/**" = "read"\n'));
        const beforeReadonlyBuild=Buffer.from(expected.toString().replace('".gradle" = "read"\n','').replace('"build" = "read"\n','').replace('"out" = "read"\n',''));
        if((mode==='posix'||mode==='posix-readonly')&&current.equals(beforeReadonlyBuild)){fs.writeFileSync(target,expected);continue;}
        const beforeGradleCache=Buffer.from(expected.toString().replace('".gradle/workspace-home/caches/modules-2/files-2.1" = "read"\n','').replace('".gradle/workspace-setup.init.gradle" = "read"\n',''));
        const withReadonlyGradleHome=Buffer.from(expected.toString().replace('".gradle/workspace-home/caches/modules-2/files-2.1" = "read"\n','".gradle/workspace-home" = "read"\n'));
        const beforeReadonlyWrapper=Buffer.from(expected.toString().replace('".gradle/workspace-home/wrapper/dists" = "read"\n',''));
        const beforeDeepGlob=Buffer.from(expected.toString().replace('glob_scan_max_depth = 32','glob_scan_max_depth = 8'));
        const beforeLoopback=Buffer.from(expected.toString().replace('enabled = true\n','enabled = false\n'));
        const prior=Buffer.from(beforeData.toString().replace('"~/.local/node_modules/node" = "read"\n',''));
        if(current.equals(beforeDeepGlob)||((mode==='posix'||mode==='posix-readonly')&&current.equals(beforeReadonlyDeps))||((mode==='wsl'||mode==='wsl-readonly'||mode==='wsl-setup')&&(current.equals(prior)||current.equals(beforeData)||current.equals(beforeDns)||current.equals(beforeBoth)||current.equals(beforeEtc)||current.equals(beforeReadonlyDeps)||current.equals(withInvalidNodePattern)||current.equals(beforeReadonlyBuild)))||(mode==='wsl-check'&&current.equals(beforeLoopback))||(mode==='wsl-check-generic'&&(current.equals(beforeGradleCache)||current.equals(withReadonlyGradleHome)||current.equals(beforeReadonlyWrapper))))fs.writeFileSync(target,expected);
        else throw new Error(`Codex profile differs from audited template: ${target}`);
      }
      continue;
    }
    fs.writeFileSync(target,expected,{flag:'wx',mode:0o600});
  }
}
export function verifyCodexProfile(mode) {
  const {source,target}=locations(mode);
  if(!fs.existsSync(target)||!fs.readFileSync(target).equals(expectedProfile(mode,source)))
    throw new Error(`Codex isolation profile missing or changed. Run npm run isolation:setup: ${target}`);
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {root} from './config.mjs';

export const codexProfileName=mode=>mode==='check'?'ai-dev-workspace-check':mode===true?'ai-dev-workspace-readonly':'ai-dev-workspace-isolated';
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
  const insideHome=!path.relative(os.homedir(),root).startsWith('..')&&!path.isAbsolute(path.relative(os.homedir(),root));
  if(insideHome) content=content.replace('"~" = "deny"\n','');
  return Buffer.from(content);
};
export function installCodexProfiles() {
  fs.mkdirSync(codexHome(),{recursive:true});
  for(const mode of [false,true,'check']) {
    const {source,target}=locations(mode),expected=expectedProfile(mode,source);
    if(fs.existsSync(target)) {
      if(!fs.readFileSync(target).equals(expected)) throw new Error(`Codex profile differs from audited template: ${target}`);
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

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {root} from './config.mjs';

const names={node:'NODE',npm:'NPM_CLI',codex:'CODEX',claude:'CLAUDE'};
const within=(file,base)=>file===base||file.startsWith(base+path.sep);

export function trustedMacFile(name,cwd,environment=process.env){
  if(!Object.hasOwn(names,name))throw new Error('Unknown macOS executable');
  const label=names[name],file=environment[`WORKSPACE_MAC_${label}`],sha=environment[`WORKSPACE_MAC_${label}_SHA256`];
  if(!file||!path.isAbsolute(file)||!/^[a-f0-9]{64}$/i.test(sha||''))throw new Error(`WORKSPACE_MAC_${label} and its SHA256 must be configured`);
  const resolved=path.resolve(file),task=fs.realpathSync(cwd),workspace=fs.realpathSync(root);
  if(fs.realpathSync(resolved)!==resolved||within(resolved,task)||within(resolved,workspace))throw new Error(`Untrusted macOS ${name} path or symbolic link`);
  const uid=process.getuid();
  for(let part=resolved;;part=path.dirname(part)){
    const stat=fs.lstatSync(part);
    if(stat.isSymbolicLink()||stat.uid!==0&&stat.uid!==uid||stat.mode&0o022)throw new Error(`Untrusted macOS ${name} ownership or permissions`);
    if(part===path.dirname(part))break;
  }
  const stat=fs.statSync(resolved);
  if(!stat.isFile())throw new Error(`Untrusted macOS ${name} file type`);
  if(name!=='npm')fs.accessSync(resolved,fs.constants.X_OK);
  const actual=createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
  if(actual!==sha.toLowerCase())throw new Error(`macOS ${name} executable checksum changed`);
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(name==='node'&&(fs.realpathSync(process.execPath)!==resolved||major!==22||minor<13))throw new Error('Workspace requires the pinned macOS Node 22.13+ runtime');
  return resolved;
}

export function trustedMacRuntime(cwd,environment=process.env){
  const node=trustedMacFile('node',cwd,environment);
  const codex=trustedMacFile('codex',cwd,environment);
  const configuredHome=path.resolve(environment.CODEX_HOME||path.join(os.homedir(),'.codex'));
  const realHome=fs.realpathSync(configuredHome),stat=fs.lstatSync(configuredHome);
  if(realHome!==configuredHome||stat.isSymbolicLink()||stat.uid!==process.getuid()||stat.mode&0o022||within(realHome,fs.realpathSync(cwd))||within(realHome,fs.realpathSync(root)))
    throw new Error('Untrusted macOS CODEX_HOME location');
  return {node,codex,codexHome:realHome,path:`${path.dirname(node)}:/usr/bin:/bin`};
}

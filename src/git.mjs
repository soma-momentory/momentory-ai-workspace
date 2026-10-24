import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import { root } from './config.mjs';
import { repository } from './projects.mjs';
import { Store } from './store.mjs';
import { redact } from './provider.mjs';

export function git(cwd,...args) { return execFileSync('git',args,{cwd,encoding:'utf8',timeout:15000,windowsHide:true}).trim(); }
export function ignoredWorktreeViolations(dir,allowed=[]){
  const safe=new Set(allowed);
  const visible=new Set(git(dir,'ls-files','--others','--exclude-standard','--directory').split(/\r?\n/).filter(Boolean));
  return git(dir,'ls-files','--others','--ignored','--exclude-standard','--directory').split(/\r?\n/).filter(file=>file&&!visible.has(file)&&!safe.has(file));
}
const samePath=(a,b)=>{const left=fs.realpathSync(a),right=fs.realpathSync(b);return process.platform==='win32'?left.toLowerCase()===right.toLowerCase():left===right;};
export function repoStatus(projectId,repoId) {
  const dir=repository(projectId,repoId).path;
  const actual=path.resolve(git(dir,'rev-parse','--show-toplevel'));
  if (!samePath(actual,dir)) throw new Error('Repository boundary mismatch');
  return {dir,branch:git(dir,'branch','--show-current'),head:git(dir,'rev-parse','HEAD'),dirty:git(dir,'status','--porcelain')};
}
export function createWorktree(task) {
  const info=repoStatus(task.project_id,task.repo);
  const dir=path.join(root,'worktrees',task.project_id,task.id);
  if (fs.existsSync(dir)) {
    const actualDir=fs.realpathSync(dir),expectedDir=path.resolve(dir);
    if(fs.lstatSync(dir).isSymbolicLink()||(process.platform==='win32'?actualDir.toLowerCase()!==expectedDir.toLowerCase():actualDir!==expectedDir))throw new Error('Worktree path is linked outside its isolation directory');
    if(task.worktree!==dir) throw new Error('Uncheckpointed worktree requires manual inspection before retry');
    if (!samePath(path.resolve(git(dir,'rev-parse','--show-toplevel')),dir)) throw new Error('Worktree path mismatch');
    const baseHead=task.base_head || git(dir,'rev-parse','HEAD');
    if(!git(dir,'cat-file','-t',baseHead).includes('commit')) throw new Error('Worktree base commit missing');
    return {dir,branch:git(dir,'branch','--show-current'),baseHead,dirtySource:!!info.dirty};
  }
  fs.mkdirSync(path.dirname(dir),{recursive:true});
  const branch=`workspace/${task.id}`;
  git(info.dir,'worktree','add','-b',branch,dir,info.head);
  return {dir,branch,baseHead:info.head,dirtySource:!!info.dirty};
}
export function inheritApproved(task,dir,sourceStore=null) {
  if(!task.dependsOn?.length) return;
  const store=sourceStore||new Store();
  try {
    for(const id of task.dependsOn) {
      const parent=store.getTask(id);
      if(!parent||parent.project_id!==task.project_id) throw new Error('Cross-project dependency denied');
      if(parent.status!=='APPROVED'||parent.repo!==task.repo) continue;
      if(!parent.worktree||!fs.existsSync(parent.worktree)) throw new Error(`Approved worktree unavailable: ${id}`);
      const approval=store.decisions(id).find(item=>item.kind==='result'&&item.status==='APPROVED');
      if(!/^[0-9a-f]{64}$/.test(approval?.details?.approvedDiffHash||'')||git(parent.worktree,'rev-parse','HEAD')!==parent.base_head||recoveryFingerprint(parent.worktree,parent.base_head)!==approval.details.approvedDiffHash)
        throw new Error(`Approved worktree changed after human review or lacks a frozen fingerprint: ${id}`);
      const patch=execFileSync('git',['diff','--binary',parent.base_head],{cwd:parent.worktree,encoding:'utf8',maxBuffer:10*1024*1024,timeout:30000});
      if(patch) {
        const already=(()=>{try{execFileSync('git',['apply','--reverse','--check','--binary','-'],{cwd:dir,input:patch,timeout:30000,stdio:'ignore'});return true;}catch{return false;}})();
        if(!already){execFileSync('git',['apply','--check','--binary','-'],{cwd:dir,input:patch,timeout:30000});execFileSync('git',['apply','--binary','-'],{cwd:dir,input:patch,timeout:30000});}
      }
      const untracked=git(parent.worktree,'ls-files','--others','--exclude-standard').split(/\r?\n/).filter(Boolean);
      for(const file of untracked) {
        const source=path.resolve(parent.worktree,file),target=path.resolve(dir,file);
        if(!source.startsWith(path.resolve(parent.worktree)+path.sep)||!target.startsWith(path.resolve(dir)+path.sep)||!fs.realpathSync(source).startsWith(fs.realpathSync(parent.worktree)+path.sep)||!fs.lstatSync(source).isFile()) throw new Error(`Unsafe inherited file: ${file}`);
        let current=path.resolve(dir);
        for(const segment of path.relative(current,path.dirname(target)).split(path.sep).filter(Boolean)){
          current=path.join(current,segment);
          const entry=fs.lstatSync(current,{throwIfNoEntry:false});
          if(entry&&!entry.isDirectory())throw new Error(`Unsafe inherited destination directory: ${file}`);
          if(!entry)fs.mkdirSync(current);
          if(!fs.realpathSync(current).startsWith(fs.realpathSync(dir)+path.sep))throw new Error(`Inherited destination escaped worktree: ${file}`);
        }
        const existing=fs.lstatSync(target,{throwIfNoEntry:false});
        if(existing){if(!existing.isFile()||!fs.readFileSync(target).equals(fs.readFileSync(source)))throw new Error(`Conflicting inherited file: ${file}`);continue;}
        fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);
      }
      if(recoveryFingerprint(parent.worktree,parent.base_head)!==approval.details.approvedDiffHash)throw new Error(`Approved worktree changed during inheritance: ${id}`);
    }
  } finally {if(!sourceStore)store.close();}
}
export function diffSummary(dir,baseHead) {
  const status=git(dir,'status','--porcelain');
  const changed=git(dir,'diff','--name-only',baseHead);
  const untracked=git(dir,'ls-files','--others','--exclude-standard');
  let opaque=false;
  const extras=untracked.split(/\r?\n/).filter(Boolean).flatMap(file=>{
    const name=path.resolve(dir,file);if(!name.startsWith(path.resolve(dir)+path.sep)||/(^|\/)(?:\.env|\.git)/.test(file))return [];
    const stat=fs.lstatSync(name);if(stat.isSymbolicLink()||!fs.realpathSync(name).startsWith(fs.realpathSync(dir)+path.sep)||!stat.isFile()||stat.size>32000){opaque=true;return [`--- /dev/null\n+++ b/${file}\n(binary, linked, or large new file)`];}
    const content=fs.readFileSync(name,'utf8');if(content.includes('\0')){opaque=true;return [`--- /dev/null\n+++ b/${file}\n(binary new file)`];}
    return [`--- /dev/null\n+++ b/${file}\n${content.split(/\r?\n/).map(line=>`+${line}`).join('\n')}`];
  });
  const patch=execFileSync('git',['diff','--no-ext-diff','--binary',baseHead],{cwd:dir,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
  const full=[patch,...extras].join('\n'),masked=redact(full);
  const reviewable=!opaque&&!/GIT binary patch|Binary files .* differ/.test(patch)&&full.length<=120000&&masked===full;
  return {status,changedFiles:[...new Set([...changed.split(/\r?\n/),...untracked.split(/\r?\n/)].filter(Boolean))],diff:git(dir,'diff','--stat',baseHead).slice(0,10000),patch:masked.slice(0,120000),reviewable,reviewError:reviewable?null:'Diff has hidden, truncated, binary, or redacted content; inspect it locally before recovery or approval'};
}
export function recoveryFingerprint(dir,baseHead){
  const hash=createHash('sha256');
  const patch=execFileSync('git',['diff','--no-ext-diff','--binary',baseHead],{cwd:dir,maxBuffer:50*1024*1024,timeout:30000});
  hash.update(patch);
  const files=execFileSync('git',['ls-files','--others','--exclude-standard','-z'],{cwd:dir,encoding:'utf8',maxBuffer:5*1024*1024,timeout:30000}).split('\0').filter(Boolean).sort();
  for(const file of files){
    const target=path.resolve(dir,file),base=path.resolve(dir)+path.sep;
    if(!target.startsWith(base))throw new Error('Unsafe recovery path');
    const stat=fs.lstatSync(target);
    hash.update(`\0${file}\0${stat.mode}\0${stat.size}\0`);
    if(stat.isSymbolicLink())hash.update(fs.readlinkSync(target));
    else if(stat.isFile()){
      if(stat.size>50*1024*1024)throw new Error(`Recovery file too large to fingerprint: ${file}`);
      hash.update(fs.readFileSync(target));
    }else throw new Error(`Unsupported recovery file: ${file}`);
  }
  return hash.digest('hex');
}

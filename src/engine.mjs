import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorktree, inheritApproved, diffSummary, recoveryFingerprint, ignoredWorktreeViolations } from './git.mjs';
import { runProvider, stopTree, redact, childEnv,macChildEnv } from './provider.mjs';
import { git } from './git.mjs';
import { project, repository } from './projects.mjs';
import { Store } from './store.mjs';
import { applySelectedDesign, validateExport } from './design.mjs';
import {codexProfileName,verifyCodexProfile} from './codexProfile.mjs';
import {strictWslChecks,prepareWslDependency,runWslCheck,cleanupStaleBoundaryCanaries,approvedIgnoredMounts} from './wslChecks.mjs';
import {prepareMacDependency} from './macDependency.mjs';
import {trustedMacFile,trustedMacRuntime} from './macTrust.mjs';

const forbidden = 'Do not commit, push, merge, deploy, delete user files, read secrets, modify .env files, or change files outside this worktree. Keep changes scoped to the goal.';
export function reviewVerdict(text) { return /^\s*\W*(PASS|FIX_REQUIRED)\b/i.exec(text)?.[1]?.toUpperCase() || null; }
export function selectedDesignApprovalReady({verification,diff,outputPath,checksChangedSource,headMoved,ignored,violations}){
  return Boolean(verification.ok&&!checksChangedSource&&diff.reviewable&&diff.changedFiles.length===1&&diff.changedFiles[0]===outputPath&&!headMoved&&!ignored.length&&!violations.length);
}
export function parseDesignCandidates(text) {
  try {const start=text.indexOf('{'),end=text.lastIndexOf('}');const value=JSON.parse(text.slice(start,end+1));if(Array.isArray(value.candidates)){const seen=new Set();return value.candidates.filter(x=>{if(!x||typeof x!=='object'||typeof x.name!=='string')return false;const key=JSON.stringify(x.layout||x.informationHierarchy||x.name).toLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).slice(0,2);}}catch{}
  return [];
}
const context = (task) => `${project(task.project_id).name} development task. Goal: ${task.goal}\nProject: ${task.project_id}\nRepository: ${task.repo}\nCompletion criteria: ${task.completion_criteria || 'Verify the requested goal and report evidence.'}\nMode: ${task.mode}\n${forbidden}\nReturn a concise summary of what you changed and remaining risks.`;

export function runCommand(cwd,command,args,timeoutMs,signal,{isolate=false}={}) {
  return new Promise(resolve=>{
    if(isolate) verifyCodexProfile(process.platform==='darwin'?'posix-check':'check');
    const mac=isolate&&process.platform==='darwin'?trustedMacRuntime(cwd):null;
    const actualCommand=mac&&command==='npm'?mac.node:mac&&command==='node'?mac.node:command;
    const actualArgs=mac&&command==='npm'?[trustedMacFile('npm',cwd),...args]:args;
    const executable=isolate?(mac?.codex||(process.platform==='win32'?'codex.cmd':'codex')):actualCommand;
    const commandArgs=isolate?['sandbox','-p',codexProfileName(mac?'posix-check':'check'),'--permission-profile','workspace-check',...(mac?['-C',cwd]:[]),'--',actualCommand,...actualArgs]:actualArgs;
    const env=mac?macChildEnv(mac.path):childEnv();
    if(isolate&&process.platform!=='darwin') env.NODE_OPTIONS=`--require=${JSON.stringify(path.join(path.resolve(import.meta.dirname,'..'),'scripts','sandbox-temp.cjs'))}`;
    const child=spawn(executable,commandArgs,{cwd,windowsHide:true,shell:process.platform==='win32'&&executable!==process.execPath,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],env});
    let output='',timedOut=false,done=false,watchdog=null;
    for(const stream of [child.stdout,child.stderr]) stream.on('data',chunk=>{output=(output+chunk.toString('utf8')).slice(-12000);});
    const finish=(code,error)=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(watchdog);signal?.removeEventListener('abort',abort);resolve({ok:code===0&&!timedOut&&!signal?.aborted&&!error,code,timedOut,output:redact([output,error].filter(Boolean).join('\n'))});};
    const stop=()=>{stopTree(child);if(!watchdog){watchdog=setTimeout(()=>{stopTree(child,'SIGKILL');finish(null,'Command wrapper did not exit after termination');},5000);watchdog.unref();}};
    const timer=setTimeout(()=>{timedOut=true;stop();},timeoutMs);
    const abort=()=>stop(); signal?.addEventListener('abort',abort,{once:true});
    child.on('error',error=>finish(null,error));
    child.on('close',code=>finish(code));
  });
}

export async function verifyTask(task,cwd,signal) {
  const checks=[];
  const repo=repository(task.project_id,task.repo),configured=repo.checks;
  const commands=configured.map(parts=>[process.platform==='win32'&&parts[0]==='./gradlew'?'gradlew.bat':process.platform==='win32'&&parts[0]==='npm'?'npm.cmd':parts[0],parts.slice(1)]);
  for(const [command,args] of commands) {
    if(signal?.aborted) break;
    const result=strictWslChecks(repo.stack)?await runWslCheck(cwd,command,args,repo.checkTimeoutMs||300000,signal):await runCommand(cwd,command,args,repo.checkTimeoutMs||300000,signal,{isolate:true});
    checks.push({command:[command,...args].join(' '),...result});
  }
  return {ok:checks.length===commands.length && checks.every(x=>x.ok),checks};
}

async function protectedViolations(task,files) {
  const universal=files.filter(file=>/(^|\/)(?:\.env[^/]*|\.git(?:\/|$))/.test(file));
  const rules=repository(task.project_id,task.repo).protectedPaths||[];
  const configured=files.filter(file=>rules.some(rule=>rule.endsWith('/')?file.startsWith(rule):file===rule));
  if(repository(task.project_id,task.repo).protectionAdapter!=='harness-scope') return [...new Set([...universal,...configured])];
  const repo=repository(task.project_id,task.repo).path;
  const configFile=path.join(repo,'harness','project.json');
  if(!fs.existsSync(configFile)) return [...new Set([...universal,...configured])];
  const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
  const {isProtectedPath}=await import(pathToFileURL(path.join(repo,'harness','lib','scope.mjs')).href);
  return [...new Set([...universal,...configured,...files.filter(file=>isProtectedPath(file,config.protectedPaths||[]))])];
}

export async function executeTask(task,{emit=()=>{},save=()=>{},candidate=()=>{},evaluate=()=>{},signal}={}) {
  const location=createWorktree(task);
  await save({worktree:location.dir,branch:location.branch,base_head:location.baseHead});
  cleanupStaleBoundaryCanaries(location.dir);
  emit('worktree',{branch:location.branch,baseHead:location.baseHead,dirtySource:location.dirtySource});
  inheritApproved(task,location.dir);
  const repoConfig=repository(task.project_id,task.repo);
  for(const step of repoConfig.setup||[]) if(strictWslChecks(repoConfig.stack)||process.platform==='darwin'||!fs.existsSync(path.join(location.dir,step.ifMissing))) {
    let setup;
    try{setup=strictWslChecks(repoConfig.stack)?await prepareWslDependency(location.dir,step,signal):process.platform==='darwin'?await prepareMacDependency(location.dir,step,signal):await runCommand(location.dir,step.command[0],step.command.slice(1),600000,signal);}
    catch(error){setup={ok:false,output:String(error)};}
    emit('dependencies',{step:step.ifMissing,ok:setup.ok,output:setup.output.slice(-2000)});
    if(!setup.ok) return {status:'FAILED',result:{error:'Dependency installation failed',step:step.ifMissing},verification:{ok:false,reason:setup.output.slice(-3000)}};
  }
  if(task.design_candidate_id) {
    const store=new Store();let selected;
    try{selected=store.candidate(task.design_candidate_id);}finally{store.close();}
    if(project(task.project_id).design.adapter!=='momentory-expo-lab'||task.repo!==project(task.project_id).design.repo||selected?.status!=='SELECTED'||!selected.proposal?.exported||!task.dependsOn.includes(selected.task_id))
      return {status:'UNVERIFIED',result:{error:'Selected design lineage invalid'},verification:{ok:false,reason:'Selected design lineage invalid'}};
    if(!selected.screenshot||selected.screenshot.baseHead!==location.baseHead) return {status:'UNVERIFIED',result:{candidateId:selected.id},verification:{ok:false,reason:'Visual screenshot is missing or was rendered from a different source commit'}};
    let applied;
    try{applied=await applySelectedDesign(selected.proposal.exported,task.project_id,location.dir);}
    catch(error){emit('design_applied',{ok:false,error:String(error)});return {status:'FAILED',result:{candidateId:selected.id,error:String(error)},verification:{ok:false,reason:'Design apply failed'}};}
    emit('design_applied',{ok:true,changedKeys:applied.changedKeys});
    const beforeChecks=recoveryFingerprint(location.dir,location.baseHead);
    const verification=await verifyTask(task,location.dir,signal);
    const diff=diffSummary(location.dir,location.baseHead);
    const checksChangedSource=beforeChecks!==recoveryFingerprint(location.dir,location.baseHead);
    const violations=await protectedViolations(task,diff.changedFiles);
    const outputPath=project(task.project_id).design.outputPath.replace(/\\/g,'/');
    const headMoved=git(location.dir,'rev-parse','HEAD')!==location.baseHead;
    const ignored=ignoredWorktreeViolations(location.dir,approvedIgnoredMounts(location.dir,repoConfig));
    const onlySelectedOutput=diff.changedFiles.length===1&&diff.changedFiles[0]===outputPath;
    const status=signal?.aborted?'CANCELLED':selectedDesignApprovalReady({verification,diff,outputPath,checksChangedSource,headMoved,ignored,violations})?'AWAITING_APPROVAL':'UNVERIFIED';
    const verifiedDiffHash=status==='AWAITING_APPROVAL'?recoveryFingerprint(location.dir,location.baseHead):null;
    return {status,result:{candidateId:selected.id,screenshot:selected.screenshot,diff,protectedViolations:violations,checksChangedSource,headMoved,ignored,onlySelectedOutput,verifiedDiffHash},verification,usage:{automation:true}};
  }
  const provider=task.provider;
  const run=async (which,prompt,readOnly=false,sessionId=null)=>{
    emit('provider_started',{provider:which,readOnly});
    const result=await runProvider({provider:which,cwd:location.dir,prompt,readOnly,sessionId,signal,onEvent:e=>{if(e.type==='session'&&which===provider)save({session_id:e.sessionId}).catch(()=>{});emit('provider_event',{provider:which,...e});}});
    emit('provider_finished',{provider:which,ok:result.ok,code:result.code,stderr:result.stderr});
    return result;
  };
  if(task.mode==='EXPLORE') {
    const historyStore=new Store();let history;try{history=historyStore.designHistory(task.project_id);}finally{historyStore.close();}
    const files=(project(task.project_id).design.contextFiles||[]).flatMap(file=>{const target=path.resolve(location.dir,file);if(!target.startsWith(path.resolve(location.dir)+path.sep)||!fs.existsSync(target))return [];return [`${file}: ${fs.readFileSync(target,'utf8').slice(0,5000)}`];}).join('\n').slice(0,15000);
    const studio=project(task.project_id).design.adapter==='momentory-expo-lab';
    const approved=studio?JSON.parse(fs.readFileSync(path.join(location.dir,project(task.project_id).design.outputPath),'utf8')):null;
    const studioInstruction=studio?` For each candidate also provide screen (one of home-main, rest-hub, archive, my-main, report) and studioPatch: an object containing only changed keys from this approved, editable design schema: ${JSON.stringify(approved)}. Use the exact key names and valid value types. The patch must make a visible difference in typography, alignment, spacing, asset, or composition within these supported properties. Never generate executable code. Unsupported layout changes must be described as requiring implementation and must not be presented as rendered.`:'';
    const prompt=`${context(task)}\nProduce two genuinely distinct design approaches. Keep the same content and device constraints. First explain information hierarchy and layout. Then apply this project's design rules: ${JSON.stringify(project(task.project_id).design)}. Project design context: ${files}. Prior human design decisions: ${JSON.stringify(history)}. Avoid repeating explicitly rejected patterns. Do not edit code. Include tradeoffs and evaluation against readability, access, brand, responsive behavior and implementation fit.${studioInstruction} Return JSON with {candidates:[{name,layout,brand,tradeoffs,evaluation${studio?',screen,studioPatch':''}}]}.`;
    const [claude,codex]=await Promise.all([run('claude',prompt,true),run('codex',prompt,true)]);
    const records=[],seenDrafts=new Set();
    for(const [name,result] of [['claude',claude],['codex',codex]]) if(result.ok) {
      const proposals=parseDesignCandidates(result.result);
      for(const proposal of proposals.length?proposals:[{name:`${name} proposal`,text:result.result}]) {
        if(studio && proposal.studioPatch && typeof proposal.studioPatch==='object' && !Array.isArray(proposal.studioPatch)) {
          const screen=['home-main','rest-hub','archive','my-main','report'].includes(proposal.screen)?proposal.screen:'home-main';
          const patch=proposal.studioPatch;
          if(Object.keys(patch).length && Object.keys(patch).every(key=>Object.hasOwn(approved,key))) {
            try {
              const exported=await validateExport({version:1,name:String(proposal.name).slice(0,60),design:{...approved,...patch}},task.project_id,location.dir);
              const fingerprint=JSON.stringify(exported.design);
              if(fingerprint===JSON.stringify(approved)||seenDrafts.has(fingerprint)) throw new Error('Draft has no distinct editable changes');
              seenDrafts.add(fingerprint);proposal.exported=exported;proposal.screen=screen;
            }
            catch(error) {emit('design_schema_rejected',{provider:name,name:proposal.name,reason:String(error)});}
          }
        }
        const created=await candidate(name,proposal);records.push({id:created.id,provider:name,proposal});
      }
    }
    let evaluations=null;
    if(claude.ok&&codex.ok&&records.length) {
      const criteria='Evaluate each candidate independently for information priority, brand, action guidance, visual clarity, readability, responsiveness, accessibility, and implementation fit. Give concrete evidence and risks. Do not select a winner or edit files.';
      const material=JSON.stringify(records.map(({id,provider,proposal})=>({id,provider,proposal}))).slice(0,18000);
      const [fromClaude,fromCodex]=await Promise.all([run('claude',`${criteria}\nCandidates: ${material}`,true),run('codex',`${criteria}\nCandidates: ${material}`,true)]);
      evaluations={claude:{ok:fromClaude.ok,text:fromClaude.result},codex:{ok:fromCodex.ok,text:fromCodex.result}};
      for(const record of records)await evaluate(record.id,evaluations);
    }
    const ok=claude.ok&&codex.ok&&!!evaluations?.claude.ok&&!!evaluations?.codex.ok;
    return {status:ok?'AWAITING_DESIGN_SELECTION':'FAILED',result:{claude,codex,evaluations,candidateIds:records.map(x=>x.id)},verification:{ok:false,reason:'Candidate rendering and selection are verified separately. Unsupported structural layout proposals require implementation review.'},usage:{claude:claude.usage,codex:codex.usage}};
  }
  let execution=await run(provider,context(task),false,task.session_id);
  await save({session_id:execution.sessionId});
  if(!execution.ok) return {status:signal?.aborted?'CANCELLED':'FAILED',result:execution,verification:{ok:false,reason:signal?.aborted?'Task cancelled':'Provider failed'},usage:execution.usage};
  let diff=diffSummary(location.dir,location.baseHead);
  if(diff.changedFiles.length===0) return {status:'UNVERIFIED',result:execution,verification:{ok:false,reason:'No code changes detected'},usage:execution.usage};
  let checksChangedSource=false;
  const unsafeIgnored=()=>ignoredWorktreeViolations(location.dir,approvedIgnoredMounts(location.dir,repoConfig));
  const verifyWithoutMutation=async()=>{
    const hidden=unsafeIgnored();
    if(hidden.length)return {ok:false,checks:[],unsafeIgnored:hidden};
    const before=recoveryFingerprint(location.dir,location.baseHead);
    const result=await verifyTask(task,location.dir,signal);
    if(before!==recoveryFingerprint(location.dir,location.baseHead))checksChangedSource=true;
    return result;
  };
  let verification=await verifyWithoutMutation();
  if(verification.unsafeIgnored)return {status:'UNVERIFIED',result:{execution,diff,unsafeIgnored:verification.unsafeIgnored},verification:{ok:false,reason:'Ignored worktree content changed before verification'},usage:execution.usage};
  emit('verification',{ok:verification.ok,checks:verification.checks.map(c=>({command:c.command,ok:c.ok,output:c.output.slice(-1500)}))});
  if(!verification.ok && !signal?.aborted) {
    const failure=verification.checks.filter(x=>!x.ok).map(x=>`${x.command}\n${x.output.slice(-4000)}`).join('\n');
    const fix=await run(provider,`${context(task)}\nVerification failed. Fix the causes, then explain.\n${failure}`,false,execution.sessionId);
    execution=fix;
    if(!fix.ok) return {status:'FAILED',result:{execution:fix,diff},verification:{ok:false,reason:'Automatic correction failed'},usage:fix.usage};
    verification=await verifyWithoutMutation();
    if(verification.unsafeIgnored)return {status:'UNVERIFIED',result:{execution,diff,unsafeIgnored:verification.unsafeIgnored},verification:{ok:false,reason:'Ignored worktree content changed before reverification'},usage:execution.usage};
    emit('reverification',{ok:verification.ok});
  }
  let review=null;
  let reviewIncomplete=false;
  if(task.mode==='REVIEW' && verification.ok && !signal?.aborted) {
    const other=provider==='claude'?'codex':'claude';
    const reviewDiff=diffSummary(location.dir,location.baseHead);
    if(!reviewDiff.reviewable||reviewDiff.patch.length>30000)reviewIncomplete=true;
    else review=await run(other,`Independently review this current worktree patch for goal: ${task.goal}. The patch is supplied directly so review does not depend on Git metadata access. Read project files as needed. Read only. Identify correctness, security and test gaps. Start answer with PASS or FIX_REQUIRED, followed by evidence. ${forbidden}\nPatch:\n${reviewDiff.patch}`,true);
    const verdict=review?.ok?reviewVerdict(review.result):null;
    if(verdict==='FIX_REQUIRED') {
      execution=await run(provider,`${context(task)}\nIndependent review found issues. Address them: ${review.result.slice(0,8000)}`,false,execution.sessionId);
      if(!execution.ok) return {status:'FAILED',result:{execution,review,diff},verification:{ok:false,reason:'Review correction failed'},usage:execution.usage};
      verification=await verifyWithoutMutation();
      if(verification.unsafeIgnored)return {status:'UNVERIFIED',result:{execution,review,diff,unsafeIgnored:verification.unsafeIgnored},verification:{ok:false,reason:'Ignored worktree content changed before review reverification'},usage:execution.usage};
      emit('review_reverification',{ok:verification.ok});
      if(verification.ok) {
        const current=diffSummary(location.dir,location.baseHead);
        if(!current.reviewable||current.patch.length>30000)reviewIncomplete=true;
        else review=await run(other,`Read-only re-review of the current diff for goal: ${task.goal}. Check the previous findings were addressed. Start with PASS or FIX_REQUIRED and explain. Previous findings: ${review.result.slice(0,8000)}\nCurrent patch:\n${current.patch}`,true);
      }
    }
  }
  diff=diffSummary(location.dir,location.baseHead);
  const violations=await protectedViolations(task,diff.changedFiles);
  const headMoved=git(location.dir,'rev-parse','HEAD')!==location.baseHead;
  const finalVerdict=review?.ok?reviewVerdict(review.result):null;
  const status=signal?.aborted?'CANCELLED':!verification.ok?'FAILED':violations.length||headMoved||checksChangedSource||!diff.reviewable||reviewIncomplete?'UNVERIFIED':review && finalVerdict!=='PASS'?'UNVERIFIED':'AWAITING_APPROVAL';
  const verifiedDiffHash=status==='AWAITING_APPROVAL'?recoveryFingerprint(location.dir,location.baseHead):null;
  return {status,result:{execution,review,diff,baseHead:location.baseHead,dirtySource:location.dirtySource,protectedViolations:violations,headMoved,checksChangedSource,reviewIncomplete,verifiedDiffHash},verification,usage:{primary:execution.usage,review:review?.usage}};
}

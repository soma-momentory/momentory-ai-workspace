import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { settings, root } from './config.mjs';
import { publicProjects, project, repository } from './projects.mjs';
import { Store } from './store.mjs';
import { routeTask, nextHumanActions, TASK_TYPES } from './router.mjs';
import { validateExport, captureDesign } from './design.mjs';
import { repoStatus, createWorktree, inheritApproved, diffSummary, recoveryFingerprint, ignoredWorktreeViolations, git } from './git.mjs';
import { activeWslCodexForWorktree, reapStaleWslCodex } from './wslCodex.mjs';
import {preparedNpmDependency} from './wslChecks.mjs';

const config=settings();
const store=new Store();
const publicDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public');
const safeEqual=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length && timingSafeEqual(x,y);};
const sign=value=>createHmac('sha256',config.token).update(value).digest('hex');
const cookie=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=')).filter(x=>x.length===2));
function userAuth(req) {
  const [expiry,mac]=(cookie(req).workspace_session||'').split('.');
  return !!expiry && Number(expiry)>Date.now() && safeEqual(mac,sign(expiry));
}
const workerAuth=req=>safeEqual((req.headers.authorization||'').replace(/^Bearer /,''),config.workerToken);
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
async function body(req) {
  let text='';for await(const chunk of req) {text+=chunk; if(text.length>524288) throw new Error('Request too large');}
  return text?JSON.parse(text):{};
}
function checkOrigin(req) {
  if(req.method==='GET') return true;
  if(req.url?.startsWith('/api/worker/')) return true;
  const origin=req.headers.origin;
  if(!origin) return false;
  const local=`http://127.0.0.1:${config.port}`;
  return origin===local || origin===`http://[::1]:${config.port}` || (process.env.WORKSPACE_PUBLIC_URL?.startsWith('https://') && origin===process.env.WORKSPACE_PUBLIC_URL);
}
function checkHost(req) {
  const allowed=[`127.0.0.1:${config.port}`,`[::1]:${config.port}`];
  if(process.env.WORKSPACE_PUBLIC_URL) allowed.push(new URL(process.env.WORKSPACE_PUBLIC_URL).host);
  return allowed.includes(req.headers.host);
}
const urlFor=req=>new URL(req.url,`http://${req.headers.host||'localhost'}`);
const owned=(taskId,workerId,nonce)=>{const task=store.getTask(taskId);return task?.status==='RUNNING' && task.lease_owner===workerId && task.lease_nonce===nonce && typeof nonce==='string' ? task : null;};
const loginFailures=new Map();
const riskyGoal=goal=>/\b(?:deploy|production|prod|push|merge|delete|drop database|reset --hard|credential|secret|payment|billing)\b|운영\s*배포|강제\s*푸시|메인\s*병합|대량\s*삭제|자격\s*증명/.test(goal.toLowerCase());
function recoveryDiff(task){
  if(!['STALE','PAUSED','FAILED','UNVERIFIED'].includes(task.status))return null;
  const expected=path.join(path.resolve(import.meta.dirname,'..'),'worktrees',task.project_id,task.id);
  if(!task.worktree&&fs.existsSync(expected))return {error:'Uncheckpointed worktree needs local recovery before resume'};
  if(!task.worktree)return null;
  if(!task.base_head||!fs.existsSync(task.worktree))return {error:'Preserved worktree or base commit missing'};
  try{
    const diff=diffSummary(task.worktree,task.base_head);
    if(!diff.reviewable)return {...diff,error:diff.reviewError};
    const safeIgnored=(repository(task.project_id,task.repo).setup||[]).filter(step=>preparedNpmDependency(task.worktree,step)).map(step=>`${step.ifMissing}/`);
    const opaqueIgnored=ignoredWorktreeViolations(task.worktree,safeIgnored);
    if(opaqueIgnored.length)return {...diff,error:`Ignored worktree content needs local recovery: ${opaqueIgnored.slice(0,8).join(', ')}`};
    return {...diff,hash:recoveryFingerprint(task.worktree,task.base_head)};
  }
  catch(error){return {error:String(error)};}
}
function designCheckout(task){
  const expected=path.join(root,'worktrees',task.project_id,task.id);
  const current=store.getTask(task.id);
  if(!current.worktree&&['QUEUED','PAUSED'].includes(current.status)){
    const checkout=createWorktree(current);
    store.patch(task.id,{worktree:checkout.dir,branch:checkout.branch,base_head:checkout.baseHead},'design_checkout_prepared');
  }
  const prepared=store.getTask(task.id);
  if(prepared.worktree!==expected||!fs.existsSync(expected))throw new Error('Design task checkout is unavailable or outside its isolated worktree');
  if(fs.lstatSync(expected).isSymbolicLink()||fs.realpathSync(expected).toLowerCase()!==path.resolve(expected).toLowerCase())throw new Error('Design task worktree path is linked');
  inheritApproved(prepared,expected);
  return expected;
}
const activeCaptures=new Map();
function queueCapture(candidateId){
  if(activeCaptures.has(candidateId))return;
  const controller=new AbortController();activeCaptures.set(candidateId,controller);
  setImmediate(async()=>{
    let monitor=null;
    try{
      const item=store.candidate(candidateId),task=item&&store.getTask(item.task_id);
      if(!item||item.status!=='CAPTURE_PENDING'||!task||!item.proposal?.exported)return;
      if(task.status==='CANCELLED'||task.status==='REJECTED'){store.setCandidateCaptureFailed(candidateId,'Parent task is cancelled or rejected');return;}
      monitor=setInterval(()=>{const current=store.getTask(task.id);if(!current||['CANCELLED','REJECTED'].includes(current.status)||current.cancel_requested)controller.abort();},1000);
      store.event(task.id,'design_capture_started',{id:candidateId});
      const screenshot=await captureDesign(candidateId,item.proposal.exported,item.proposal.screen||'home-main',task.project_id,designCheckout(task),controller.signal);
      if(controller.signal.aborted)throw new Error('Design capture cancelled');
      store.setCandidateScreenshot(candidateId,screenshot);
    }catch(error){try{store.setCandidateCaptureFailed(candidateId,error);}catch{} }
    finally{if(monitor)clearInterval(monitor);activeCaptures.delete(candidateId);}
  });
}
function hasDependencyCycle(taskId,dependencies){const visit=(id,seen)=>id===taskId||(!seen.has(id)&&store.getTask(id)?.dependsOn.some(next=>visit(next,new Set([...seen,id]))));return dependencies.some(id=>visit(id,new Set()));}

async function handle(req,res) {
  if(!checkHost(req)) return send(res,403,{error:'Host denied'});
  const url=urlFor(req),pathname=url.pathname;
  if(!checkOrigin(req)) return send(res,403,{error:'Origin denied'});
  if(pathname==='/api/login' && req.method==='POST') {
    const client=req.socket.remoteAddress||'unknown',entry=loginFailures.get(client)||{count:0,until:0};
    if(entry.until>Date.now()) return send(res,429,{error:'Too many attempts'});
    const input=await body(req);
    if(!safeEqual(input.token||'',config.token)) {entry.count++;if(entry.count>=5){entry.until=Date.now()+60000;entry.count=0;}loginFailures.set(client,entry);return send(res,401,{error:'Invalid token'});}
    loginFailures.delete(client);
    const expiry=String(Date.now()+7*86400000);
    const secure=req.headers.origin===process.env.WORKSPACE_PUBLIC_URL&&process.env.WORKSPACE_PUBLIC_URL?.startsWith('https://')?'; Secure':'';
    res.setHeader('Set-Cookie',`workspace_session=${expiry}.${sign(expiry)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`);
    return send(res,200,{ok:true});
  }
  if(pathname.startsWith('/api/worker/')) {
    if(!workerAuth(req)) return send(res,401,{error:'Unauthorized'});
    const input=await body(req);
    if(pathname==='/api/worker/heartbeat') {
      if(typeof input.id!=='string' || !Array.isArray(input.capabilities)) return send(res,400,{error:'Invalid worker'});
      const active=input.activeTask?owned(input.activeTask,input.id,input.leaseNonce):null;
      if(input.activeTask && !active) return send(res,409,{error:'Task lease lost'});
      store.heartbeat(input.id,String(input.name||input.id).slice(0,80),'local',input.capabilities,active?.id,active?.lease_nonce);
      return send(res,200,{ok:true,control:active?.cancel_requested?'cancel':active?.pause_requested?'pause':null});
    }
    if(pathname==='/api/worker/claim') {
      if(!['claude','codex'].includes(input.provider))return send(res,400,{error:'Worker provider must be claude or codex'});
      return send(res,200,{task:store.claim(input.id,Array.isArray(input.capabilities)?input.capabilities:[],30000,input.provider)});
    }
    if(pathname==='/api/worker/orphan-result') {
      const orphan=store.getTask(input.taskId);
      if(!orphan || orphan.worktree_host!==input.id || orphan.lease_nonce!==input.leaseNonce) return send(res,403,{error:'Worker mismatch'});
      store.event(orphan.id,'orphan_result',{workerId:input.id,result:input.result,verification:input.verification,status:input.status});
      return send(res,200,{ok:true});
    }
    const task=owned(input.taskId,input.id,input.leaseNonce); if(!task) return send(res,409,{error:'Lease owner mismatch'});
    if(pathname==='/api/worker/event') {store.event(task.id,String(input.event).slice(0,80),input.payload||{});return send(res,200,{ok:true});}
    if(pathname==='/api/worker/patch') {
      const fields={};for(const key of ['session_id','worktree','branch','base_head']) if(input.fields?.[key]!=null) fields[key]=String(input.fields[key]).slice(0,1000);
      if(fields.worktree) fields.worktree_host=input.id;
      return send(res,200,{task:store.patch(task.id,fields,'checkpoint',fields)});
    }
    if(pathname==='/api/worker/candidate') {
      let proposal=input.proposal;
      if(proposal?.exported) {
        if(project(task.project_id).design.adapter!=='momentory-expo-lab'||task.repo!==project(task.project_id).design.repo) return send(res,400,{error:'Studio adapter unavailable'});
        proposal={...proposal,exported:await validateExport(proposal.exported,task.project_id,designCheckout(task))};
      }
      const id=store.addCandidate(task.id,input.provider,proposal);
      if(proposal?.exported) {
        store.setCandidateCapturePending(id);queueCapture(id);
      }
      return send(res,200,{id,rendered:false,pending:!!proposal?.exported});
    }
    if(pathname==='/api/worker/candidate-status'){
      const item=store.candidate(input.candidateId);
      return item?.task_id===task.id?send(res,200,{id:item.id,status:item.status,rendered:!!item.screenshot}):send(res,404,{error:'Candidate unavailable'});
    }
    if(pathname==='/api/worker/evaluation') return store.setCandidateEvaluation(input.candidateId,task.id,input.evaluation)?send(res,200,{ok:true}):send(res,404,{error:'Candidate not found'});
    if(pathname==='/api/worker/complete') {
      const accepted=['AWAITING_APPROVAL','AWAITING_DESIGN_SELECTION','FAILED','UNVERIFIED','CANCELLED'];
      if(!accepted.includes(input.status)) return send(res,400,{error:'Invalid status'});
      let status=task.cancel_requested?'CANCELLED':task.pause_requested?'PAUSED':input.status;
      if(status==='AWAITING_APPROVAL' && (input.verification?.ok!==true || !input.result?.diff?.changedFiles?.length)) status='UNVERIFIED';
      if(status==='FAILED' && task.attempts<task.max_attempts) status='QUEUED';
      const updated=store.patch(task.id,{status,lease_owner:null,lease_until:null,result:input.result||{},verification:input.verification||{},usage:input.usage||{}},'completed',{status});
      if(status==='AWAITING_APPROVAL') store.addDecision(task.id,'result',{question:'Accept this verified result?',options:[{value:'APPROVED',benefit:'Allows dependent tasks to start',risk:'Source integration still requires review'},{value:'REJECTED',benefit:'Prevents dependent work',risk:'Requires a correction task'}],recommendation:'Review the diff and verification before approval',basis:updated.verification,changedFiles:updated.result?.diff?.changedFiles||[],next:'Dependent tasks become eligible; no automatic merge or deployment.'});
      if(status==='AWAITING_DESIGN_SELECTION') store.addDecision(task.id,'design',{question:'Which design candidate should proceed?',options:store.candidates(task.id).map(x=>({value:x.id,benefit:'Selected for further implementation',risk:'Visual and device verification may still be needed'})),recommendation:'Compare candidates at equal viewport and content',basis:'Selection remains a human product decision',candidateIds:store.candidates(task.id).map(x=>x.id),next:'Chosen candidate becomes the basis for a follow-up implementation task.'});
      return send(res,200,{task:updated});
    }
    return send(res,404,{error:'Unknown worker route'});
  }
  if(pathname.startsWith('/api/')) {
    if(!userAuth(req)) return send(res,401,{error:'Unauthorized'});
    if(pathname==='/api/session') return send(res,200,{authenticated:true});
    if(pathname==='/api/stream' && req.method==='GET') {
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
      let cursor=Number(req.headers['last-event-id']||url.searchParams.get('after')||0);
      if(!Number.isSafeInteger(cursor)||cursor<0) cursor=0;
      res.write(': connected\n\n');
      const interval=setInterval(()=>{
        try {for(const event of store.eventsSince(cursor)){cursor=event.id;res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);}res.write(': heartbeat\n\n');}
        catch {clearInterval(interval);res.end();}
      },1000);
      res.on('close',()=>clearInterval(interval));
      return;
    }
    if(pathname==='/api/overview') {const projectId=url.searchParams.get('project')||publicProjects()[0].id;if(!publicProjects().some(item=>item.id===projectId))return send(res,404,{error:'Project not found'});const tasks=store.listTasks(projectId);return send(res,200,{tasks,workers:store.workers(),humanActions:nextHumanActions(tasks),metrics:store.metrics(projectId),projects:publicProjects()});}
    const captureRetry=/^\/api\/candidates\/([0-9a-f-]{36})\/retry$/.exec(pathname);
    if(captureRetry&&req.method==='POST'){
      const item=store.candidate(captureRetry[1]),task=item&&store.getTask(item.task_id);
      if(!task||!item.proposal?.exported)return send(res,404,{error:'Candidate unavailable'});
      if(item.status!=='CAPTURE_FAILED'||activeCaptures.has(item.id))return send(res,409,{error:'Candidate capture is not retryable now'});
      store.setCandidateCapturePending(item.id);queueCapture(item.id);
      return send(res,202,{candidate:store.candidate(item.id),capturePending:true});
    }
    const shot=/^\/api\/candidates\/([0-9a-f-]{36})\/(?:(375|390|402|430|many-375|long-375)-)?(baseline|candidate)\.png$/.exec(pathname);
    if(shot && req.method==='GET') {
      const candidate=store.candidate(shot[1]);
      const qualifier=shot[2],kind=shot[3];
      const file=!qualifier?candidate?.screenshot?.[kind]:qualifier.includes('-')?candidate?.screenshot?.states?.[qualifier]?.[kind]:candidate?.screenshot?.matrix?.[qualifier]?.[kind];
      if(!file || !/^[0-9a-f-]{36}-(?:(?:375|390|402|430|many-375|long-375)-)?(?:baseline|candidate)\.png$/.test(file)) return send(res,404,{error:'Screenshot unavailable'});
      const screenshotPath=path.join(publicDir,'..','data','screenshots',file);if(!fs.existsSync(screenshotPath))return send(res,404,{error:'Screenshot missing'});
      res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
      return fs.createReadStream(screenshotPath).pipe(res);
    }
    if(pathname==='/api/tasks' && req.method==='POST') {
      const input=await body(req);
      const projectId=input.projectId||publicProjects()[0].id;
      if(typeof input.goal!=='string' || input.goal.trim().length<8 || input.goal.length>5000 || !publicProjects().some(item=>item.id===projectId) || !project(projectId).repositories[input.repo] || !TASK_TYPES.includes(input.type??'AI_TASK') || (input.owner!=null&&(typeof input.owner!=='string'||input.owner.length>80)) || (input.completionCriteria!=null && (typeof input.completionCriteria!=='string'||input.completionCriteria.length>2000)) || !Number.isInteger(input.priority??0) || Math.abs(input.priority??0)>10 || !Number.isInteger(input.maxAttempts??2) || (input.maxAttempts??2)<1 || (input.maxAttempts??2)>3) return send(res,400,{error:'Goal or task options invalid'});
      if(input.dependsOn && (!Array.isArray(input.dependsOn) || input.dependsOn.length>20 || input.dependsOn.some(id=>store.getTask(id)?.project_id!==projectId))) return send(res,400,{error:'Invalid dependencies'});
      try{repoStatus(projectId,input.repo);}catch{return send(res,409,{error:'Configured Git repository is unavailable or not its root'});}
      const route=routeTask(input,store.listTasks(projectId));
      const requiresApproval=input.type!=='HUMAN_TASK'&&riskyGoal(input.goal);
      const task=store.createTask({...input,projectId,goal:input.goal.trim(),initialStatus:requiresApproval?'AWAITING_PREAPPROVAL':'QUEUED'},route);
      if(requiresApproval)store.addDecision(task.id,'risk',{question:'May this potentially risky task enter the AI queue?',options:[{value:'APPROVED',benefit:'Allows isolated analysis and implementation',risk:'The AI may attempt sensitive work inside its worktree'},{value:'REJECTED',benefit:'Stops execution',risk:'The goal remains undone'}],recommendation:'Review scope and credentials before approval',basis:'The goal mentions deployment, protected integration, deletion, or secrets',next:'Approval queues the task; no merge or deployment is automated.'});
      return send(res,201,{task:store.getTask(task.id)});
    }
    const match=/^\/api\/tasks\/([0-9a-f-]{36})(?:\/(events|decisions|candidates|control|followup))?$/.exec(pathname);
    if(match) {
      const task=store.getTask(match[1]);if(!task) return send(res,404,{error:'Task not found'});
      if(req.method==='GET') return send(res,200,{task,recovery:recoveryDiff(task),events:store.events(task.id,Number(url.searchParams.get('after')||0)),decisions:store.decisions(task.id),candidates:store.candidates(task.id)});
      const input=await body(req);
      if(req.method==='PATCH' && !match[2]) {
        if(!['QUEUED','PAUSED','BLOCKED'].includes(task.status)) return send(res,409,{error:'Only waiting tasks can be edited'});
        if(input.goal!=null && (typeof input.goal!=='string'||input.goal.trim().length<8||input.goal.length>5000)) return send(res,400,{error:'Invalid goal'});
        if(input.priority!=null && (!Number.isInteger(input.priority)||Math.abs(input.priority)>10)) return send(res,400,{error:'Invalid priority'});
        if(input.completionCriteria!=null && (typeof input.completionCriteria!=='string'||input.completionCriteria.length>2000)) return send(res,400,{error:'Invalid criteria'});
        if(input.dependsOn && (!Array.isArray(input.dependsOn)||input.dependsOn.some(id=>store.getTask(id)?.project_id!==task.project_id)||hasDependencyCycle(task.id,input.dependsOn))) return send(res,400,{error:'Invalid dependencies'});
        const fields={};for(const [key,column] of [['goal','goal'],['priority','priority'],['completionCriteria','completion_criteria'],['dependsOn','depends_on']]) if(input[key]!=null)fields[column]=input[key];
        if(task.status==='BLOCKED'&&input.dependsOn&&input.dependsOn.every(id=>['APPROVED','SELECTED','DONE'].includes(store.getTask(id)?.status)))fields.status='QUEUED';
        return send(res,200,{task:store.patch(task.id,fields,'task_updated',{fields:Object.keys(fields)})});
      }
      if(match[2]==='control' && input.action==='complete' && task.type==='HUMAN_TASK') {
        if(typeof input.evidence!=='string'||input.evidence.trim().length<3||input.evidence.length>3000)return send(res,400,{error:'Completion evidence required'});
        const done=store.completeHuman(task.id,input.evidence.trim());return done?send(res,200,{task:done}):send(res,409,{error:'Human task is not ready'});
      }
      if(match[2]==='candidates') {
        if(task.repo!==project(task.project_id).design.repo||project(task.project_id).design.adapter!=='momentory-expo-lab') return send(res,400,{error:'Studio adapter unavailable for this project'});
        const exported=await validateExport(input.exported,task.project_id,designCheckout(task));
        const screen=String(input.screen||'home-main');
        const id=store.addCandidate(task.id,'studio',{exported,screen});
        store.setCandidateCapturePending(id);queueCapture(id);
        return send(res,202,{candidate:store.candidate(id),capturePending:true});
      }
      if(match[2]==='control') {
        if(!['cancel','pause','resume'].includes(input.action)) return send(res,400,{error:'Invalid action'});
        if(input.action==='cancel') store.patch(task.id,{cancel_requested:1,status:['QUEUED','BLOCKED'].includes(task.status)?'CANCELLED':task.status},'cancel_requested');
        if(input.action==='pause') store.patch(task.id,{pause_requested:1,status:task.status==='QUEUED'?'PAUSED':task.status},'pause_requested');
        if(input.action==='resume' && ['PAUSED','FAILED','UNVERIFIED','STALE'].includes(task.status)) {
          reapStaleWslCodex();
          if(task.worktree&&activeWslCodexForWorktree(task.worktree).length)return send(res,409,{error:'Prior Codex process remains active'});
          const recovery=recoveryDiff(task);
          if(recovery?.error)return send(res,409,{error:recovery.error});
          if(recovery?.changedFiles.length&&input.reviewedDiffHash!==recovery.hash)return send(res,409,{error:'Review the preserved partial diff before resuming',recovery});
          store.patch(task.id,{pause_requested:0,cancel_requested:0,status:'QUEUED'},'resumed');
        }
        return send(res,200,{task:store.getTask(task.id)});
      }
      if(match[2]==='followup') {
        if(typeof input.instruction!=='string'||input.instruction.trim().length<3||input.instruction.length>3000) return send(res,400,{error:'Invalid instruction'});
        if(typeof input.requestId!=='string'||!/^[0-9a-f-]{36}$/i.test(input.requestId))return send(res,400,{error:'A stable requestId is required for recoverable follow-up'});
        const dependsOn=['REJECTED','CANCELLED'].includes(task.status)?[]:[task.id];
        const parentContext=task.goal.slice(0,500);
        const nextGoal=`Follow-up for ${task.id} (${parentContext}): ${input.instruction.trim()}`;
        const instruction=input.instruction.trim(),instructionHash=createHash('sha256').update(instruction).digest('hex');
        const existing=store.followupRequest(task.id,input.requestId);
        if(existing){if(existing.instructionHash?existing.instructionHash!==instructionHash:!existing.task.goal.endsWith(`: ${instruction}`))return send(res,409,{error:'requestId already used for a different instruction'});return send(res,200,{task:existing.task,deduplicated:true});}
        let next;try{next=store.createTask({goal:nextGoal,projectId:task.project_id,repo:task.repo,dependsOn,priority:task.priority,completionCriteria:task.completion_criteria,type:'COLLABORATIVE_TASK'},routeTask({goal:input.instruction,repo:task.repo},store.listTasks(task.project_id)),{parentTaskId:task.id,requestId:input.requestId,instruction,instructionHash});}
        catch(error){if(String(error).includes('requestId already used'))return send(res,409,{error:'requestId already used for a different instruction'});throw error;}
        const scopeImpact={parentStatus:task.status,waitsForParent:dependsOn.length>0,possibleRework:task.status==='RUNNING'||/change|replace|instead|변경|교체|대신/.test(input.instruction.toLowerCase()),note:'The instruction is queued; it does not interrupt the active provider. Approved same-repository changes are inherited when the follow-up starts.'};
        store.event(task.id,'followup_created',{id:next.id,scopeImpact});store.event(next.id,'planning_impact',scopeImpact);return send(res,201,{task:next,scopeImpact});
      }
    }
    const decision=/^\/api\/decisions\/([0-9a-f-]{36})$/.exec(pathname);
    if(decision && req.method==='POST') {
      const input=await body(req);
      if(!['APPROVED','REJECTED'].includes(input.status)) return send(res,400,{error:'Invalid decision'});
      if(input.rationale!=null&&(typeof input.rationale!=='string'||input.rationale.length>2000))return send(res,400,{error:'Invalid rationale'});
      const pending=store.decision(decision[1]);
      let approvedDiffHash=null;
      if(input.status==='APPROVED'&&pending?.kind==='result'){
        const candidate=store.getTask(pending.task_id);
        if(candidate?.worktree){
          try{
            const verified=candidate.result?.verifiedDiffHash;
            if(!/^[0-9a-f]{64}$/.test(verified||'')||git(candidate.worktree,'rev-parse','HEAD')!==candidate.base_head||!diffSummary(candidate.worktree,candidate.base_head).reviewable)return send(res,409,{error:'Verified worktree changed or has no approval fingerprint; rerun verification'});
            approvedDiffHash=recoveryFingerprint(candidate.worktree,candidate.base_head);
            if(approvedDiffHash!==verified)return send(res,409,{error:'Verified worktree changed before approval; rerun verification'});
          }catch{return send(res,409,{error:'Verified worktree unavailable; rerun verification'});}
        }
      }
      const task=store.resolveDecision(decision[1],input.status,input.selectedCandidateId,input.rationale||'',approvedDiffHash);
      if(!task)return send(res,409,{error:'Decision unavailable'});
      let followup=null;
      const chosen=input.selectedCandidateId&&store.candidate(input.selectedCandidateId);
      if(input.status==='APPROVED'&&task.status==='SELECTED'&&chosen?.proposal?.exported&&project(task.project_id).design.adapter==='momentory-expo-lab'&&task.repo===project(task.project_id).design.repo) {
        followup=store.createTask({projectId:task.project_id,repo:task.repo,type:'COLLABORATIVE_TASK',goal:`Apply selected Studio design ${chosen.proposal.exported.name} to the isolated ${project(task.project_id).name} source and verify it`,completionCriteria:'The approved design token file changes and configured checks pass.',dependsOn:[task.id],designCandidateId:chosen.id,priority:task.priority,maxAttempts:1},routeTask({goal:'Apply selected Studio design',repo:task.repo,mode:'FAST',provider:'codex'},store.listTasks(task.project_id)));
        store.event(task.id,'design_apply_queued',{taskId:followup.id,candidateId:chosen.id});
      }
      return send(res,200,{task,followup});
    }
    return send(res,404,{error:'API route not found'});
  }
  if(req.method!=='GET') return send(res,405,{error:'Method not allowed'});
  const name=pathname==='/'?'index.html':pathname.slice(1);
  if(!['index.html','app.js','style.css'].includes(name)) return send(res,404,{error:'Not found'});
  const file=path.join(publicDir,name);
  const mime=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html';
  res.writeHead(200,{'Content-Type':`${mime}; charset=utf-8`,'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  fs.createReadStream(file).pipe(res);
}

setInterval(()=>store.recoverExpired(),5000).unref();
const server=http.createServer((req,res)=>handle(req,res).catch(error=>send(res,400,{error:String(error.message||error)})));
server.listen(config.port,config.host,()=>{console.log(`AI Development Workspace http://${config.host}:${config.port}`);for(const id of store.pendingCaptures())queueCapture(id);});
function shutdown(){server.closeAllConnections();server.close(()=>{store.close();process.disconnect?.();});}
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);
process.on('message',message=>{if(message==='stop')shutdown();});

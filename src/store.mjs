import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { root } from './config.mjs';
import { projects,project } from './projects.mjs';
import {redact} from './provider.mjs';

const json = (value) => JSON.stringify(value ?? null);
const parse = (value) => value == null ? null : JSON.parse(value);
const now = () => new Date().toISOString();
const scrub = value => typeof value==='string'?redact(value):Array.isArray(value)?value.map(scrub):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,scrub(item)])):value;

export class Store {
  constructor(file = process.env.WORKSPACE_DATA_FILE || path.join(root, 'data', 'workspace.sqlite')) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
    const version=this.db.prepare('PRAGMA user_version').get().user_version;
    if(version>1){this.db.close();throw new Error(`Unsupported Workspace database schema ${version}`);}
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL DEFAULT 'momentory', goal TEXT NOT NULL, repo TEXT NOT NULL, mode TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'AI_TASK', owner TEXT NOT NULL DEFAULT 'ai', completion_criteria TEXT NOT NULL DEFAULT '',
        provider TEXT, priority INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
        reason TEXT NOT NULL, depends_on TEXT NOT NULL DEFAULT '[]',
        attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 2,
        lease_owner TEXT, lease_until INTEGER, lease_nonce TEXT, pause_requested INTEGER NOT NULL DEFAULT 0,
        cancel_requested INTEGER NOT NULL DEFAULT 0, session_id TEXT, worktree TEXT,
        branch TEXT, base_head TEXT, worktree_host TEXT, design_candidate_id TEXT, result TEXT, verification TEXT, usage TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, kind TEXT NOT NULL,
        payload TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_task ON events(task_id,id);
      CREATE TABLE IF NOT EXISTS workers (
        id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, capabilities TEXT NOT NULL,
        last_seen INTEGER NOT NULL, active_task TEXT
      );
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, kind TEXT NOT NULL,
        status TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE TABLE IF NOT EXISTS design_candidates (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, provider TEXT NOT NULL,
        proposal TEXT NOT NULL, evaluation TEXT, screenshot TEXT,
        status TEXT NOT NULL DEFAULT 'PROPOSED', created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS followup_requests (
        parent_task_id TEXT NOT NULL, request_id TEXT NOT NULL, child_task_id TEXT NOT NULL, instruction_hash TEXT,
        PRIMARY KEY(parent_task_id,request_id)
      );
    `);
    for(const [column,type] of [['base_head','TEXT'],['worktree_host','TEXT'],['design_candidate_id','TEXT'],['lease_nonce','TEXT'],['project_id',"TEXT NOT NULL DEFAULT 'momentory'"],['type',"TEXT NOT NULL DEFAULT 'AI_TASK'"],['owner',"TEXT NOT NULL DEFAULT 'ai'"],['completion_criteria',"TEXT NOT NULL DEFAULT ''"]]) {
      const columns=this.db.prepare('PRAGMA table_info(tasks)').all().map(x=>x.name);
      if(!columns.includes(column)) this.db.exec(`ALTER TABLE tasks ADD COLUMN ${column} ${type}`);
    }
    if(!this.db.prepare('PRAGMA table_info(workers)').all().some(x=>x.name==='name')) this.db.exec("ALTER TABLE workers ADD COLUMN name TEXT NOT NULL DEFAULT ''");
    if(!this.db.prepare('PRAGMA table_info(followup_requests)').all().some(x=>x.name==='instruction_hash'))this.db.exec('ALTER TABLE followup_requests ADD COLUMN instruction_hash TEXT');
    this.db.exec('CREATE INDEX IF NOT EXISTS tasks_queue ON tasks(status,priority,created_at); CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id,created_at)');
    if(version<1)this.db.exec('PRAGMA user_version=1');
  }
  close() { this.db.close(); }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  event(taskId, kind, payload = {}) {
    this.db.prepare('INSERT INTO events(task_id,kind,payload,created_at) VALUES(?,?,?,?)')
      .run(taskId, kind, json(scrub(payload)), now());
  }
  blockDependents(parentId,parentStatus){
    const queue=[[parentId,parentStatus]];
    while(queue.length){
      const [id,status]=queue.shift();
      for(const row of this.db.prepare("SELECT id,depends_on FROM tasks WHERE status='QUEUED'").all())if((parse(row.depends_on)||[]).includes(id)){
        this.db.prepare("UPDATE tasks SET status='BLOCKED',updated_at=? WHERE id=?").run(now(),row.id);
        this.event(row.id,'dependency_blocked',{by:id,parentStatus:status});
        queue.push([row.id,'BLOCKED']);
      }
    }
  }
  unblockDependents(parentId){
    for(const row of this.db.prepare("SELECT id,status,depends_on FROM tasks WHERE status IN ('QUEUED','BLOCKED')").all()){
      const deps=parse(row.depends_on)||[];
      if(!deps.includes(parentId)||!deps.every(id=>['APPROVED','SELECTED','DONE'].includes(this.db.prepare('SELECT status FROM tasks WHERE id=?').get(id)?.status)))continue;
      if(row.status==='BLOCKED')this.db.prepare("UPDATE tasks SET status='QUEUED',updated_at=? WHERE id=?").run(now(),row.id);
      this.event(row.id,'unblocked',{by:parentId});
    }
  }
  createTask(input, route, followupRequest=null) {
    const proposedId = randomUUID(); const time = now();
    const id=this.tx(() => {
      if(followupRequest){
        const existing=this.db.prepare('SELECT child_task_id,instruction_hash FROM followup_requests WHERE parent_task_id=? AND request_id=?').get(followupRequest.parentTaskId,followupRequest.requestId);
        if(existing){
          const prior=this.getTask(existing.child_task_id);
          if((existing.instruction_hash&&existing.instruction_hash!==followupRequest.instructionHash)||(!existing.instruction_hash&&!prior?.goal.endsWith(`: ${followupRequest.instruction}`)))throw new Error('requestId already used for a different instruction');
          return existing.child_task_id;
        }
      }
      this.db.prepare(`INSERT INTO tasks(id,project_id,goal,repo,mode,type,owner,completion_criteria,provider,priority,status,reason,depends_on,max_attempts,design_candidate_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(proposedId,input.projectId??projects().keys().next().value, input.goal, input.repo, route.mode, input.type ?? 'AI_TASK',
          input.owner ?? (input.type === 'HUMAN_TASK' ? 'human' : input.type === 'COLLABORATIVE_TASK' ? 'human+ai' : 'ai'), input.completionCriteria ?? '', route.provider,
          input.priority ?? 0, input.initialStatus ?? 'QUEUED', route.reason, json(input.dependsOn ?? []), input.maxAttempts ?? 2,input.designCandidateId??null,time,time);
      this.event(proposedId, 'created', { route });
      if(followupRequest)this.db.prepare('INSERT INTO followup_requests(parent_task_id,request_id,child_task_id,instruction_hash) VALUES(?,?,?,?)').run(followupRequest.parentTaskId,followupRequest.requestId,proposedId,followupRequest.instructionHash);
      return proposedId;
    });
    return this.getTask(id);
  }
  getTask(id) { const row = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id); return row && this.inflate(row); }
  followupRequest(parentTaskId,requestId) {const row=this.db.prepare('SELECT child_task_id,instruction_hash FROM followup_requests WHERE parent_task_id=? AND request_id=?').get(parentTaskId,requestId);return row?{task:this.getTask(row.child_task_id),instructionHash:row.instruction_hash}:null;}
  listTasks(projectId=null) { return (projectId?this.db.prepare('SELECT * FROM tasks WHERE project_id=? ORDER BY priority DESC,created_at DESC LIMIT 200').all(projectId):this.db.prepare('SELECT * FROM tasks ORDER BY priority DESC,created_at DESC LIMIT 200').all()).map(x => this.inflate(x)); }
  inflate(row) { return { ...row, dependsOn: parse(row.depends_on), result: parse(row.result), verification: parse(row.verification), usage: parse(row.usage) }; }
  events(taskId, after = 0) { return this.db.prepare('SELECT * FROM events WHERE task_id=? AND id>? ORDER BY id LIMIT 500').all(taskId, after).map(x => ({...x,payload:parse(x.payload)})); }
  eventsSince(after=0) {return this.db.prepare('SELECT id,task_id,kind,created_at FROM events WHERE id>? ORDER BY id LIMIT 100').all(after);}
  patch(id, fields, eventKind, payload = {}) {
    const allowed = ['status','goal','priority','completion_criteria','owner','depends_on','provider','reason','pause_requested','cancel_requested','session_id','worktree','branch','base_head','worktree_host','result','verification','usage','lease_owner','lease_until'];
    const entries = Object.entries(fields).filter(([key]) => allowed.includes(key));
    if (!entries.length) return this.getTask(id);
    this.tx(() => {
      const sets = entries.map(([key]) => `${key}=?`).join(',');
      this.db.prepare(`UPDATE tasks SET ${sets},updated_at=? WHERE id=?`).run(...entries.map(([key,value]) => ['result','verification','usage','depends_on'].includes(key) ? json(value) : value), now(), id);
      if (eventKind) this.event(id,eventKind,payload);
      if(['FAILED','REJECTED','CANCELLED','UNVERIFIED','STALE'].includes(fields.status))this.blockDependents(id,fields.status);
      if(['APPROVED','SELECTED','DONE'].includes(fields.status))this.unblockDependents(id);
    });
    return this.getTask(id);
  }
  claim(workerId, capabilities, leaseMs = 30000, provider = null) {
    return this.tx(() => {
      const rows = this.db.prepare("SELECT * FROM tasks WHERE status='QUEUED' AND pause_requested=0 AND cancel_requested=0 ORDER BY priority DESC,created_at ASC").all();
      for (const row of rows) {
        if (row.type === 'HUMAN_TASK' || !capabilities.includes(`${row.project_id}:${row.repo}`) || (provider && row.provider !== provider) || (row.worktree_host && row.worktree_host!==workerId)) continue;
        const deps = parse(row.depends_on) ?? [];
        if (deps.some(id => !['APPROVED','SELECTED','DONE'].includes(this.db.prepare('SELECT status FROM tasks WHERE id=?').get(id)?.status))) continue;
        this.db.prepare("UPDATE tasks SET status='RUNNING',lease_owner=?,lease_until=?,lease_nonce=?,attempts=attempts+1,updated_at=? WHERE id=?")
          .run(workerId,Date.now()+leaseMs,randomUUID(),now(),row.id);
        this.event(row.id,'claimed',{workerId});
        return this.getTask(row.id);
      }
      return null;
    });
  }
  heartbeat(workerId, name, kind, capabilities, activeTask, activeNonce=null, leaseMs = 30000) {
    const ms = Date.now();
    this.tx(() => {
      this.db.prepare(`INSERT INTO workers(id,name,kind,capabilities,last_seen,active_task) VALUES(?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,capabilities=excluded.capabilities,last_seen=excluded.last_seen,active_task=excluded.active_task`)
        .run(workerId,name,kind,json(capabilities),ms,activeTask ?? null);
      if (activeTask) this.db.prepare("UPDATE tasks SET lease_until=? WHERE id=? AND lease_owner=? AND lease_nonce=? AND status='RUNNING'").run(ms+leaseMs,activeTask,workerId,activeNonce);
    });
  }
  recoverExpired() {
    return this.tx(() => {
      const expired = this.db.prepare("SELECT * FROM tasks WHERE status='RUNNING' AND lease_until<?").all(Date.now());
      for (const row of expired) {
        const hasCheckpointedOrPhysicalWorktree=!!row.worktree||fs.existsSync(path.join(root,'worktrees',row.project_id,row.id));
        const status = hasCheckpointedOrPhysicalWorktree ? 'STALE' : row.attempts >= row.max_attempts ? 'FAILED' : 'QUEUED';
        this.db.prepare('UPDATE tasks SET status=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=?').run(status,now(),row.id);
        this.event(row.id,'lease_expired',{status,attempts:row.attempts});
        if(status==='STALE'||status==='FAILED')this.blockDependents(row.id,status);
      }
      return expired.length;
    });
  }
  workers() { return this.db.prepare('SELECT * FROM workers ORDER BY last_seen DESC').all().map(x => ({...x,capabilities:parse(x.capabilities)})); }
  metrics(projectId) {
    const tasks=this.listTasks(projectId),decisions=this.db.prepare('SELECT d.* FROM decisions d JOIN tasks t ON t.id=d.task_id WHERE t.project_id=?').all(projectId);
    const final=tasks.filter(t=>['APPROVED','SELECTED','DONE','REJECTED','FAILED','UNVERIFIED','CANCELLED'].includes(t.status));
    const successful=final.filter(t=>['APPROVED','SELECTED','DONE'].includes(t.status));
    const average=values=>values.length?Math.round(values.reduce((sum,value)=>sum+value,0)/values.length):null;
    const waits=decisions.filter(d=>d.resolved_at).map(d=>Date.parse(d.resolved_at)-Date.parse(d.created_at)).filter(Number.isFinite);
    const aiSuccess=successful.filter(t=>t.type!=='HUMAN_TASK');
    return {taskCount:tasks.length,completionRate:final.length?successful.length/final.length:null,
      firstAttemptRate:aiSuccess.length?aiSuccess.filter(t=>t.attempts===1).length/aiSuccess.length:null,
      averageAttempts:average(final.filter(t=>t.type!=='HUMAN_TASK').map(t=>t.attempts)),
      averageDurationMs:average(final.map(t=>Date.parse(t.updated_at)-Date.parse(t.created_at)).filter(Number.isFinite)),
      averageDecisionWaitMs:average(waits),decisionCount:decisions.length,
      reworkCount:tasks.filter(t=>t.attempts>1).length,
      byProvider:Object.fromEntries(['claude','codex'].map(provider=>{const group=final.filter(t=>t.provider===provider&&t.type!=='HUMAN_TASK');return [provider,{count:group.length,successful:group.filter(t=>['APPROVED','SELECTED'].includes(t.status)).length}];}))};
  }
  addDecision(taskId, kind, details) {
    const id=randomUUID();
    this.tx(() => {
      this.db.prepare('INSERT INTO decisions(id,task_id,kind,status,details,created_at) VALUES(?,?,?,?,?,?)').run(id,taskId,kind,'PENDING',json(details),now());
      this.event(taskId,'approval_requested',{id,kind,details});
    });
    return id;
  }
  decisions(taskId) { return this.db.prepare('SELECT * FROM decisions WHERE task_id=? ORDER BY created_at').all(taskId).map(x=>({...x,details:parse(x.details)})); }
  decision(id){const row=this.db.prepare('SELECT * FROM decisions WHERE id=?').get(id);return row&&{...row,details:parse(row.details)};}
  resolveDecision(id, status, selectedCandidateId=null, rationale='',approvedDiffHash=null) {
    const item=this.db.prepare('SELECT * FROM decisions WHERE id=?').get(id);
    if (!item || item.status!=='PENDING') return null;
    const approvalTask=this.getTask(item.task_id);
    if(item.kind==='result'&&status==='APPROVED'&&approvalTask?.worktree&&!/^[0-9a-f]{64}$/.test(approvedDiffHash||''))return null;
    if(item.kind==='design' && status==='APPROVED') {
      const selected=this.db.prepare('SELECT screenshot FROM design_candidates WHERE id=? AND task_id=?').get(selectedCandidateId,item.task_id);
      if(!selected || (project(this.getTask(item.task_id).project_id).design.adapter==='momentory-expo-lab'&&!selected.screenshot)) return null;
    }
    this.tx(() => {
      this.db.prepare('UPDATE decisions SET status=?,resolved_at=?,details=? WHERE id=?').run(status,now(),json({...parse(item.details),rationale,selectedCandidateId,...(item.kind==='result'&&status==='APPROVED'?{approvedDiffHash}: {})}),id);
      if (item.kind==='result') this.db.prepare('UPDATE tasks SET status=?,updated_at=? WHERE id=?').run(status==='APPROVED'?'APPROVED':'REJECTED',now(),item.task_id);
      if (item.kind==='risk') this.db.prepare('UPDATE tasks SET status=?,updated_at=? WHERE id=?').run(status==='APPROVED'?'QUEUED':'REJECTED',now(),item.task_id);
      if (item.kind==='design') {
        this.db.prepare('UPDATE tasks SET status=?,updated_at=? WHERE id=?').run(status==='APPROVED'?'SELECTED':'REJECTED',now(),item.task_id);
        if(status==='APPROVED') this.db.prepare("UPDATE design_candidates SET status=CASE WHEN id=? THEN 'SELECTED' ELSE 'NOT_SELECTED' END WHERE task_id=?").run(selectedCandidateId,item.task_id);
      }
      this.event(item.task_id,'approval_resolved',{id,status,selectedCandidateId,rationale});
      if(status==='APPROVED')this.unblockDependents(item.task_id);
      else this.blockDependents(item.task_id,'REJECTED');
    });
    return this.getTask(item.task_id);
  }
  addCandidate(taskId,provider,proposal) {
    const id=randomUUID();
    this.tx(()=>{this.db.prepare('INSERT INTO design_candidates(id,task_id,provider,proposal,created_at) VALUES(?,?,?,?,?)').run(id,taskId,provider,json(proposal),now());this.event(taskId,'design_candidate',{id,provider});});
    return id;
  }
  candidates(taskId) { return this.db.prepare('SELECT * FROM design_candidates WHERE task_id=?').all(taskId).map(x=>({...x,proposal:parse(x.proposal),evaluation:parse(x.evaluation),screenshot:parse(x.screenshot)})); }
  candidate(id) { const x=this.db.prepare('SELECT * FROM design_candidates WHERE id=?').get(id);return x && {...x,proposal:parse(x.proposal),evaluation:parse(x.evaluation),screenshot:parse(x.screenshot)}; }
  pendingCaptures(){return this.db.prepare("SELECT id FROM design_candidates WHERE status='CAPTURE_PENDING'").all().map(row=>row.id);}
  setCandidateCapturePending(id){const item=this.candidate(id);if(!item)return false;return this.tx(()=>{const result=this.db.prepare("UPDATE design_candidates SET status='CAPTURE_PENDING' WHERE id=? AND status IN ('PROPOSED','CAPTURE_FAILED')").run(id);if(result.changes)this.event(item.task_id,'design_capture_queued',{id});return result.changes>0;});}
  setCandidateCaptureFailed(id,error){const item=this.candidate(id);if(!item)return;this.tx(()=>{const result=this.db.prepare("UPDATE design_candidates SET status='CAPTURE_FAILED' WHERE id=? AND status='CAPTURE_PENDING'").run(id);if(result.changes)this.event(item.task_id,'design_capture_failed',{id,error:redact(error).slice(0,1200)});});}
  setCandidateScreenshot(id,screenshot) {const item=this.candidate(id);if(!item)return;this.tx(()=>{const result=this.db.prepare("UPDATE design_candidates SET screenshot=?,status='RENDERED' WHERE id=? AND status IN ('PROPOSED','CAPTURE_PENDING')").run(json(screenshot),id);if(result.changes)this.event(item.task_id,'design_rendered',{id,baseHead:screenshot.baseHead});});}
  setCandidateEvaluation(id,taskId,evaluation) {return this.tx(()=>{const result=this.db.prepare('UPDATE design_candidates SET evaluation=? WHERE id=? AND task_id=?').run(json(evaluation),id,taskId);if(result.changes)this.event(taskId,'design_evaluated',{candidateId:id});return result.changes>0;});}
  designHistory(projectId) {
    return this.db.prepare("SELECT d.task_id,d.status,d.details,t.goal FROM decisions d JOIN tasks t ON t.id=d.task_id WHERE t.project_id=? AND d.kind='design' AND d.status!='PENDING' ORDER BY d.resolved_at DESC LIMIT 10").all(projectId)
      .map(row=>({goal:row.goal,status:row.status,rationale:parse(row.details)?.rationale||'',selectedCandidateId:parse(row.details)?.selectedCandidateId||null,
        candidates:this.candidates(row.task_id).map(candidate=>({id:candidate.id,provider:candidate.provider,status:candidate.status,proposal:JSON.stringify(candidate.proposal).slice(0,1000)}))}));
  }
  completeHuman(id,evidence) {
    const task=this.getTask(id);
    if(!task || task.type!=='HUMAN_TASK' || task.status!=='QUEUED') return null;
    const ready=task.dependsOn.every(dep=>['APPROVED','SELECTED','DONE'].includes(this.getTask(dep)?.status));
    if(!ready) return null;
    const completed=this.patch(id,{status:'DONE',result:{evidence},verification:{ok:true,method:'human_attestation'}},'human_completed',{evidence});
    return completed;
  }
}

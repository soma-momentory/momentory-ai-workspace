import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {gzipSync,gunzipSync} from 'node:zlib';
import {root,assertNoInterruptedRestore,screenshotDirectory} from './config.mjs';

const format=1;
const schema=1;
const digest=value=>createHash('sha256').update(value).digest('hex');
const files=['database','projects','environment'];
const screenshotName=/^[0-9a-f-]{36}-(?:(?:375|390|402|430|many-375|long-375)-)?(?:baseline|candidate)\.png$/;
const defaults=(options={})=>{
  const primary=path.join(root,'data','workspace.sqlite');
  const configured=process.env.WORKSPACE_DATA_FILE||primary;
  const dbFile=options.dbFile||configured;
  const custom=path.resolve(dbFile)!==path.resolve(primary);
  const explicitDatabaseOverride=!!options.dbFile&&path.resolve(options.dbFile)!==path.resolve(configured);
  return {dbFile,projectsFile:explicitDatabaseOverride?undefined:process.env.WORKSPACE_PROJECTS_FILE||(custom?undefined:path.join(root,'projects.json')),
    envFile:explicitDatabaseOverride?undefined:custom?process.env.WORKSPACE_BACKUP_ENV_FILE:path.join(root,'.env'),
    screenshotsDir:explicitDatabaseOverride?undefined:custom?process.env.WORKSPACE_SCREENSHOTS_DIR:screenshotDirectory(),
    backupDir:process.env.WORKSPACE_BACKUP_DIR||(custom?path.join(path.dirname(dbFile),'backups'):path.join(root,'backups'))};
};
function locations(options={}){const value={...defaults(options),...options};for(const key of ['dbFile','projectsFile','envFile','screenshotsDir','backupDir'])if(typeof value[key]==='string')value[key]=path.resolve(value[key]);return value;}
function secret(key){if(!/^[0-9a-f]{64}$/i.test(key||''))throw new Error('WORKSPACE_BACKUP_KEY must be 32 random bytes encoded as hex');return Buffer.from(key,'hex');}
function inspectDatabase(file){
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    if(db.prepare('PRAGMA user_version').get().user_version!==schema)throw new Error('Unsupported backup database schema');
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Backup database integrity check failed');
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Backup database foreign key check failed');
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
    for(const table of ['tasks','events','workers','decisions','design_candidates','followup_requests'])if(!tables.has(table))throw new Error(`Backup database missing ${table}`);
    const screenshotRefs=new Set();
    const collect=value=>{if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(['baseline','candidate'].includes(key)&&typeof item==='string'){if(!screenshotName.test(item))throw new Error('Backup database contains unsafe screenshot reference');screenshotRefs.add(item);}else collect(item);}};
    for(const row of db.prepare('SELECT screenshot FROM design_candidates WHERE screenshot IS NOT NULL').all())collect(JSON.parse(row.screenshot));
    return {tasks:db.prepare('SELECT count(*) AS count FROM tasks').get().count,worktrees:db.prepare('SELECT id,project_id,worktree FROM tasks WHERE worktree IS NOT NULL').all(),screenshotRefs:[...screenshotRefs]};
  }finally{db.close();}
}
function snapshotDatabase(source,target){
  if(!fs.existsSync(source))throw new Error('Workspace database missing');
  const db=new DatabaseSync(source,{readOnly:true});
  try{
    if(db.prepare('PRAGMA user_version').get().user_version!==schema)throw new Error('Workspace database schema is not supported');
    db.exec(`VACUUM INTO '${target.replaceAll("'","''")}'`);
  }finally{db.close();}
  fs.chmodSync(target,0o600);
  return inspectDatabase(target);
}
function readScreenshots(dir){
  if(!fs.existsSync(dir))return {};
  if(!fs.lstatSync(dir).isDirectory()||fs.lstatSync(dir).isSymbolicLink())throw new Error('Screenshot directory is not a regular directory');
  const result={};
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(entry.isFile()&&/^\.capture-[0-9a-f-]{36}\.tmp$/.test(entry.name))continue;
    if(!entry.isFile()||!screenshotName.test(entry.name))throw new Error(`Unsafe screenshot entry: ${entry.name}`);
    result[entry.name]=fs.readFileSync(path.join(dir,entry.name));
  }
  return result;
}
function packageData(db,config,env,screenshots){
  const values={database:db,projects:config,environment:env};
  const entries=Object.fromEntries(files.map(name=>[name,{sha256:digest(values[name]),data:values[name].toString('base64')} ]));
  const shots=Object.fromEntries(Object.entries(screenshots).map(([name,value])=>[name,{sha256:digest(value),data:value.toString('base64')}]));
  return Buffer.from(JSON.stringify({format,schema,createdAt:new Date().toISOString(),entries,screenshots:shots}));
}
function unpack(plain){
  const data=JSON.parse(plain.toString('utf8'));
  if(data.format!==format||data.schema!==schema)throw new Error('Unsupported backup format or schema');
  const decode=entry=>{if(!entry||typeof entry.data!=='string'||!/^[0-9a-f]{64}$/.test(entry.sha256||''))throw new Error('Backup entry missing');const value=Buffer.from(entry.data,'base64');if(digest(value)!==entry.sha256)throw new Error('Backup entry checksum mismatch');return value;};
  const entries=Object.fromEntries(files.map(name=>[name,decode(data.entries?.[name])]));
  const screenshots={};
  for(const [name,entry] of Object.entries(data.screenshots||{})){if(!screenshotName.test(name))throw new Error('Unsafe screenshot filename');screenshots[name]=decode(entry);}
  const projectData=JSON.parse(entries.projects.toString('utf8'));
  if(!Array.isArray(projectData.projects)||!projectData.projects.length)throw new Error('Invalid project configuration in backup');
  if(!entries.environment.toString('utf8').includes('WORKSPACE_TOKEN='))throw new Error('Backup environment is missing Workspace credentials');
  return {...entries,screenshots,createdAt:data.createdAt};
}
function decrypt(file,key){
  const envelope=JSON.parse(fs.readFileSync(file,'utf8'));
  if(envelope.magic!=='AI_DEV_WORKSPACE_BACKUP'||envelope.format!==format||![undefined,'gzip'].includes(envelope.compression)||![undefined,2].includes(envelope.envelopeVersion))throw new Error('Unsupported backup envelope');
  const iv=Buffer.from(envelope.iv,'base64'),tag=Buffer.from(envelope.tag,'base64');
  if(iv.length!==12||tag.length!==16)throw new Error('Invalid backup IV or authentication tag');
  const decipher=createDecipheriv('aes-256-gcm',secret(key),iv,{authTagLength:16});
  if(envelope.envelopeVersion===2)decipher.setAAD(Buffer.from(`AI_DEV_WORKSPACE_BACKUP|${format}|${envelope.compression||'none'}`));
  decipher.setAuthTag(tag);
  const plain=Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]);
  return unpack(envelope.compression==='gzip'?gunzipSync(plain):plain);
}
export function createBackup(options={}){
  const {dbFile,projectsFile,envFile,screenshotsDir,backupDir}=locations(options);
  const key=secret(options.key||process.env.WORKSPACE_BACKUP_KEY);
  if(!projectsFile||!envFile||!screenshotsDir)throw new Error('Custom database requires WORKSPACE_PROJECTS_FILE, WORKSPACE_BACKUP_ENV_FILE and WORKSPACE_SCREENSHOTS_DIR');
  assertNoInterruptedRestore([dbFile,projectsFile,envFile,screenshotsDir]);
  const keep=options.keep??14;
  if(!Number.isInteger(keep)||keep<1)throw new Error('Invalid backup retention count');
  if(!fs.existsSync(projectsFile)||!fs.existsSync(envFile))throw new Error('Workspace projects or environment file missing');
  fs.mkdirSync(backupDir,{recursive:true});
  const snapshotDir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-snapshot-'));
  const snapshot=path.join(snapshotDir,'snapshot.sqlite');
  const temp=path.join(backupDir,`.backup-${randomUUID()}.tmp`);
  try{
    const metadata=snapshotDatabase(dbFile,snapshot);
    const screenshots=readScreenshots(screenshotsDir);
    for(const name of metadata.screenshotRefs)if(!screenshots[name])throw new Error(`Referenced screenshot missing from backup: ${name}`);
    const plain=packageData(fs.readFileSync(snapshot),fs.readFileSync(projectsFile),fs.readFileSync(envFile),screenshots);
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
    cipher.setAAD(Buffer.from(`AI_DEV_WORKSPACE_BACKUP|${format}|gzip`));
    const ciphertext=Buffer.concat([cipher.update(gzipSync(plain)),cipher.final()]);
    const output={magic:'AI_DEV_WORKSPACE_BACKUP',format,envelopeVersion:2,compression:'gzip',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
    fs.writeFileSync(temp,JSON.stringify(output),{flag:'wx',mode:0o600});
    const name=`workspace-${new Date().toISOString().replaceAll(':','-')}-${randomUUID().slice(0,8)}.awbackup`;
    const target=path.join(backupDir,name);
    verifyBackup(temp,{...options,key:key.toString('hex')});
    fs.renameSync(temp,target);
    const backups=fs.readdirSync(backupDir).filter(item=>/^workspace-\d{4}-\d{2}-\d{2}T.*\.awbackup$/.test(item)).sort().reverse();
    const retained=new Set(backups.slice(0,keep)),days=new Set(backups.slice(0,keep).map(item=>item.slice('workspace-'.length,'workspace-YYYY-MM-DD'.length)));
    for(const item of backups.slice(keep)){
      const day=item.slice('workspace-'.length,'workspace-YYYY-MM-DD'.length);
      if(!days.has(day)&&days.size<30){days.add(day);retained.add(item);}
    }
    for(const item of backups)if(!retained.has(item))fs.rmSync(path.join(backupDir,item));
    return {file:target,tasks:metadata.tasks,screenshots:Object.keys(screenshots).length};
  }finally{fs.rmSync(snapshotDir,{recursive:true,force:true});fs.rmSync(temp,{force:true});}
}
export function verifyBackup(file,options={}){
  const data=decrypt(file,options.key||process.env.WORKSPACE_BACKUP_KEY);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-verify-'));
  const tmp=path.join(dir,'snapshot.sqlite');
  try{fs.writeFileSync(tmp,data.database,{flag:'wx',mode:0o600});const metadata=inspectDatabase(tmp);for(const name of metadata.screenshotRefs)if(!data.screenshots[name])throw new Error(`Referenced screenshot missing from backup: ${name}`);return {createdAt:data.createdAt,tasks:metadata.tasks,screenshots:Object.keys(data.screenshots).length,worktrees:metadata.worktrees.length};}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
}
export function restoreBackup(file,options={}){
  const {dbFile,projectsFile,envFile,screenshotsDir}=locations(options);
  if(!projectsFile||!envFile||!screenshotsDir)throw new Error('Custom database requires WORKSPACE_PROJECTS_FILE, WORKSPACE_BACKUP_ENV_FILE and WORKSPACE_SCREENSHOTS_DIR');
  assertNoInterruptedRestore([dbFile,projectsFile,envFile,screenshotsDir]);
  const data=decrypt(file,options.key||process.env.WORKSPACE_BACKUP_KEY);
  const id=randomUUID(), staged=[],replaced=[],installed=[];
  const dbStage=`${dbFile}.restore-${id}`;
  const writeStage=options.writeStage||((target,content)=>fs.writeFileSync(target,content,{flag:'wx',mode:0o600}));
  let metadata;
  try{
    fs.mkdirSync(path.dirname(dbFile),{recursive:true});
    staged.push([dbStage,dbFile]);writeStage(dbStage,data.database);
    metadata=inspectDatabase(dbStage);
    for(const name of metadata.screenshotRefs)if(!data.screenshots[name])throw new Error(`Referenced screenshot missing from backup: ${name}`);
    for(const row of metadata.worktrees){
      const worktree=row.worktree,expected=path.join(root,'worktrees',row.project_id,row.id);
      const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
      if(!path.isAbsolute(worktree)||!same(path.resolve(worktree),expected)||!fs.existsSync(worktree)||fs.lstatSync(worktree).isSymbolicLink()||!fs.statSync(worktree).isDirectory()||!same(fs.realpathSync(worktree),expected))
        throw new Error(`Referenced task worktree is missing or unsafe: ${worktree}`);
    }
    const configured=[[projectsFile,data.projects],...((options.restoreCredentials||!fs.existsSync(envFile))?[[envFile,data.environment]]:[])];
    for(const [target,content] of configured){
      const stage=`${target}.restore-${id}`;staged.push([stage,target]);writeStage(stage,content);
    }
    const shotStage=`${screenshotsDir}.restore-${id}`;staged.push([shotStage,screenshotsDir]);fs.mkdirSync(shotStage,{recursive:true});
    for(const [name,content] of Object.entries(data.screenshots))writeStage(path.join(shotStage,name),content);
    for(const suffix of ['', '-wal','-shm']){
      const target=`${dbFile}${suffix}`;
      if(fs.existsSync(target)){const rollback=`${target}.rollback-${id}`;fs.renameSync(target,rollback);replaced.push([rollback,target]);}
    }
    for(const [index,[stage,target]] of staged.entries()){
      options.beforeReplace?.(target,index);
      if(fs.existsSync(target)){const rollback=`${target}.rollback-${id}`;fs.renameSync(target,rollback);replaced.push([rollback,target]);}
      fs.renameSync(stage,target);
      installed.push(target);
    }
  }catch(error){
    const failures=[];
    for(const target of installed)try{if(fs.existsSync(target))fs.rmSync(target,{recursive:true,force:true});}catch(problem){failures.push(problem);}
    for(const [rollback,target] of replaced.reverse())try{if(fs.existsSync(target))fs.rmSync(target,{recursive:true,force:true});if(fs.existsSync(rollback))fs.renameSync(rollback,target);}catch(problem){failures.push(problem);}
    if(failures.length)throw new AggregateError([error,...failures],'Restore failed and rollback needs local recovery');
    throw error;
  }finally{
    for(const [stage] of staged)fs.rmSync(stage,{recursive:true,force:true});
    for(const suffix of ['', '-wal','-shm'])fs.rmSync(`${dbStage}${suffix}`,{force:true});
  }
  const cleanupPending=[];
  for(const [rollback] of replaced)try{(options.removeRollback||((target)=>fs.rmSync(target,{recursive:true,force:true})))(rollback);}catch{cleanupPending.push(rollback);}
  return {tasks:metadata.tasks,screenshots:Object.keys(data.screenshots).length,cleanupPending};
}

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {settings} from '../src/config.mjs';

const directory=path.dirname(fileURLToPath(import.meta.url));
const workspace=path.resolve(directory,'..');
const stateFile=path.join(workspace,'data','desktop-control.json');
const eventFile=path.join(workspace,'data','desktop-control-events.jsonl');
const recoveryLock=path.join(workspace,'data','desktop-control-recovery.lock');
const pipe='\\\\.\\pipe\\ai-dev-workspace-t8-control';
const action=process.argv[2];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const record=(event,details={})=>{
  try{fs.appendFileSync(eventFile,JSON.stringify({at:new Date().toISOString(),actor:'manager',actorPid:process.pid,event,...details})+'\n',{mode:0o600});return true;}
  catch(error){console.error('Control event log failed:',error);return false;}
};
const expectedData=path.join(workspace,'data','workspace.sqlite');
const expectedProjects=path.join(workspace,'data','t8-projects.json');
const expectedBackups=path.join(workspace,'backups');
const expectedEnv=path.join(workspace,'.env');
const expectedScreenshots=path.join(workspace,'data','screenshots');
const configuration=settings();
if(configuration.host!=='127.0.0.1'||configuration.port!==4178||path.resolve(process.env.WORKSPACE_DATA_FILE||expectedData)!==expectedData||path.resolve(process.env.WORKSPACE_PROJECTS_FILE||'')!==expectedProjects||path.resolve(process.env.WORKSPACE_BACKUP_DIR||expectedBackups)!==expectedBackups||path.resolve(process.env.WORKSPACE_BACKUP_ENV_FILE||expectedEnv)!==expectedEnv||path.resolve(process.env.WORKSPACE_SCREENSHOTS_DIR||expectedScreenshots)!==expectedScreenshots)
  throw new Error('Desktop control is limited to the isolated T8 port, database and project registry');
const serveMatches=()=>{
  try{
    const url=new URL(process.env.WORKSPACE_PUBLIC_URL);
    if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash)return false;
    const result=spawnSync('tailscale',['serve','status','--json'],{encoding:'utf8',windowsHide:true,timeout:10000});
    if(result.status!==0)return false;
    const data=JSON.parse(result.stdout);
    return data.TCP?.['443']?.HTTPS===true&&data.Web?.[`${url.hostname}:443`]?.Handlers?.['/']?.Proxy==='http://127.0.0.1:4178';
  }catch{return false;}
};
const safeToStop=()=>{
  const database=new DatabaseSync(expectedData,{readOnly:true});
  try{
    return database.prepare("select count(*) as count from tasks where status in ('RUNNING','QUEUED')").get().count===0&&
      database.prepare('select count(*) as count from workers where active_task is not null').get().count===0;
  }finally{database.close();}
};
const validOwnership=ownership=>{
  if(!ownership?.manager||!ownership.launcher||!ownership.server||!ownership.workers?.claude||!ownership.workers?.codex)return false;
  const items=[ownership.manager,ownership.launcher,ownership.server,ownership.workers.claude,ownership.workers.codex];
  if(items.some(item=>!Number.isInteger(item.pid)||typeof item.started!=='string'||!Number.isFinite(Date.parse(item.started))||String(item.executable).toLowerCase()!==process.execPath.toLowerCase()))return false;
  const start=Date.parse(ownership.manager.started),launcher=Date.parse(ownership.launcher.started);
  return start<=launcher&&[ownership.server,ownership.workers.claude,ownership.workers.codex].every(item=>Date.parse(item.started)>=launcher);
};
const inspect=(mode,state,recoveryPid=0)=>{
  const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(directory,'inspect.ps1'),mode];
  if(state)args.push('-ManagerPid',String(state.managerPid),'-LauncherPid',String(state.launcherPid));
  if(recoveryPid)args.push('-RecoveryPid',String(recoveryPid));
  if(mode==='on')args.push('-Snapshot');
  const result=spawnSync('powershell.exe',args,{encoding:'utf8',windowsHide:true,timeout:10000});
  if(result.status!==0)return {status:'UNKNOWN'};
  const output=result.stdout.trim();
  try{return output.startsWith('{')?JSON.parse(output):{status:output};}catch{return {status:'UNKNOWN'};}
};
const readState=()=>{
  if(!fs.existsSync(stateFile))return null;
  const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  if(state.workspace!==workspace||state.port!==4178||state.dataFile!==expectedData||state.projectsFile!==expectedProjects||state.backupDirectory!==expectedBackups||!Number.isInteger(state.managerPid)||!Number.isInteger(state.launcherPid)||!/^([0-9a-f]{64})$/.test(state.token))throw new Error('Desktop control state is invalid');
  return state;
};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const processGone=identity=>{
  try{process.kill(identity.pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}
};
const transitionLock=()=>{
  let handle;
  try{handle=fs.openSync(recoveryLock,'wx',0o600);}
  catch(error){if(error.code==='EEXIST')throw new Error('UNKNOWN: another T8 start or recovery is in progress');throw error;}
  fs.writeSync(handle,JSON.stringify({pid:process.pid,at:new Date().toISOString(),action}));
  fs.closeSync(handle);
  let released=false;
  return ()=>{if(!released){released=true;fs.unlinkSync(recoveryLock);}};
};
const saveOwnership=(state,ownership)=>{
  const previous=state.ownership;
  if(previous&&!validOwnership(previous))return false;
  const changed=previous&&!same(previous,ownership);
  const safeReplacement=changed&&same(previous.manager,ownership.manager)&&same(previous.launcher,ownership.launcher)&&
    (same(previous.server,ownership.server)||processGone(previous.server))&&
    ['claude','codex'].every(slot=>same(previous.workers[slot],ownership.workers[slot])||processGone(previous.workers[slot]));
  if(changed&&!safeReplacement)return false;
  if(!previous||changed){
    const temporary=`${stateFile}.${randomBytes(8).toString('hex')}.tmp`;
    fs.writeFileSync(temporary,JSON.stringify({...state,ownership}),{flag:'wx',mode:0o600});
    fs.renameSync(temporary,stateFile);
    record('ownership-snapshot',{manager:ownership.manager,launcher:ownership.launcher,server:ownership.server,workers:ownership.workers});
  }
  return true;
};
const request=(token,operation)=>new Promise((resolve,reject)=>{
  const socket=net.connect(pipe);let received='';
  socket.setTimeout(5000,()=>socket.destroy(new Error('Workspace control connection timed out')));
  socket.on('connect',()=>socket.write(`${token} ${operation}\n`));
  socket.on('data',chunk=>received+=chunk);
  socket.on('end',()=>resolve(received.trim()));
  socket.on('error',reject);
});
async function status(){
  let state;
  try{state=readState();}catch{return 'UNKNOWN';}
  if(!state)return inspect('off',{managerPid:process.pid,launcherPid:0}).status;
  try{if(await request(state.token,'status')!=='running')return 'UNKNOWN';}catch{return 'UNKNOWN';}
  state=readState();
  const live=inspect('on',state);
  const ownership={manager:live.manager,launcher:live.launcher,server:live.server,workers:live.workers};
  if(live.status!=='ON'||!validOwnership(ownership)||!serveMatches())return 'UNKNOWN';
  try{
    const reply=await request(state.token,`snapshot ${Buffer.from(JSON.stringify(ownership)).toString('base64')}`);
    if(reply==='saved')return 'ON';
  }catch{}
  // A manager started immediately before this protocol update may close a long
  // snapshot request. Its already recorded identity must still match exactly.
  try{return same(readState().ownership,ownership)&&await request(state.token,'status')==='running'?'ON':'UNKNOWN';}
  catch{return 'UNKNOWN';}
}

if(action==='status'){
  console.log(await status());
}else if(action==='stop'){
  const current=await status();
  if(current==='OFF'){console.log('not-running');process.exit(0);}
  if(current!=='ON')throw new Error(`Workspace ownership is ${current}; refusing to stop unknown processes`);
  if(!safeToStop())throw new Error('T8 has a running or queued task; refusing to stop');
  const state=readState();
  const reply=await request(state.token,'stop');
  if(reply!=='stopping')throw new Error('Authenticated Workspace stop request was refused');
  for(let i=0;i<50&&fs.existsSync(stateFile);i++)await wait(1000);
  if(fs.existsSync(stateFile))throw new Error('Workspace stop did not complete; state preserved for inspection');
  for(let i=0;i<10&&await status()!=='OFF';i++)await wait(500);
  if(await status()!=='OFF')throw new Error('Workspace server or worker remains after stop');
  console.log('stopped');
}else if(action==='start'){
  const releaseTransition=transitionLock();
  let child;
  try{
    const current=await status();
    if(current!=='OFF')throw new Error(`Workspace ownership is ${current}; refusing to start`);
    if(!serveMatches())throw new Error('Tailscale private Serve is not mapped to 127.0.0.1:4178');
    fs.mkdirSync(path.dirname(stateFile),{recursive:true});
    const log=fs.openSync(path.join(workspace,'data','desktop-control.log'),'a',0o600);
    try{child=spawn(process.execPath,['src/local.mjs'],{cwd:workspace,windowsHide:true,env:{...process.env,WORKSPACE_DESKTOP_CONTROL:'1'},stdio:['ignore',log,log,'ipc']});}
    finally{fs.closeSync(log);}
    record('launcher-start',{launcherPid:child.pid,executable:process.execPath,workspace,port:4178,dataFile:expectedData});
  }catch(error){releaseTransition();throw error;}
  const token=randomBytes(32).toString('hex');
  let stopping=false;
  let startupFailure=false;
  const stop=()=>{if(stopping)return;stopping=true;if(child.connected)child.send('stop');};
  const server=net.createServer(socket=>{
    let request='';socket.setTimeout(5000,()=>socket.destroy());
    socket.on('error',error=>record('ipc-client-error',{code:error.code||'UNKNOWN'}));
    socket.on('data',chunk=>{
      request+=chunk;
      if(request.length>4096){socket.destroy();return;}
      if(request.includes('\n')){
        if(request.trim()===`${token} status`){
          socket.end(child.exitCode===null?'running\n':'unknown\n');
        }
        else if(request.startsWith(`${token} snapshot `)){
          try{
            if(stopping||child.exitCode!==null){socket.end('unknown\n');return;}
            const ownership=JSON.parse(Buffer.from(request.trim().slice(`${token} snapshot `.length),'base64').toString('utf8'));
            if(!validOwnership(ownership)||ownership.manager.pid!==process.pid||ownership.launcher.pid!==child.pid){socket.end('unknown\n');return;}
            socket.end(saveOwnership(readState(),ownership)?'saved\n':'unknown\n');
          }catch(error){record('snapshot-error',{message:error.message});socket.end('unknown\n');}
        }
        else if(request.trim()===`${token} stop`){
          try{if(!safeToStop()){record('stop-denied-busy');socket.end('busy\n');return;}record('stop-request',{authenticated:true});stop();socket.end('stopping\n');}
          catch(error){record('stop-check-error',{message:error.message});socket.end('unknown\n');}
        }
        else socket.end('denied\n');
      }
    });
  });
  server.on('error',error=>{record('ipc-server-error',{message:error.message,code:error.code});startupFailure=true;releaseTransition();stop();process.exitCode=1;});
  server.listen(pipe,()=>{
    if(child.exitCode!==null)return;
    try{fs.writeFileSync(stateFile,JSON.stringify({workspace,port:4178,dataFile:expectedData,projectsFile:expectedProjects,backupDirectory:expectedBackups,managerPid:process.pid,launcherPid:child.pid,token}),{flag:'wx',mode:0o600});record('manager-start',{launcherPid:child.pid});}
    catch(error){record('state-create-error',{message:error.message});startupFailure=true;stop();process.exitCode=1;}
    finally{releaseTransition();}
  });
  child.on('exit',async(code,signal)=>{
    releaseTransition();
    record('launcher-exit',{launcherPid:child.pid,code,signal,normalStopRequested:stopping});
    try{server.close();}catch{}
    const self={managerPid:process.pid,launcherPid:child.pid};
    for(let i=0;i<20&&inspect('off',self).status!=='OFF';i++)await wait(500);
    if(inspect('off',self).status==='OFF'){
      try{const current=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(current.managerPid===process.pid)fs.unlinkSync(stateFile);}catch{}
      spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(directory,'set-icon.ps1'),'off'],{windowsHide:true,stdio:'ignore',timeout:5000});
      const exitCode=!startupFailure&&stopping&&code===0?0:1;
      record('manager-exit',{code:exitCode,normalStopRequested:stopping,launcherCode:code});
      process.exit(exitCode);
    }
    // Preserve the state and icon when an orphan server or worker remains.
    record('manager-exit',{code:1,normalStopRequested:stopping,reason:'orphan-process-or-listener'});
    process.exit(1);
  });
  process.on('SIGINT',()=>{record('signal',{signal:'SIGINT'});stop();});process.on('SIGTERM',()=>{record('signal',{signal:'SIGTERM'});stop();});
  process.on('uncaughtException',error=>{record('exception',{message:error.message,stack:error.stack});process.exit(1);});
  process.on('exit',code=>record('process-exit',{code,normalStopRequested:stopping}));
}else if(action==='recover'){
  const releaseTransition=transitionLock();
  try{
  const state=readState();
  if(!state){console.log('already-off');}
  else{
  if(!validOwnership(state.ownership))throw new Error('UNKNOWN: saved process identity is incomplete');
  if(inspect('off').status!=='OFF')throw new Error('A T8 controller, server, listener or worker still exists');
  const identities=[state.ownership?.manager,state.ownership?.launcher,state.ownership?.server,state.ownership?.workers?.claude,state.ownership?.workers?.codex].filter(Boolean);
  for(const identity of identities){
    if(!Number.isInteger(identity.pid))throw new Error('Invalid saved process identity');
    if(!processGone(identity))throw new Error(`UNKNOWN: saved process ${identity.pid} still exists`);
  }
  if(!safeToStop())throw new Error('T8 has a running or queued task; refusing stale-state recovery');
  if(inspect('off').status!=='OFF')throw new Error('UNKNOWN: T8 process changed during recovery');
  const archive=path.join(workspace,'data',`desktop-control-stale-${Date.now()}.json`);
  const reservation=net.createServer();
  try{
    await new Promise((resolve,reject)=>{
      reservation.once('error',reject);
      reservation.listen({host:'127.0.0.1',port:4178,exclusive:true},()=>{reservation.off('error',reject);resolve();});
    });
    if(inspect('off',null,process.pid).status!=='OFF'||!safeToStop())throw new Error('UNKNOWN: T8 ownership or work changed while the port was reserved');
    if(!record('stale-recovery-intent',{archive,previousState:{workspace:state.workspace,port:state.port,dataFile:state.dataFile,projectsFile:state.projectsFile,backupDirectory:state.backupDirectory,ownership:state.ownership},evidence:{off:true,noActiveTask:true,portReservedBy:process.pid}}))throw new Error('UNKNOWN: recovery evidence could not be recorded');
    fs.renameSync(stateFile,archive);
    if(!record('stale-recovery-complete',{archive}))throw new Error('State archived but recovery completion could not be recorded');
  }finally{if(reservation.listening)await new Promise(resolve=>reservation.close(resolve));}
  if(await status()!=='OFF')throw new Error('Stale state archived but Workspace did not become OFF');
  const icon=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(directory,'set-icon.ps1'),'off'],{windowsHide:true,stdio:'ignore',timeout:5000});
  if(icon.status!==0)throw new Error('State archived but desktop icon could not be updated');
  console.log(`stale-state-archived ${archive}`);
  }
  }finally{releaseTransition();}
}else throw new Error('Usage: node control.mjs start|stop|status|recover');

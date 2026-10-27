import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

// Keep this sidecar in place: renaming the live DB must not change its lock.
// SQLite releases the OS lock even if its owning server/restorer is killed.
export function acquireDatabaseLock(file){
  const absolute=path.resolve(file);
  fs.mkdirSync(path.dirname(absolute),{recursive:true});
  const canonical=fs.existsSync(absolute)?fs.realpathSync(absolute):path.join(fs.realpathSync(path.dirname(absolute)),path.basename(absolute));
  const lockFile=`${canonical}.lifecycle-lock.sqlite`;
  try{fs.writeFileSync(lockFile,'',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
  if(!fs.lstatSync(lockFile).isFile()||fs.lstatSync(lockFile).isSymbolicLink())throw new Error('Invalid Workspace database lifecycle lock');
  const lock=new DatabaseSync(lockFile);
  try{
    lock.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE');
  }catch(error){
    lock.close();
    throw new Error('Workspace database is in use; stop its server and wait for restore to finish',{cause:error});
  }
  let closed=false;
  return ()=>{if(!closed){lock.close();closed=true;}};
}

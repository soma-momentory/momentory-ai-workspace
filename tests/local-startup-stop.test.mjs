import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {backupFixture} from './backup-fixture.mjs';

const root=path.resolve(import.meta.dirname,'..');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function freePort(){
  return new Promise(resolve=>{
    const server=net.createServer();
    server.listen(0,'127.0.0.1',()=>{
      const port=server.address().port;
      server.close(()=>resolve(port));
    });
  });
}

test('launcher exits cleanly when stopped during and just after server startup',async()=>{
  for(const phase of ['immediate','server-ready']){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-early-stop-'));
    const db=path.join(dir,'workspace.sqlite');
    const port=await freePort();
    assert.ok(![4178,4195].includes(port));
    const token=randomBytes(32).toString('hex');
    const workerToken=randomBytes(32).toString('hex');
    const env={...process.env,WORKSPACE_HOST:'127.0.0.1',WORKSPACE_PORT:String(port),WORKSPACE_TOKEN:token,WORKER_TOKEN:workerToken,WORKSPACE_DATA_FILE:db,WORKSPACE_DESKTOP_CONTROL:'0',...backupFixture(db,token,workerToken)};
    const child=spawn(process.execPath,['src/local.mjs'],{cwd:root,env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
    let output='';
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>output=(output+chunk.toString()).slice(-4000));
    const exited=new Promise(resolve=>child.once('exit',resolve));
    if(phase==='server-ready'){
      let ready=false;
      for(let i=0;i<100;i++){
        try{if((await fetch(`http://127.0.0.1:${port}/api/session`)).status===401){ready=true;break;}}catch{}
        await wait(50);
      }
      assert.equal(ready,true,`Server did not become ready: ${output}`);
    }
    child.send('stop');
    const timeout=new Promise(resolve=>setTimeout(()=>resolve(null),30000).unref());
    const code=await Promise.race([exited,timeout]);
    assert.equal(code,0,`${phase} stop: ${output}`);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/api/session`));
  }
});

import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {wslCodexConfig} from '../src/wslCodex.mjs';

if(process.platform!=='win32')throw new Error('Windows WSL required');
const cwd=path.resolve(process.env.WORKSPACE_TEST_BE_WORKTREE||'../ai-dev-workspace-sample'),config=wslCodexConfig(cwd);
const code=`const net=require('node:net');const s=net.createServer(c=>c.end('LOOPBACK_OK'));s.listen(0,'127.0.0.1',()=>{const c=net.connect(s.address().port,'127.0.0.1');c.on('data',v=>process.stdout.write(v));c.on('end',()=>{const out=net.connect({host:'1.1.1.1',port:80});out.setTimeout(1000,()=>out.destroy(Error('timeout')));out.on('error',()=>{process.stdout.write(' EGRESS_DENIED');s.close()});out.on('connect',()=>{process.stdout.write(' EGRESS_OPEN');out.destroy();s.close()})});c.on('error',e=>{console.error(e);process.exitCode=1})});`;
const args=['-d',config.distro,'--exec','/usr/bin/unshare','-Urn','/bin/sh','-c','/usr/sbin/ip link set lo up && exec "$@"','outer','/usr/bin/env',`CODEX_HOME=${config.codexHome}`,config.binary,'sandbox','-p',config.checkProfile,'-P','workspace-check-locked','-C',config.worktree,'--',`${config.home}/.local/node_modules/node/bin/node`,'-e',code];
const result=spawnSync('wsl.exe',args,{encoding:'utf8',timeout:60000,windowsHide:true});
assert.equal(result.status,0,result.stderr);
assert.match(result.stdout,/LOOPBACK_OK/);
assert.match(result.stdout,/EGRESS_DENIED/);
assert.doesNotMatch(result.stdout,/EGRESS_OPEN/);
console.log(JSON.stringify({status:'PASS',isolatedLoopback:true,externalEgressDenied:true}));

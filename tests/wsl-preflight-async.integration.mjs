import assert from 'node:assert/strict';
import path from 'node:path';
import {verifyWslCodexBoundary,wslTrustedCommandLaunch,asynchronousProbe,activeWslCodexForWorktree} from '../src/wslCodex.mjs';
import {verifyWslSetupBoundary} from '../src/wslChecks.mjs';
import {runProvider} from '../src/provider.mjs';

if(process.platform!=='win32')throw new Error('Windows WSL required');
const cwd=path.resolve('../ai-dev-workspace-sample');
let beats=0;const heartbeat=setInterval(()=>beats++,50);
try{
  await verifyWslCodexBoundary(cwd);
  await verifyWslSetupBoundary(cwd);
  const timedOut=await asynchronousProbe(wslTrustedCommandLaunch(cwd,['/bin/sh','-c','sleep 30']),1000);
  assert.equal(timedOut.status,null,'The injected slow probe must time out');
  assert.deepEqual(activeWslCodexForWorktree(cwd),[],'A timed-out probe must leave no Linux scope active');
  assert.ok(beats>=2,`Preflight blocked the worker heartbeat event loop: ${beats} ticks`);
  const controller=new AbortController();setTimeout(()=>controller.abort(),50);
  const cancelled=await runProvider({provider:'codex',cwd,prompt:'No work should start.',readOnly:true,signal:controller.signal,timeoutMs:30000});
  assert.equal(cancelled.ok,false);assert.match(cancelled.stderr,/Cancelled before provider start/);
  assert.equal(cancelled.sessionId,null);
  console.log(JSON.stringify({status:'PASS',heartbeatTicks:beats,providerBoundary:true,setupBoundary:true,timedOutProbeReaped:true,cancelledDuringPreflight:true}));
}finally{clearInterval(heartbeat);}

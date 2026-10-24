import test from 'node:test';
import assert from 'node:assert/strict';
import { probeProvider } from '../src/provider.mjs';

test('real Claude and Codex CLI authentication and streaming', {skip:process.env.RUN_PROVIDER_INTEGRATION!=='1'},async()=>{
  for(const provider of ['claude','codex']) {
    const result=await probeProvider(provider,process.cwd());
    assert.equal(result.ok,true,`${provider}: ${result.stderr}`);
    assert.match(result.result,/MOMENTORY_PROVIDER_OK/);
    assert.ok(result.sessionId);
  }
});

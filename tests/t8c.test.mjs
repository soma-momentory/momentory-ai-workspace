import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createIsolatedCodexClone,git} from '../src/git.mjs';

test('Windows Codex clone has self-contained Git metadata usable from WSL',()=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'t8c-git-'));
  const source=path.join(base,'source'),target=path.join(base,'codex');
  fs.mkdirSync(source);
  try{
    git(source,'init','-b','test');
    fs.writeFileSync(path.join(source,'index.mjs'),'export const answer = 42;\n');
    git(source,'add','-A');
    git(source,'-c','user.name=Workspace Test','-c','user.email=test@workspace.invalid','commit','-m','fixture');
    const head=git(source,'rev-parse','HEAD');
    createIsolatedCodexClone(source,target,head,`workspace/${randomUUID()}`);
    assert.ok(fs.statSync(path.join(target,'.git')).isDirectory());
    assert.equal(fs.existsSync(path.join(target,'.git','objects','info','alternates')),false);
    assert.equal(git(target,'remote'),'', 'Clone must not retain a source repository remote');
    assert.equal(git(target,'status','--porcelain'),'');
    assert.equal(git(target,'rev-parse','HEAD'),head);
    if(process.platform==='win32'){
      const linux=execFileSync('wsl.exe',['-d',process.env.WORKSPACE_WSL_DISTRO||'Ubuntu','--exec','/usr/bin/wslpath','-u',target.replaceAll('\\','/')],{encoding:'utf8',timeout:15000}).trim();
      const status=execFileSync('wsl.exe',['-d',process.env.WORKSPACE_WSL_DISTRO||'Ubuntu','--exec','/usr/bin/git','-C',linux,'status','--porcelain'],{encoding:'utf8',timeout:15000}).trim();
      assert.equal(status,'');
    }
  }finally{
    // Preserve the probe clone for inspection; this test never recursively deletes a copy.
  }
});

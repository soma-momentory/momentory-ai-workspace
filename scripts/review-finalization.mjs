import fs from 'node:fs';
import path from 'node:path';
import {root} from '../src/config.mjs';
import {runProvider} from '../src/provider.mjs';

const provider=process.argv[2];
const continued=process.argv[3];
if(!['claude','codex'].includes(provider))throw new Error('Pass claude or codex');
const focused=process.env.WORKSPACE_REVIEW_FOCUSED==='1';
const last=process.env.WORKSPACE_REVIEW_FOCUSED==='last';
const optionsReview=process.env.WORKSPACE_REVIEW_FOCUSED==='options';
const prompt=optionsReview?`Re-review only your latest finding: passing options.dbFile alone to createBackup or restoreBackup could mix a custom database with the primary instance's projects and screenshots. Inspect src/backup.mjs and tests/backup.test.mjs now. Begin PASS or FIX_REQUIRED, citing only a remaining concrete failure. Read-only shell commands are permitted. Do not edit or read credentials.`:last?`Re-review only the latest two release-blocking findings on this revised source: (1) a custom WORKSPACE_DATA_FILE could back up or restore the primary instance's projects or screenshots, and (2) backup:create could create an empty database after an interrupted restore. Inspect src/backup.mjs, scripts/backup.mjs, src/local.mjs, src/config.mjs, tests/backup-fixture.mjs and tests/backup.test.mjs. Begin PASS or FIX_REQUIRED and list concrete remaining issues with file/line evidence. Do not edit files. ${provider==='codex'?'Read-only shell commands are permitted.':'Do not execute shell commands.'} Do not read credentials.`:focused?`Re-review the current Windows finalization fixes in this repository. The first independent reviews found restore cleanup data loss, mixed custom-instance backup paths, verification plaintext near backups, stale credentials, corrupt JSON event redaction, incomplete screenshot races, and partial staging artifacts. Read the actual revised source and focused tests. Report only remaining concrete correctness or security defects with file and line references. Begin PASS, FIX_REQUIRED, or INSUFFICIENT_EVIDENCE. Do not edit files. ${provider==='codex'?'Read-only shell commands such as rg, sed, and git diff are permitted.':'Do not execute shell commands.'} Do not read .env, backups, or credentials.`:
  `Independently review the current uncommitted Windows release finalization changes in this repository. Read src/backup.mjs, scripts/backup.mjs, src/config.mjs, src/local.mjs, src/store.mjs, src/server.mjs and the new or edited tests. Focus on encrypted backup consistency and restore rollback, sensitive-data handling, authentication and CSRF boundaries, and whether the integration tests truly prove their claims. Identify concrete correctness or security defects with file and line references. Begin with PASS, FIX_REQUIRED, or INSUFFICIENT_EVIDENCE. Do not edit files. ${provider==='codex'?'Read-only shell commands such as rg, sed, and git diff are permitted to inspect source.':'Do not execute shell commands.'} Do not read .env, backups, or provider credentials.`;
const result=await runProvider({provider,cwd:process.env.WORKSPACE_REVIEW_CWD||root,prompt:continued?'Stop reading files and give your verdict now from what you already inspected. Begin PASS, FIX_REQUIRED, or INSUFFICIENT_EVIDENCE and list only concrete remaining issues with file and line evidence. Do not use tools or edit files.':prompt,sessionId:continued||null,readOnly:true,timeoutMs:continued?120000:240000});
const dir=path.join(root,'data','reviews');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,`${provider}-finalization-${Date.now()}.json`);
fs.writeFileSync(file,JSON.stringify(result,null,2));
console.log(JSON.stringify({provider,ok:result.ok,sessionId:result.sessionId,result:result.result,file},null,2));
if(!result.ok)process.exitCode=1;

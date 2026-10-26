import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const screenshotDirectory = () => path.resolve(process.env.WORKSPACE_SCREENSHOTS_DIR||path.join(root,'data','screenshots'));
export function loadEnv(file = path.join(root, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z_][A-Z_0-9]*)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

export function assertNoInterruptedRestore(targets) {
  for(const target of targets){
    const dir=path.dirname(target),name=path.basename(target);
    if(fs.existsSync(dir)&&fs.readdirSync(dir).some(entry=>[name,`${name}-wal`,`${name}-shm`].some(prefix=>entry.startsWith(`${prefix}.restore-`)||entry.startsWith(`${prefix}.rollback-`))))
      throw new Error(`Interrupted Workspace restore requires local recovery: ${target}`);
  }
}

export function settings() {
  loadEnv(process.env.WORKSPACE_DATA_FILE&&process.env.WORKSPACE_BACKUP_ENV_FILE?process.env.WORKSPACE_BACKUP_ENV_FILE:path.join(root,'.env'));
  const database=process.env.WORKSPACE_DATA_FILE||path.join(root,'data','workspace.sqlite');
  assertNoInterruptedRestore([database,process.env.WORKSPACE_PROJECTS_FILE||path.join(root,'projects.json'),process.env.WORKSPACE_BACKUP_ENV_FILE||path.join(root,'.env'),screenshotDirectory()]);
  const host = process.env.WORKSPACE_HOST || '127.0.0.1';
  const port = Number(process.env.WORKSPACE_PORT || 4178);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid WORKSPACE_PORT');
  if (!process.env.WORKSPACE_TOKEN || process.env.WORKSPACE_TOKEN.length < 32)
    throw new Error('WORKSPACE_TOKEN must contain at least 32 characters');
  if (!process.env.WORKER_TOKEN || process.env.WORKER_TOKEN.length < 32)
    throw new Error('WORKER_TOKEN must contain at least 32 characters');
  if (process.env.WORKER_TOKEN === process.env.WORKSPACE_TOKEN)
    throw new Error('Worker and user tokens must differ');
  if (host !== '127.0.0.1' && host !== '::1') throw new Error('Workspace must bind to loopback; use Tailscale Serve for remote access');
  if(process.env.WORKSPACE_PUBLIC_URL && !/^https:\/\/[^/]+$/.test(process.env.WORKSPACE_PUBLIC_URL)) throw new Error('WORKSPACE_PUBLIC_URL must be an HTTPS origin without a path');
  return { host, port, token: process.env.WORKSPACE_TOKEN, workerToken: process.env.WORKER_TOKEN };
}

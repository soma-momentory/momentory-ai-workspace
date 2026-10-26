import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {root} from '../src/config.mjs';
const file=path.join(root,'.env');
if(fs.existsSync(file))throw new Error('.env already exists; existing credentials were preserved');
const token=()=>randomBytes(32).toString('hex');
fs.writeFileSync(file,`WORKSPACE_TOKEN=${token()}\nWORKER_TOKEN=${token()}\nWORKSPACE_BACKUP_KEY=${token()}\nWORKSPACE_HOST=127.0.0.1\nWORKSPACE_PORT=4178\n`,{flag:'wx',mode:0o600});
console.log(`Created ${file} with distinct random tokens. The file is ignored by Git.`);

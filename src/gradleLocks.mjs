import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const gradleLockfiles=Object.freeze(['gradle.lockfile','buildscript-gradle.lockfile']);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

// Hash the bytes Gradle will read, rather than a Git blob (which may have LF
// while a Windows checkout has CRLF). Reject aliases and missing files first.
export function verifyGradleLocks(directory,approved){
  const hashes={};
  for(const name of gradleLockfiles){
    const file=path.resolve(directory,name),stat=fs.lstatSync(file,{throwIfNoEntry:false});
    if(!stat?.isFile()||stat.isSymbolicLink()||stat.nlink!==1||fs.realpathSync(file)!==file)throw new Error(`Gradle lockfile missing or aliases another path: ${name}`);
    hashes[name]=sha256(fs.readFileSync(file));
    if(approved&&(!/^[a-f0-9]{64}$/.test(approved[name]||'')||hashes[name]!==approved[name]))throw new Error(`Gradle lockfile checksum changed: ${name}`);
  }
  return hashes;
}

// This runs inside the isolated Linux execution boundary immediately before
// Gradle, against that boundary's visible bytes. The expected values come
// from the approved policy or from the prepared worktree marker.
export function gradleLockPreflight(hashes){
  for(const name of gradleLockfiles)if(!/^[a-f0-9]{64}$/.test(hashes?.[name]||''))throw new Error('Gradle lockfile approval is missing');
  return gradleLockfiles.map(name=>`test "$(/usr/bin/sha256sum ${name} | /usr/bin/cut -d ' ' -f1)" = '${hashes[name]}' || { echo 'Gradle lockfile checksum changed: ${name}' >&2; exit 23; }`).join('; ');
}

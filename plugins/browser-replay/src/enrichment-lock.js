import { lstat, unlink } from 'node:fs/promises';
import lockfile from 'proper-lockfile';

export const LOCK_STALE_MS = 60000;
export const LEGACY_LOCK_STALE_MS = 15 * 60000;

export async function acquireEnrichmentLock(scriptPath) {
  const lockPath = scriptPath+'.enrichment.lock';
  // Older versions created empty regular files without a PID or heartbeat.
  // Give those the full enrichment budget before considering them abandoned.
  try {
    const previous = await lstat(lockPath);
    if (previous.isFile()) {
      if (Date.now() - previous.mtimeMs <= LEGACY_LOCK_STALE_MS) {
        throw new Error('Enrichment is already running or a recent legacy lock exists; legacy locks expire after 15 minutes');
      }
      await unlink(lockPath).catch(error => {
        // Another contender may already have migrated it to a directory lock.
        if (!['ENOENT','EISDIR','EPERM'].includes(error.code)) throw error;
      });
    } else if (!previous.isDirectory()) {
      throw new Error('Enrichment lock is not a regular file or directory; refusing to follow it');
    }
  } catch(error) {if (error.code !== 'ENOENT') throw error;}
  let compromised;
  const release = await lockfile.lock(scriptPath,{
    lockfilePath:lockPath,stale:LOCK_STALE_MS,update:10000,retries:0,
    onCompromised:error => {compromised = error;}
  }).catch(error => {
    if (error.code === 'ELOCKED') throw new Error('Enrichment is already running for this script; an abandoned lock expires after 60 seconds without a heartbeat');
    throw error;
  });
  return {
    assertOwned() {if (compromised) throw new Error(`Enrichment lock was lost: ${compromised.message}`);},
    async release() {
      try {await release();} catch(error) {if (error.code !== 'ERELEASED') throw error;}
    }
  };
}

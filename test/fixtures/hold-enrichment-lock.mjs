import { acquireEnrichmentLock } from '../../plugins/browser-replay/src/enrichment-lock.js';
await acquireEnrichmentLock(process.argv[2]);
process.send('locked');
setInterval(() => {},1000);

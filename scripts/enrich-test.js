import { parseArgs } from 'node:util';
import { enrichReplay } from '../plugins/browser-replay/src/enrich.js';

try {
  const {values,positionals} = parseArgs({allowPositionals:true,options:{'max-attempts':{type:'string',default:'3'},workspace:{type:'string'},help:{type:'boolean'}}});
  if (values.help) {
    console.log('Usage: node scripts/enrich-test.js <session.mjs> <session.json> [--max-attempts 1..3] [--workspace /project]');
  } else {
    if (positionals.length !== 2) throw new Error('Provide the exported .mjs and .json paths. Use --help for usage.');
    const result = await enrichReplay({scriptPath:positionals[0],recordingPath:positionals[1],workspace:values.workspace,maxAttempts:Number(values['max-attempts'])});
    console.log(JSON.stringify(result,null,2));
  }
} catch(error) {console.error(error.message);process.exitCode = 1;}

import { spawn } from 'node:child_process';

// No shell interpolation. Kill the entire process group, including browser children.
export function runProcess(command, args, {cwd, env = process.env, timeoutMs = 60000, maxOutput = 256000} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe'],detached:process.platform !== 'win32'});
    let stdout = '', stderr = '', timedOut = false, overflow = false;
    const kill = () => {
      try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid,'SIGKILL'); } catch(error) {if (error.code !== 'ESRCH') child.kill('SIGKILL');}
    };
    const timer = setTimeout(() => {timedOut = true; kill();},timeoutMs);
    const collect = (type, chunk) => {
      if (stdout.length + stderr.length + chunk.length > maxOutput) {overflow = true; kill(); return;}
      if (type === 'stdout') stdout += chunk; else stderr += chunk;
    };
    child.stdout.on('data',chunk => collect('stdout',chunk.toString()));
    child.stderr.on('data',chunk => collect('stderr',chunk.toString()));
    child.on('error',error => {clearTimeout(timer);reject(error);});
    child.on('close',(code,signal) => {clearTimeout(timer);resolve({code,signal,stdout,stderr,timedOut,overflow});});
  });
}

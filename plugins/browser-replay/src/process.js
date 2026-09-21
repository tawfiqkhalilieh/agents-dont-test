import { spawn } from 'node:child_process';

export function checkCancelled(signal) {
  if (signal?.aborted) throw Object.assign(new Error('Operation cancelled'),{name:'AbortError',code:'ABORT_ERR'});
}

// No shell interpolation. On POSIX, stop the entire process group, including browsers.
export function runProcess(command, args, {cwd, env = process.env, timeoutMs = 60000, maxOutput = 256000, signal} = {}) {
  return new Promise((resolve, reject) => {
    checkCancelled(signal);
    const child = spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe'],detached:process.platform !== 'win32'});
    const stdout = [], stderr = [];
    let bytes = 0, timedOut = false, overflow = false;
    const kill = () => {
      if (!child.pid) return;
      try { if (process.platform === 'win32') child.kill('SIGKILL'); else process.kill(-child.pid,'SIGKILL'); }
      catch(error) {if (error.code !== 'ESRCH') child.kill('SIGKILL');}
    };
    signal?.addEventListener('abort',kill,{once:true});
    const timer = setTimeout(() => {timedOut = true; kill();},timeoutMs);
    const cleanup = () => {clearTimeout(timer);signal?.removeEventListener('abort',kill);};
    const collect = (target,chunk) => {
      bytes += chunk.length;
      if (bytes > maxOutput) {overflow = true; kill(); return;}
      target.push(chunk);
    };
    child.stdout.on('data',chunk => collect(stdout,chunk));
    child.stderr.on('data',chunk => collect(stderr,chunk));
    child.on('error',error => {cleanup();reject(error);});
    child.on('close',(code,exitSignal) => {
      cleanup();
      try {checkCancelled(signal);} catch(error) {reject(error);return;}
      resolve({code,signal:exitSignal,stdout:Buffer.concat(stdout).toString('utf8'),stderr:Buffer.concat(stderr).toString('utf8'),timedOut,overflow});
    });
    if (signal?.aborted) kill();
  });
}

import { spawn } from 'node:child_process';
// A pipe belongs to the Host, unlike PID files. Even SIGKILL closes it, letting
// this small supervisor reap an unmodified mactop or bundled Go collector.
const [binary, ...args] = process.argv.slice(2);
if (!binary) process.exit(1);
const child = spawn(binary, args, { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, detached: process.platform !== 'win32' });
let closing = false;
let deadline: ReturnType<typeof setTimeout> | undefined;
function stop() {
  if (closing) return; closing = true;
  // Unix installers such as Homebrew fork descendants. A new process group lets
  // one signal cover them; Windows Job Objects already contain the direct child.
  if (child.pid && process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  } else child.kill('SIGTERM');
  deadline = setTimeout(() => {
    if (child.pid && process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    } else child.kill('SIGKILL');
  }, 500);
}
process.stdin.resume();
process.stdin.on('end', stop); process.stdin.on('error', stop);
process.on('SIGTERM', stop); process.on('SIGINT', stop);
child.once('error', error => { console.error(error.message); process.exit(1); });
child.once('close', (code, signal) => { clearTimeout(deadline); process.exit(closing ? 0 : code === null || signal ? 1 : code); });

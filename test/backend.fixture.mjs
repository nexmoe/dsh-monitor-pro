import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// One fixture supports both readiness protocols and isolated Host/installer
// subprocesses. It never discovers or invokes a real native tool or Homebrew.
const [role, ...args] = process.argv.slice(2);
const flags = Object.fromEntries(args.reduce((pairs, value, index) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), args[index + 1]]);
  return pairs;
}, []));
const record = flags.record ?? process.env.BACKEND_FIXTURE_RECORD;
const note = (event, fields = {}) => {
  if (record) appendFileSync(record, `${JSON.stringify({ event, pid: process.pid, parent: process.ppid, ...fields })}\n`);
};
const alive = pid => {
  try { process.kill(pid, 0); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
};
async function events() {
  try { return (await readFile(record, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function cleanRecordedChildren() {
  for (const entry of await events()) {
    if (entry.event === 'started' && alive(entry.pid)) process.kill(entry.pid, 'SIGKILL');
  }
}
async function assertEndpointInstalling(backend) {
  try { await backend.endpoint(); } catch (error) {
    if (/installation is in progress/.test(error.message)) return;
    throw error;
  }
  throw new Error('A collector launched while installation was in progress');
}

async function run() {
  if (role === 'server') {
    const source = flags.source ?? 'go';
    const mode = flags.mode ?? 'ready';
    const port = Number(flags.port);
    note('started', { source, port });
    process.stdout.write(`fixture ${source} started\n`);
    process.stderr.write('fixture diagnostic\n');
    if (mode === 'exit') process.exit(23);
    const readyAt = Date.now() + Number(flags['ready-delay'] ?? 0);
    const server = createServer((request, response) => {
      note('request', { path: request.url });
      if (request.url === '/crash') { response.end('crashing'); setImmediate(() => process.exit(17)); return; }
      if (request.url === '/pid') { response.end(String(process.pid)); return; }
      if (mode === 'unavailable' || Date.now() < readyAt) { response.writeHead(503); response.end('warming up'); return; }
      if (request.url === '/health') { response.setHeader('content-type', 'application/json'); response.end('{"ok":true}'); return; }
      if (request.url === '/metrics') {
        response.end(mode === 'invalid-metrics' ? 'unrelated_metric 1\n' : 'mactop_cpu_usage_percent 25\n');
        return;
      }
      response.writeHead(404); response.end('not found');
    });
    if (flags['ignore-term'] === 'true') process.on('SIGTERM', () => note('signal', { signal: 'SIGTERM' }));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    return;
  }
  if (role === 'installer') {
    note('started', { source: 'installer' });
    process.stdout.write('fake brew install mactop\n');
    setInterval(() => {}, 1000);
    return;
  }
  if (role === 'owner' || role === 'install-probe') {
    const [{ BackendManager }, { normalizeConfig }] = await Promise.all([
      import('../dist/backend.js'), import('../dist/types.js'),
    ]);
    const source = role === 'install-probe' ? 'mactop' : 'go';
    const backend = new BackendManager(normalizeConfig({ source }), {
      binary: process.execPath,
      args: port => [fileURLToPath(import.meta.url), 'server', '--port', String(port), '--record', record],
      startupMs: 3000,
    });
    if (role === 'owner') {
      const url = await backend.endpoint();
      process.send({ type: 'ready', url });
      process.on('message', message => {
        if (message === 'exit') process.exit(0);
      });
      return;
    }
    try {
      if (flags.scenario === 'concurrent') {
        await Promise.all([backend.install(), backend.install(), backend.install()]);
        // install() returns after spawning rather than awaiting brew completion.
        // Give the shims time to report their PIDs before inspecting ownership.
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline && !(await events()).some(entry => entry.event === 'started') && backend.state.status !== 'failed') await delay(20);
        await delay(150);
        await assertEndpointInstalling(backend);
        await backend.dispose();
      } else if (flags.scenario === 'dispose') {
        const installing = backend.install();
        await backend.dispose();
        await installing.catch(() => {});
        await delay(300);
      } else if (flags.scenario === 'failure') {
        await backend.install();
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline && backend.state.status === 'installing') await delay(20);
        process.send({ type: 'result', state: { ...backend.state } });
        return;
      } else throw new Error(`Unknown install scenario: ${flags.scenario}`);
      process.send({ type: 'result', starts: (await events()).filter(entry => entry.event === 'started'), state: backend.state });
    } finally {
      await backend.dispose();
      // Even a failing ownership assertion must not leak the fake installers.
      await cleanRecordedChildren();
      await delay(100);
    }
    return;
  }
  throw new Error(`Unknown fixture role: ${role}`);
}
run().catch(async error => {
  process.stderr.write(`${error.stack}\n`);
  if (process.send) process.send({ type: 'error', message: error.message });
  process.exitCode = 1;
  if (role === 'install-probe') await cleanRecordedChildren();
});

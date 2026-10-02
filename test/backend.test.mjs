import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { BackendManager } from '../dist/backend.js';
import { normalizeConfig } from '../dist/types.js';

const fixture = fileURLToPath(new URL('./backend.fixture.mjs', import.meta.url));
const nativeBinary = fileURLToPath(new URL('../native/bin/darwin-arm64/monitor', import.meta.url));
const alive = pid => {
  try { process.kill(pid, 0); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
};
async function until(predicate, message, timeout = 4000) {
  const deadline = Date.now() + timeout;
  do { if (await predicate()) return; await delay(20); } while (Date.now() < deadline);
  assert.fail(message);
}
async function records(path) {
  try { return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function workspace(t) {
  const directory = resolve(await mkdtemp(join(tmpdir(), 'monitor-backend-test-')));
  const record = join(directory, 'events.jsonl');
  t.after(async () => {
    // Kill only fixture PIDs recorded inside this test's own temporary directory.
    for (const entry of await records(record)) {
      if (entry.event === 'started' && alive(entry.pid)) process.kill(entry.pid, 'SIGKILL');
    }
    assert.equal(dirname(record), directory);
    assert.match(directory, /[/\\]monitor-backend-test-[^/\\]+$/);
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, record };
}
async function managed(t, { source = 'go', mode = 'ready', startupMs = 3000, readyDelay = 0, ignoreTerm = false } = {}) {
  const space = await workspace(t);
  const manager = new BackendManager(normalizeConfig({ source }), {
    binary: process.execPath,
    args: port => [fixture, 'server', '--port', String(port), '--record', space.record, '--source', source, '--mode', mode, '--ready-delay', String(readyDelay), '--ignore-term', String(ignoreTerm)],
    startupMs,
  });
  t.after(() => manager.dispose());
  return { manager, ...space };
}
async function pidAt(url) {
  const response = await fetch(`${url}/pid`, { signal: AbortSignal.timeout(1000) });
  assert.equal(response.ok, true);
  return Number(await response.text());
}
async function unavailable(url) {
  await assert.rejects(fetch(url, { signal: AbortSignal.timeout(500) }));
}

for (const source of ['go', 'mactop']) {
  test(`${source} startup coalesces endpoint callers and owns one attached child`, { timeout: 8000 }, async t => {
    const { manager, record } = await managed(t, { source, readyDelay: 300 });
    const urls = await Promise.all(Array.from({ length: 8 }, () => manager.endpoint()));
    assert.equal(new Set(urls).size, 1);
    assert.match(urls[0], /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(await manager.endpoint(), urls[0]);
    assert.equal(manager.state.source, source);
    assert.equal(manager.state.managed, true);
    assert.equal(manager.state.status, 'ready');
    assert.equal(manager.state.error, null);
    assert.match(manager.state.log, /fixture diagnostic/);
    const events = await records(record);
    const starts = events.filter(entry => entry.event === 'started');
    assert.equal(starts.length, 1, 'concurrent callers must not spawn duplicate collectors');
    assert.equal(alive(starts[0].parent), true, 'collector must have a live attached owner');
    assert(events.some(entry => entry.event === 'request' && entry.path === (source === 'go' ? '/health' : '/metrics')));
    const pid = await pidAt(urls[0]);
    const firstDisposal = manager.dispose();
    await manager.dispose();
    assert.equal(alive(pid), false, 'every concurrent disposal caller must await teardown');
    await firstDisposal;
    assert.equal(manager.state.status, 'stopped');
    assert.equal(alive(pid), false, 'dispose must reap the owned process before resolving');
    await unavailable(`${urls[0]}/pid`);
    await manager.dispose();
    await assert.rejects(manager.endpoint(), /disposed/);
    assert.equal((await records(record)).filter(entry => entry.event === 'started').length, 1);
  });
}

test('retry stops an unresponsive collector and coalesces its replacement', { timeout: 8000 }, async t => {
  const { manager, record } = await managed(t, { ignoreTerm: true });
  const first = await manager.endpoint();
  const firstPid = await pidAt(first);
  await manager.retry();
  assert.equal(alive(firstPid), false, 'retry must escalate termination if SIGTERM is ignored');
  await unavailable(`${first}/pid`);
  const urls = await Promise.all([manager.endpoint(), manager.endpoint()]);
  assert.equal(urls[0], urls[1]);
  assert.notEqual(await pidAt(urls[0]), firstPid);
  assert.equal((await records(record)).filter(entry => entry.event === 'started').length, 2);
  assert.equal(manager.state.status, 'ready');
});

test('a crashed collector rejects during backoff and explicit retry recovers', { timeout: 8000 }, async t => {
  const { manager, record } = await managed(t);
  const url = await manager.endpoint();
  const pid = await pidAt(url);
  await fetch(`${url}/crash`, { signal: AbortSignal.timeout(1000) });
  await until(() => manager.state.status === 'failed', 'child exit should be visible in backend state');
  assert.equal(alive(pid), false);
  assert.match(manager.state.error, /exited.*17/);
  await assert.rejects(manager.endpoint(), /exited.*17/);
  assert.equal((await records(record)).filter(entry => entry.event === 'started').length, 1);
  await manager.retry();
  const restarted = await manager.endpoint();
  assert.notEqual(await pidAt(restarted), pid);
  assert.equal(manager.state.status, 'ready');
  assert.equal(manager.state.error, null);
});

for (const [source, mode] of [['go', 'unavailable'], ['mactop', 'invalid-metrics']]) {
  test(`${source} readiness failure times out, kills the child and preserves the chosen source`, { timeout: 8000 }, async t => {
    const { manager, record } = await managed(t, { source, mode, startupMs: 900 });
    await assert.rejects(manager.endpoint(), /startup timed out/);
    assert.equal(manager.state.status, 'failed');
    assert.equal(manager.state.source, source, 'failure must not silently select systeminformation');
    assert.equal(manager.state.managed, true);
    const starts = (await records(record)).filter(entry => entry.event === 'started');
    assert.equal(starts.length, 1);
    assert.equal(alive(starts[0].pid), false);
    await assert.rejects(manager.endpoint(), /startup timed out/);
    assert.equal((await records(record)).filter(entry => entry.event === 'started').length, 1);
  });
}

test('startup child exit reports its code without publishing readiness', { timeout: 8000 }, async t => {
  const { manager, record } = await managed(t, { mode: 'exit' });
  await assert.rejects(manager.endpoint(), /exited.*23/);
  assert.equal(manager.state.status, 'failed');
  assert.match(manager.state.error, /exited.*23/);
  assert.match(manager.state.log, /fixture diagnostic/);
  assert.equal(alive((await records(record)).find(entry => entry.event === 'started').pid), false);
});

test('an unspawnable executable rejects and remains available for explicit retry', { timeout: 10000 }, async t => {
  const { directory } = await workspace(t);
  const manager = new BackendManager(normalizeConfig({ source: 'go' }), {
    binary: join(directory, 'does-not-exist'), startupMs: 1500,
  });
  t.after(() => manager.dispose());
  await assert.rejects(manager.endpoint(), /ENOENT|exited/);
  assert.equal(manager.state.status, 'failed');
  assert.match(`${manager.state.error}\n${manager.state.log}`, /ENOENT/, 'spawn diagnostic must reach the user');
  assert.equal(manager.state.source, 'go');
  await manager.retry();
  await assert.rejects(manager.endpoint(), /ENOENT|exited/);
});

test('dispose before spawn rejects startup without launching a child', { timeout: 8000 }, async t => {
  const { manager, record } = await managed(t);
  const rejected = assert.rejects(manager.endpoint(), /disposed/);
  await manager.dispose();
  await rejected;
  assert.equal(manager.state.status, 'stopped');
  assert.equal((await records(record)).filter(entry => entry.event === 'started').length, 0);
});

test('dispose during warmup rejects all callers and reaps the child', { timeout: 8000 }, async t => {
  const { manager, record } = await managed(t, { readyDelay: 60000 });
  const rejected = Promise.all([assert.rejects(manager.endpoint(), /disposed|exited/), assert.rejects(manager.endpoint(), /disposed|exited/)]);
  await until(async () => (await records(record)).some(entry => entry.event === 'started'), 'fixture did not start');
  const pid = (await records(record)).find(entry => entry.event === 'started').pid;
  await manager.dispose();
  await rejected;
  assert.equal(manager.state.status, 'stopped');
  assert.equal(alive(pid), false);
});

test('an external URL has no owned child and survives manager disposal', { timeout: 8000 }, async t => {
  const { record } = await workspace(t);
  const server = createServer((_request, response) => response.end('external backend'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const manager = new BackendManager(normalizeConfig({ source: 'go', backendUrl: url }), {
    binary: process.execPath, args: port => [fixture, 'server', '--port', String(port), '--record', record],
  });
  t.after(() => manager.dispose());
  assert.equal(manager.state.managed, false);
  assert.equal(manager.state.status, 'external');
  assert.deepEqual(await Promise.all([manager.endpoint(), manager.endpoint()]), [url, url]);
  await manager.retry();
  assert.equal(await manager.endpoint(), url);
  await manager.dispose();
  assert.equal(await (await fetch(url)).text(), 'external backend');
  assert.deepEqual(await records(record), []);
  await assert.rejects(manager.endpoint(), /disposed/);
});

test('systeminformation remains disabled and never starts a native child', async t => {
  const { manager, record } = await managed(t, { source: 'systeminformation' });
  assert.equal(manager.state.status, 'disabled');
  assert.equal(manager.state.managed, false);
  assert.equal(await manager.endpoint(), '');
  assert.deepEqual(await records(record), []);
});

async function subprocess(t, space, role, extra = [], env = {}) {
  const child = spawn(process.execPath, [fixture, role, '--record', space.record, ...extra], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, ...env },
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const messages = [];
  child.on('message', message => messages.push(message));
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exit;
  });
  return { child, exit, messages, stderr: () => stderr };
}

for (const abrupt of [false, true]) {
  test(`${abrupt ? 'abrupt SIGKILL of the Host' : 'normal Host exit'} reaps its collector`, { timeout: 8000 }, async t => {
    const space = await workspace(t);
    const owner = await subprocess(t, space, 'owner');
    await until(() => owner.messages.some(message => message.type === 'ready'), `Host fixture did not become ready: ${owner.stderr()}`);
    const url = owner.messages.find(message => message.type === 'ready').url;
    const pid = await pidAt(url);
    if (abrupt) owner.child.kill('SIGKILL');
    else owner.child.send('exit');
    const result = await owner.exit;
    if (abrupt) assert.equal(result.signal, 'SIGKILL', owner.stderr());
    else assert.equal(result.code, 0, owner.stderr());
    await until(() => !alive(pid), 'Host exit leaked its collector');
    await unavailable(`${url}/pid`);
  });
}

async function fakeBrew(t) {
  const space = await workspace(t);
  const brew = join(space.directory, 'brew');
  const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
  await writeFile(brew, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(fixture)} installer\n`);
  await chmod(brew, 0o700);
  return space;
}

for (const scenario of ['concurrent', 'dispose']) {
  test(`fake Homebrew ${scenario === 'concurrent' ? 'installation requests own one installer' : 'lookup cannot spawn after disposal'}`, { skip: process.platform !== 'darwin', timeout: 8000 }, async t => {
    const space = await fakeBrew(t);
    const probe = await subprocess(t, space, 'install-probe', ['--scenario', scenario], {
      PATH: space.directory, BACKEND_FIXTURE_RECORD: space.record,
    });
    await until(() => probe.messages.some(message => message.type === 'result' || message.type === 'error'), `Installer fixture did not finish: ${probe.stderr()}`);
    const result = probe.messages.find(message => message.type === 'result' || message.type === 'error');
    assert.equal(result.type, 'result', result.message ?? probe.stderr());
    const expected = scenario === 'concurrent' ? 1 : 0;
    assert.equal(result.starts.length, expected, scenario === 'concurrent' ? 'overlapping RPC requests must share the same owned installer' : 'a disposed backend must not spawn brew after executable lookup');
    assert.equal(result.state.status, 'stopped');
    assert.equal((await probe.exit).code, 0, probe.stderr());
    await until(() => result.starts.every(entry => !alive(entry.pid)), 'fake Homebrew was left running');
  });
}

test('fake Homebrew startup failure reports diagnostics and releases installation timers', { skip: process.platform !== 'darwin', timeout: 8000 }, async t => {
  const space = await workspace(t);
  const brew = join(space.directory, 'brew');
  // The executable exists but its interpreter does not, forcing spawn failure
  // without touching the user's Homebrew installation or PATH.
  await writeFile(brew, `#!${join(space.directory, 'missing-interpreter')}\n`);
  await chmod(brew, 0o700);
  const probe = await subprocess(t, space, 'install-probe', ['--scenario', 'failure'], {
    PATH: space.directory, BACKEND_FIXTURE_RECORD: space.record,
  });
  await until(() => probe.messages.some(message => message.type === 'result' || message.type === 'error'), `Installer fixture did not finish: ${probe.stderr()}`);
  const result = probe.messages.find(message => message.type === 'result' || message.type === 'error');
  assert.equal(result.type, 'result', result.message ?? probe.stderr());
  assert.equal(result.state.status, 'failed');
  assert.match(`${result.state.error}\n${result.state.log}`, /ENOENT/, 'installer spawn errors must be visible');
  assert.equal((await probe.exit).code, 0, probe.stderr());
});

const nativeAvailable = process.platform === 'darwin' && process.arch === 'arm64'
  && await access(nativeBinary, constants.X_OK).then(() => true, () => false);
test('managed bundled darwin-arm64 Go serves /api/v1/all and tears down', {
  skip: nativeAvailable ? false : 'requires the built native/bin/darwin-arm64/monitor on macOS arm64', timeout: 30000,
}, async t => {
  // Deliberately omit binary/args overrides to exercise packaged path discovery.
  const manager = new BackendManager(normalizeConfig({ source: 'go' }), { startupMs: 10000 });
  t.after(() => manager.dispose());
  const url = await manager.endpoint();
  assert.equal(manager.state.managed, true);
  assert.equal(manager.state.status, 'ready', manager.state.error ?? manager.state.log);
  const response = await fetch(`${url}/api/v1/all`, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.ok, true);
  const sample = await response.json();
  assert.equal(sample.success, true);
  assert(sample.data.memory.virtual.total > 0, 'native collector must return actual host memory');
  assert.equal(typeof sample.data.host.info.hostname, 'string');
  assert(Array.isArray(sample.data.cpu.percent));
  await manager.dispose();
  assert.equal(manager.state.status, 'stopped');
  await unavailable(`${url}/health`);
  await assert.rejects(manager.endpoint(), /disposed/);
});

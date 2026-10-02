import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

// Run with DSH_RUNTIME_ROOT pointing at an installed Harness node_modules tree.
// Electron's Node mode can import directly from app.asar, so this exercises the
// shipped Cordis dependency enforcement, HTTP router and both RPC adapters.
// The short-lived server and authentication fixture are isolated from the app.
test('installed Harness admits Monitor RPC, samples and unregisters on unload', { skip: !process.env.DSH_RUNTIME_ROOT }, async () => {
  const runtimeRoot = resolve(process.env.DSH_RUNTIME_ROOT);
  const load = name => import(pathToFileURL(resolve(runtimeRoot, '@deepseek-ai', name, 'lib/index.js')).href);
  const [{ Context }, { WebServer }, connectionPlugin, frontend] = await Promise.all([
    load('cordis'), load('dsh-host-webserver'), load('dsh-client-connection'), load('dsh-host-frontend-static'),
  ]);
  const plugin = await import(process.env.MONITOR_PLUGIN_ENTRY ? pathToFileURL(resolve(process.env.MONITOR_PLUGIN_ENTRY)).href : new URL('../dist/index.js', import.meta.url).href);
  const root = new Context();
  const web = root.plugin(WebServer, { host: '127.0.0.1', port: 0, compression: 'none' });
  await web;
  // Supply an in-memory credential store to the real Connection plugin. Its
  // launch token and signed browser cookie belong only to this test server.
  const credentials = root.plugin({ apply(ctx) {
    let record;
    ctx.provide('credentials', { async modifyRecord(_key, modify) {
      const update = await modify(record);
      if (update !== undefined) record = update;
      return record;
    } });
  } });
  await credentials;
  const connection = root.plugin(connectionPlugin, {});
  await connection;
  const fallback = root.plugin(frontend, { distIndex: resolve(runtimeRoot, '@deepseek-ai/dsh-web-frontend/dist/index.html') });
  await fallback;
  const base = `http://127.0.0.1:${root.get('webServer').port}/`;
  const exchange = await fetch(root.get('connection').authenticatedUrl(base), { redirect: 'manual' });
  assert.equal(exchange.status, 303);
  const cookie = exchange.headers.get('set-cookie').split(';', 1)[0];
  let browserModule;
  const browser = vm.createContext({ window: { __ModuleLoader__: { load(value) { browserModule = value; } } }, crypto: globalThis.crypto, console });
  vm.runInContext(await readFile(resolve(runtimeRoot, '@deepseek-ai/dsh-client-connection/lib/client.js'), 'utf8'), browser);
  const client = browserModule.factory(() => { throw new Error('unexpected external import'); });
  let browserConnection;
  client.installConnection({ provide(_name, value) { browserConnection = value; } }, {
    transport: { fetch(input, init) { return fetch(new URL(input, base), { ...init, headers: { ...init.headers, cookie } }); } },
  });
  const monitor = root.plugin(plugin, { intervalMs: 1000, source: 'systeminformation', metrics: ['cpu', 'memory'] });
  let activationError;
  try {
    try { await monitor; } catch (error) { activationError = error; }
    // The original custom channel fails with "webServer without inject" and
    // its /monitor-pro/snapshot POST receives 405 from the real SPA fallback.
    assert.equal(activationError, undefined, activationError?.stack);
    const unauthenticated = await fetch(new URL('api/monitor-pro/snapshot', base), { method: 'POST' });
    assert.equal(unauthenticated.status, 401);
    const rpc = browserConnection.rpc;
    let result;
    const deadline = Date.now() + 20000;
    do {
      result = await rpc.call('/api', 'monitor-pro/snapshot', {});
      assert.equal(result.ok, true);
      if (result.value.current) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.equal(result.value.status, 'live', result.value.error ?? 'no sample received');
    assert.equal(typeof result.value.current.cpu, 'number');
    assert(result.value.current.memory.total > 0);
    const delta = await rpc.call('/api', 'monitor-pro/snapshot', { since: result.value.current.timestamp, generation: result.value.generation });
    assert.equal(delta.ok, true);
    assert(delta.value.history.every(sample => sample.timestamp > result.value.current.timestamp));
    const invalid = await rpc.call('/api', 'monitor-pro/snapshot', { since: -1 });
    assert.equal(invalid.error.code, 'monitor/bad-request');
    const malformed = await fetch(new URL('api/monitor-pro/snapshot', base), {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{',
    });
    assert.equal(malformed.status, 400);
    console.log(JSON.stringify({ route: '/api/monitor-pro/snapshot', status: result.value.status, cores: result.value.current.cores.length, memoryGiB: result.value.current.memory.total / 1024 ** 3, errors: result.value.current.errors }));
    await monitor.dispose();
    const unloaded = await fetch(new URL('api/monitor-pro/snapshot', base), { method: 'POST', headers: { cookie } });
    assert.equal(unloaded.status, 404, 'unload must remove the exact route');
  } finally {
    await monitor.dispose();
    await fallback.dispose();
    await connection.dispose();
    await credentials.dispose();
    await web.dispose();
  }
});

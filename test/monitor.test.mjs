import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MonitorService, WorkerRunner } from '../dist/service.js';
import { normalizeConfig, emptySample } from '../dist/types.js';
import { Collector, parseGpuCsv } from '../dist/collector.js';
import { defaultPreferences, parsePreferences, formatBytes, chartPath } from '../dist/view.js';
import { en, zh, zhTw, ja } from '../dist/locales.js';
import { apply } from '../dist/index.js';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// These tests exercise failure boundaries and externally observable behavior,
// rather than duplicating formatting/card implementation details.
test('configuration rejects invalid cadence, source and non-loopback backends', () => {
  assert.equal(normalizeConfig().intervalMs, 2000);
  for (const config of [{ intervalMs: 499 }, { intervalMs: 2000.5 }, { historySize: 601 }, { metrics: ['made-up'] }, { source: 'invalid' }, { source: 'go', backendUrl: 'https://example.com' }, { source: 'go', backendUrl: 'http://user:pass@localhost:8888' }, { source: 'go', backendUrl: 'http://127.0.0.1:8888/path' }]) assert.throws(() => normalizeConfig(config));
  assert.equal(normalizeConfig({ source: 'go', backendUrl: 'http://[::1]:8888' }).source, 'go');
  assert.deepEqual(normalizeConfig({ metrics: [] }).metrics, []);
});
test('service coalesces callers, bounds history, preserves freshness on failure and stops', async () => {
  let pending, calls = 0, disposed = false;
  const runner = { collect: () => { calls++; return new Promise((resolve, reject) => { pending = { resolve, reject }; }); }, dispose: async () => { disposed = true; pending?.reject(new Error('disposed')); } };
  const service = new MonitorService({ source: 'systeminformation', historySize: 10 }, runner);
  const a = service.sample(), b = service.sample();
  assert.equal(a, b); await pause(0); assert.equal(calls, 1);
  pending.resolve({ ...emptySample(), timestamp: 1 }); await a;
  for (let i = 2; i <= 12; i++) { const cycle = service.sample(); await pause(0); pending.resolve({ ...emptySample(), timestamp: i }); await cycle; }
  assert.equal(service.snapshot().history.length, 10);
  assert.deepEqual(service.snapshot(10).history.map(s => s.timestamp), [11, 12]);
  assert.equal(service.snapshot(999, 'previous-collector').history.length, 10);
  assert.equal(service.snapshot(999, service.snapshot().generation).history.length, 0);
  const failure = service.sample(); await pause(0); pending.reject(new Error('offline')); await failure;
  assert.equal(service.snapshot().status, 'error'); assert.equal(service.snapshot().current.timestamp, 12);
  const active = service.sample(); await pause(0); await service.dispose(); await active;
  assert.equal(disposed, true); assert.equal(service.snapshot().status, 'stopped');
  const before = calls; await service.sample(); assert.equal(calls, before);
});
test('worker deadline terminates hung work and can recover with a new worker', async () => {
  const runner = new WorkerRunner(new URL('./hung.worker.mjs', import.meta.url), 100);
  try {
    await assert.rejects(runner.collect(normalizeConfig()), /timed out/);
    await assert.rejects(runner.collect(normalizeConfig()), /timed out/);
  } finally { await runner.dispose(); }
  await assert.rejects(runner.collect(normalizeConfig()), /disposed/);
});
test('unloading while worker is starting cannot leave a pending task', async () => {
  const runner = new WorkerRunner(new URL('./hung.worker.mjs', import.meta.url), 500);
  const collection = runner.collect(normalizeConfig());
  const rejected = assert.rejects(collection, /disposed/);
  await runner.dispose(); await rejected;
});
test('service records synchronous collector failures without rejecting callers', async () => {
  const service = new MonitorService({ source: 'systeminformation' }, { collect() { throw new Error('sync failure'); }, dispose: async () => {} });
  await service.sample(); assert.equal(service.snapshot().status, 'error'); assert.equal(service.snapshot().error, 'sync failure');
  await service.dispose();
});
test('Host RPC and optional tool share cached state and own their lifecycle', async () => {
  const disposers = []; let route, tool; const routes = new Map();
  const ctx = {
    effect(factory) { disposers.push(factory()); },
    connection: { fetch: { register(definition) {
      assert(['/api/monitor-pro/snapshot', '/api/monitor-pro/action'].includes(definition.path));
      const call = async (method, payload) => (await definition.fetch(new Request('http://localhost/api/monitor-pro/snapshot', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'test', method, payload }),
      }))).json().then(envelope => envelope.result);
      routes.set(definition.path, call);
      if (definition.path.endsWith('/snapshot')) route = call;
    } } },
    inject(names, callback) { assert.deepEqual(names, ['tools']); callback({ tools: { register(definition) { tool = definition; } } }); },
  };
  try {
    apply(ctx, { metrics: [] });
    assert.equal((await routes.get('/api/monitor-pro/action')('monitor-pro/action', { action: 'unknown' })).ok, false);
    assert.equal((await route('unknown', {})).ok, false);
    assert.equal((await route('monitor-pro/snapshot', { since: -1 })).ok, false);
    assert.equal((await route('monitor-pro/snapshot', { generation: 5 })).ok, false);
    const response = await route('monitor-pro/snapshot', {});
    const value = await tool.execute({});
    assert.equal(value.generation, response.value.generation); assert.deepEqual(value.history, []);
    assert.deepEqual(tool.parameters, { type: 'object', properties: {}, additionalProperties: false });
    assert.deepEqual(tool.output.schema, {}); // unconstrained JSON is the public raw schema
    assert.deepEqual(JSON.parse(tool.output.render({}, value)[0].text), value);
    assert.equal(tool.isConcurrencySafe(), true);
  } finally { for (const dispose of disposers.reverse()) await dispose?.(); }
  assert.equal((await route('monitor-pro/snapshot', {})).value.status, 'stopped');
});
test('NVIDIA N/A leaves nullable fields without dropping a valid GPU', () => {
  const cards = parseGpuCsv('NVIDIA Test, 37, N/A, 1024, 8192\n');
  assert.equal(cards.length, 1); assert.equal(cards[0].temperature, null);
  assert.equal(cards[0].memUsed, 1024 ** 3); assert.equal(cards[0].utilization, 37);
});
async function server(t, handler) {
  const instance = createServer(handler);
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => instance.close(resolve)));
  return `http://127.0.0.1:${instance.address().port}`;
}
test('mactop adapter uses real metric labels, units and SoC power semantics', async t => {
  const backendUrl = await server(t, (_req, res) => res.end(`mactop_cpu_usage_percent 25
mactop_cpu_core_usage_percent{core="1"} 20
mactop_cpu_core_usage_percent{core="0"} 30
mactop_memory_gb{type="total"} 16
mactop_memory_gb{type="used"} 8
mactop_memory_gb{type="swap_total"} 2
mactop_memory_gb{type="swap_used"} 1
mactop_network_kbytes_per_sec{direction="download"} 100
mactop_disk_kbytes_per_sec{operation="write"} 5
mactop_power_watts{component="total"} 12.5
mactop_soc_temp_celsius 52
mactop_gpu_usage_percent 41
`));
  const sample = await new Collector().collect(normalizeConfig({ source: 'mactop', backendUrl, metrics: ['cpu', 'memory', 'network', 'diskIO', 'power', 'cpuTemp', 'gpu', 'cpuSpeed'] }));
  assert.equal(sample.cpu, 25); assert.deepEqual(sample.cores, [30, 20]);
  assert.equal(sample.memory.total, 16 * 1024 ** 3); assert.equal(sample.memory.swapUsed, 1024 ** 3);
  assert.equal(sample.network.rx, 100 * 1024); assert.equal(sample.network.tx, null);
  assert.equal(sample.diskIO.read, null); assert.equal(sample.diskIO.write, 5 * 1024);
  assert.deepEqual(sample.power, { watts: 12.5, kind: 'soc' });
  assert.equal(sample.cpuTemp, 52); assert.equal(sample.cpuSpeed, null); assert.equal(sample.gpus[0].memTotal, null);
});
test('native adapters reject HTTP failures and redirects', async t => {
  const backendUrl = await server(t, (req, res) => { res.writeHead(req.url === '/metrics' ? 302 : 503, { Location: 'http://example.com/' }); res.end(); });
  await assert.rejects(new Collector().collect(normalizeConfig({ source: 'mactop', backendUrl })), /fetch failed/);
  await assert.rejects(new Collector().collect(normalizeConfig({ source: 'go', backendUrl })), /HTTP 503/);
});
test('Go preserves missing CPU and first-sample rates; reset counters do not invent zero', async t => {
  let recv = 2000, bytes = 4000, query;
  const backendUrl = await server(t, (req, res) => {
    query = new URL(req.url, 'http://localhost').searchParams.get('metrics');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ success: true, data: { cpu: { percent: [], info: [] }, memory: {}, network: { ioCounters: [{ name: 'Ethernet', bytesRecv: recv, bytesSent: recv }] }, disk: { ioCounters: { disk0: { name: 'disk0', readBytes: bytes, writeBytes: bytes } }, usage: [] }, host: {}, battery: { hasBattery: true, state: 'Discharging', percent: 80, health: 95, powerRate: -7 } } }));
  });
  const config = normalizeConfig({ source: 'go', backendUrl, metrics: ['cpu', 'network', 'diskIO', 'power'] });
  const collector = new Collector();
  const first = await collector.collect(config);
  assert.equal(first.cpu, null); assert.equal(first.network.rx, null); assert.equal(first.diskIO.read, null);
  assert(query.split(',').includes('battery')); assert.deepEqual(first.power, { watts: -7, kind: 'battery' });
  recv += 1000; bytes += 2000; await pause(20);
  const second = await collector.collect(config); assert(second.network.rx > 0); assert(second.diskIO.read > 0);
  recv = 0; bytes = 0; await pause(20);
  const reset = await collector.collect(config); assert.equal(reset.network.rx, null); assert.equal(reset.diskIO.read, null);
});
test('all four translations have the same keys and corrupted preferences recover', () => {
  for (const dictionary of [zh, zhTw, ja]) assert.deepEqual(Object.keys(dictionary).sort(), Object.keys(en).sort());
  assert.equal(parsePreferences({ order: ['cpu', 'cpu', 'unknown'], decimals: 100 }).order.length, 17);
  assert.equal(parsePreferences(null).decimals, 1);
  assert.equal(formatBytes(null, defaultPreferences()), '—');
  assert.equal(formatBytes(1024, defaultPreferences()), '1.00KiB');
  assert.equal(formatBytes(125000, defaultPreferences(), true), '1.00Mbit');
  const path = chartPath([{ timestamp: 1, value: 30 }, { timestamp: 2, value: null }, { timestamp: 3, value: 40 }], 100);
  assert.equal(path.split('M').length - 1, 2); assert(!path.includes('L'));
  // Battery discharge is negative; it must be drawn below the zero line.
  assert.equal(chartPath([{ timestamp: 1, value: -5 }, { timestamp: 2, value: 5 }], 10, -10), 'M0.00,28.00 L100.00,12.00');
});

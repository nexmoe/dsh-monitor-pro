import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { normalizeConfig, emptySample } from '../dist/types.js';

// Load the shipped ModuleLoader factory with the host React instance. This is a
// DOM integration test of mounting, delta/reload behavior and resource cleanup;
// it does not substitute for installation in a live Harness profile.
test('shipped Client mounts, resets generations, switches locale, pauses and disposes', async () => {
  const dom = new JSDOM('<div id="panel"></div>', { url: 'http://localhost', runScripts: 'outside-only', pretendToBeVisual: true });
  const saved = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  let registered, root;
  const effects = [], slots = new Map(), listeners = new Set(), requests = [], replies = [];
  let snapshot = { active: 'en', locales: [{ id: 'en' }, { id: 'zh' }], revision: 0 }, dictionaries;
  const notify = () => { snapshot = { ...snapshot, revision: snapshot.revision + 1 }; for (const fn of listeners) fn(); };
  const locale = {
    listeners,
    getSnapshot() { return snapshot; },
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
    register(_namespace, value) { dictionaries = value; notify(); return () => { dictionaries = undefined; notify(); }; },
    addLanguage(language) {
      assert(!snapshot.locales.some(entry => entry.id === language.id));
      snapshot = { ...snapshot, locales: [...snapshot.locales, language] }; notify();
      return () => { snapshot = { ...snapshot, locales: snapshot.locales.filter(entry => entry.id !== language.id) }; notify(); };
    },
    bind() { return key => dictionaries[snapshot.active.toLowerCase()]?.[key] ?? dictionaries.en[key]; },
  };
  const effect = factory => { const dispose = factory(); if (dispose) effects.push(dispose); };
  const ctx = {
    locale, effect,
    slots: {
      inject(_name, callback) { effect(callback); },
      register(options, component) { slots.set(options.name, component); return () => slots.delete(options.name); },
    },
    connection: { rpc: { call(channel, endpoint, payload, signal) {
      assert.equal(channel, '/api'); assert.equal(endpoint, 'monitor-pro/snapshot');
      requests.push({ payload, signal });
      if (replies.length) return Promise.resolve({ ok: true, value: replies.shift() });
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    } } },
  };
  const makeSample = (timestamp, cpu) => ({ ...emptySample(), timestamp, cpu, cores: [cpu, cpu / 2],
    memory: { total: 16 * 1024 ** 3, used: 8 * 1024 ** 3, active: 6 * 1024 ** 3, available: 8 * 1024 ** 3, swapUsed: null, swapTotal: null },
    network: { rx: 1024, tx: 2048, interfaces: ['en0'] }, diskIO: { read: 1024, write: 512 },
    disks: [{ fs: 'disk0', mount: '/', size: 1000, used: 500, use: 50 }],
    battery: { percent: 80, charging: false, acConnected: false, health: 95, timeRemaining: 120 },
    cpuSpeed: 3.2, cpuTemp: 50, gpus: [{ model: 'Test GPU', utilization: 40, temperature: 60, memUsed: 1024, memTotal: 4096 }],
    power: { watts: -7, kind: 'battery' }, host: { hostname: 'test-host', platform: 'test', arch: 'arm64', release: '', uptime: 3600 },
  });
  const config = normalizeConfig({ intervalMs: 60000 });
  const baseTime = Date.now(), first = makeSample(baseTime, 70), second = makeSample(baseTime + 1, 60), newSample = makeSample(baseTime + 2, 15);
  const reply = (generation, samples, source = 'systeminformation') => ({ generation, config: { ...config, source }, current: samples.at(-1), history: samples, status: 'live', error: null, lastAttempt: samples.at(-1).timestamp });
  const visiblePoll = async () => { await React.act(async () => { dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange')); }); };
  const clickButton = async text => {
    const button = [...dom.window.document.querySelectorAll('button')].find(element => element.textContent === text);
    assert(button, `Missing button: ${text}`);
    await React.act(async () => button.click());
  };
  try {
    dom.window.__ModuleLoader__ = { load(module) { registered = module; } };
    vm.runInContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), dom.getInternalVMContext());
    assert.equal(registered.id, '@nexmoe/dsh-monitor-pro');
    const client = registered.factory(name => { assert.equal(name, 'react'); return React; });
    client.apply(ctx);
    assert.deepEqual(snapshot.locales.map(entry => entry.id), ['en', 'zh', 'zh-TW', 'ja']);
    replies.push(reply('one', [first]));
    root = createRoot(dom.window.document.getElementById('panel'));
    await React.act(async () => root.render(React.createElement(slots.get('main'))));
    assert.equal(listeners.size, 1);
    assert.equal(dom.window.document.querySelectorAll('.mp-card').length, 17);
    assert(dom.window.document.body.textContent.includes('History: 1 samples'));
    assert(dom.window.document.body.textContent.includes('Battery net power'));
    replies.push(reply('one', [second])); await visiblePoll();
    assert(dom.window.document.body.textContent.includes('History: 2 samples'));
    assert.equal(requests[1].payload.since, first.timestamp); assert.equal(requests[1].payload.generation, 'one');
    replies.push(reply('two', [newSample], 'mactop')); await visiblePoll();
    assert(dom.window.document.body.textContent.includes('History: 1 samples'));
    assert.equal(dom.window.document.querySelector('.mp-card .mp-line').getAttribute('d'), 'M100.00,31.20');
    await clickButton('Unavailable');
    assert.equal(dom.window.document.querySelectorAll('.mp-card').length, 0);
    await clickButton('All');
    assert.equal(dom.window.document.querySelectorAll('.mp-card').length, 17);
    await clickButton('Display settings');
    const cpuVisibility = dom.window.document.querySelector('.mp-order input');
    await React.act(async () => cpuVisibility.click());
    assert.equal(dom.window.document.querySelectorAll('.mp-card').length, 16);
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem('dsh-monitor-pro:view:v1')).hidden, ['cpu']);
    await clickButton('Pause view'); const beforePause = requests.length; await visiblePoll();
    assert.equal(requests.length, beforePause);
    await React.act(async () => { snapshot = { ...snapshot, active: 'ja' }; notify(); });
    assert(dom.window.document.body.textContent.includes('表示を一時停止中'));
    // Resume with no queued reply leaves a live request; unmount must abort it.
    await clickButton('表示を再開');
    const pendingSignal = requests.at(-1).signal;
    await React.act(async () => root.unmount()); root = undefined;
    assert.equal(pendingSignal.aborted, true); assert.equal(listeners.size, 0);
    for (const dispose of effects.reverse()) dispose(); effects.length = 0;
    assert.equal(slots.size, 0);
    assert.deepEqual(snapshot.locales.map(entry => entry.id), ['en', 'zh']);
  } finally {
    if (root) await React.act(async () => root.unmount());
    for (const dispose of effects.reverse()) dispose();
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});

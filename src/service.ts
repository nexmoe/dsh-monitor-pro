import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { normalizeConfig, selectSource, type MonitorConfig, type Payload, type Sample } from './types.js';
import { BackendManager } from './backend.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
export interface CollectorRunner { collect(config: MonitorConfig): Promise<Sample>; dispose(): Promise<void> }
export class WorkerRunner implements CollectorRunner {
  private worker: Worker | null = null;
  private pending: { resolve: (value: Sample) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private closed = false;
  private terminating: Promise<unknown> = Promise.resolve();
  constructor(private readonly url = new URL('./collector.worker.js', import.meta.url), private readonly timeoutMs = 15000) {}
  private async getWorker(): Promise<Worker> {
    await this.terminating;
    if (this.closed) throw new Error('Monitor worker is disposed');
    if (this.worker) return this.worker;
    const worker = new Worker(this.url);
    this.worker = worker;
    worker.on('message', (message: { sample?: Sample; error?: string }) => {
      if (this.worker !== worker || !this.pending) return;
      const pending = this.pending;
      this.pending = null;
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error));
      else if (message.sample) pending.resolve(message.sample);
      else pending.reject(new Error('Invalid monitor worker response'));
    });
    worker.on('error', error => { if (this.worker === worker) this.fail(error); });
    worker.on('exit', code => { if (this.worker === worker) this.fail(new Error(`Monitor worker exited (${code})`)); });
    return worker;
  }
  private fail(error: Error): void {
    const pending = this.pending;
    this.pending = null;
    if (pending) { clearTimeout(pending.timer); pending.reject(error); }
    const worker = this.worker;
    this.worker = null;
    if (worker) this.terminating = worker.terminate();
  }
  async collect(config: MonitorConfig): Promise<Sample> {
    if (this.pending) throw new Error('Monitor collection already in progress');
    const worker = await this.getWorker();
    if (this.closed) throw new Error('Monitor worker is disposed');
    if (this.pending) throw new Error('Monitor collection already in progress');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('Monitor collection timed out (15s)')), this.timeoutMs);
      this.pending = { resolve, reject, timer };
      try { worker.postMessage(config); } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  async dispose(): Promise<void> {
    this.closed = true;
    this.fail(new Error('Monitor worker is disposed'));
    await this.terminating;
  }
}
export class MonitorService {
  readonly config: MonitorConfig;
  private generation = randomUUID();
  private backend: BackendManager;
  private initialization: Promise<void> | null = null;
  private actions: Promise<void> = Promise.resolve();
  private transitioning = false;
  private history: Sample[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private started = false;
  private inFlight: Promise<void> | null = null;
  private status: Payload['status'] = 'starting';
  private error: string | null = null;
  private lastAttempt: number | null = null;
  constructor(config: Partial<MonitorConfig>, private readonly runner: CollectorRunner = new WorkerRunner(), private readonly preferencesPath = join(homedir(), '.dsh', 'monitor-pro', 'preferences.json')) { this.config = normalizeConfig(config); this.backend = new BackendManager(this.config); }
  private initialize(): Promise<void> {
    return this.initialization ??= (async () => {
      if (this.config.source !== 'auto' || this.stopped) return;
      let value: { mactopEnabled?: boolean };
      try { value = JSON.parse(await readFile(this.preferencesPath, 'utf8')); } catch { return; }
      if (value.mactopEnabled === false && this.config.mactopEnabled && !this.stopped) {
        this.config.mactopEnabled = false;
        await this.backend.dispose();
        if (!this.stopped) this.backend = new BackendManager(this.config);
      }
    })();
  }
  action(action: 'install' | 'retry' | 'use-si' | 'enable-mactop'): Promise<void> {
    const next = this.actions.then(() => this.performAction(action));
    this.actions = next.catch(() => {}); return next;
  }
  private async performAction(action: 'install' | 'retry' | 'use-si' | 'enable-mactop'): Promise<void> {
    if (this.stopped) throw new Error('Monitor is stopped');
    await this.initialize();
    if (this.stopped) throw new Error('Monitor is stopped');
    if (action === 'install') { await this.backend.install(); return; }
    if (action === 'retry') { await this.backend.retry(); await this.sample(); return; }
    this.transitioning = true;
    try {
      if (this.timer) clearTimeout(this.timer); this.timer = null;
      await this.inFlight;
      if (this.stopped) throw new Error('Monitor is stopped');
      const enabled = action === 'enable-mactop';
      await mkdir(join(this.preferencesPath, '..'), { recursive: true });
      await writeFile(this.preferencesPath, JSON.stringify({ mactopEnabled: enabled }), { mode: 0o600 });
      await this.backend.dispose();
      if (this.stopped) throw new Error('Monitor is stopped');
      this.config.source = enabled ? 'auto' : 'systeminformation';
      this.config.mactopEnabled = enabled; this.config.backendUrl = '';
      this.backend = new BackendManager(this.config);
      this.history = []; this.generation = randomUUID();
    } finally { this.transitioning = false; }
    await this.sample();
  }
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.schedule(0);
  }
  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => { this.timer = null; void this.sample(); }, delay);
    this.timer.unref?.();
  }
  sample(): Promise<void> {
    if (this.stopped || this.transitioning) return this.inFlight ?? Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.lastAttempt = Date.now();
    const started = this.lastAttempt;
    this.inFlight = Promise.resolve().then(async () => {
      await this.initialize();
      const source = selectSource(this.config);
      const backendUrl = this.config.metrics.length && source !== 'systeminformation' ? await this.backend.endpoint() : this.config.backendUrl;
      if (this.stopped) throw new Error('Monitor is stopped');
      return this.runner.collect({ ...this.config, source, backendUrl });
    }).then(sample => {
      if (this.stopped) return;
      this.history.push(sample);
      if (this.history.length > this.config.historySize) this.history.splice(0, this.history.length - this.config.historySize);
      this.status = sample.errors.length ? 'degraded' : 'live';
      this.error = sample.errors.length ? `Collection failed: ${sample.errors.join(', ')}` : null;
    }).catch((error: unknown) => {
      if (this.stopped) return;
      this.status = 'error';
      this.error = error instanceof Error ? error.message : String(error);
    }).finally(() => {
      this.inFlight = null;
      if (this.started && !this.transitioning) this.schedule(Math.max(100, this.config.intervalMs - (Date.now() - started)));
    });
    return this.inFlight;
  }
  snapshot(since = 0, generation?: string): Payload {
    // A browser can miss the empty snapshot during a fast reload. Resetting the
    // delta cursor here keeps samples from different collectors out of one graph.
    if (generation !== undefined && generation !== this.generation) since = 0;
    return { generation: this.generation, config: { ...this.config, source: selectSource(this.config) }, backend: { ...this.backend.state }, current: this.history.at(-1) ?? null, history: this.history.filter(s => s.timestamp > since), status: this.status, error: this.error, lastAttempt: this.lastAttempt };
  }
  async dispose(): Promise<void> {
    this.stopped = true;
    this.status = 'stopped';
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.runner.dispose();
    await this.backend.dispose();
    await this.inFlight; await this.initialization; await this.actions;
  }
}

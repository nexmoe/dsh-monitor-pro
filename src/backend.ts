import { spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { selectSource, type MonitorConfig, type BackendState } from './types.js';

async function executable(name: string, extra: string[] = []): Promise<string | null> {
  const candidates = [...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map(path => join(path, name)), ...extra];
  for (const path of candidates) { try { await access(path, constants.X_OK); return path; } catch { /* GUI launches often lack Homebrew in PATH. */ } }
  return null;
}
async function freePort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const port = (server.address() as { port: number }).port; server.close(error => error ? reject(error) : resolve(port)); });
  });
}
export interface BackendOptions { binary?: string; args?: (port: number) => string[]; startupMs?: number }
// One Cordis Host serves all browser windows. Each plugin instance owns an
// attached child, avoiding cross-profile PID files and teardown races on reload.
// Ownership stays outside the Worker so terminating a hung collector is safe.
export class BackendManager {
  readonly state: BackendState;
  private child: ChildProcess | null = null;
  private installer: ChildProcess | null = null;
  private pending: Promise<string> | null = null;
  private installation: Promise<void> | null = null;
  private disposal: Promise<void> | null = null;
  private url = '';
  private closed = false;
  private nextAttempt = 0;
  private readonly onExit = () => { this.child?.stdin?.destroy(); this.installer?.stdin?.destroy(); };
  constructor(private readonly config: MonitorConfig, private readonly options: BackendOptions = {}) {
    const source = selectSource(config);
    this.state = { source, managed: source !== 'systeminformation' && !config.backendUrl, status: source === 'systeminformation' ? 'disabled' : config.backendUrl ? 'external' : 'starting', error: null, installCommand: source === 'mactop' ? 'brew install mactop' : null, canInstall: false, log: '' };
    process.on('exit', this.onExit);
  }
  private append(text: string): void { this.state.log = (this.state.log + text).slice(-8192); }
  private async binary(): Promise<string | null> {
    if (this.options.binary) return this.options.binary;
    if (this.state.source === 'mactop') return executable('mactop', ['/opt/homebrew/bin/mactop', '/usr/local/bin/mactop']);
    const path = fileURLToPath(new URL(`../native/bin/${process.platform}-${process.arch}/monitor${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
    try { await access(path, constants.X_OK); return path; } catch { return null; }
  }
  async endpoint(): Promise<string> {
    if (this.closed) throw new Error('Native backend is disposed');
    if (!this.state.managed) return this.config.backendUrl;
    if (this.installation) throw new Error('mactop installation is in progress');
    if (this.child && this.state.status === 'ready') return this.url;
    if (this.pending) return this.pending;
    if (Date.now() < this.nextAttempt) throw new Error(this.state.error ?? 'Native backend is unavailable');
    this.pending = this.launch().finally(() => { this.pending = null; });
    return this.pending;
  }
  private async launch(): Promise<string> {
    this.state.status = 'starting'; this.state.error = null;
    try {
      const binary = await this.binary();
      if (!binary) {
        this.state.status = 'missing';
        this.state.canInstall = this.state.source === 'mactop' && process.platform === 'darwin' && !!await executable('brew', ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']);
        throw new Error(this.state.source === 'mactop' ? 'mactop is not installed. Install it from this panel; Monitor Pro will start it automatically.' : `Bundled Go backend is missing for ${process.platform}/${process.arch}. Reinstall the release package.`);
      }
      if (this.closed) throw new Error('Native backend is disposed');
      const port = await freePort();
      if (this.closed) throw new Error('Native backend is disposed');
      // Headless mactop passes this value directly to ListenAndServe. The
      // host:port form binds loopback; a bare port would bind every interface.
      const listen = this.state.source === 'mactop' ? `127.0.0.1:${port}` : String(port);
      const args = this.options.args?.(port) ?? (this.state.source === 'go' ? ['-port', listen] : ['--headless', '--prometheus', listen, '--count', '0']);
      if (this.closed) throw new Error('Native backend is disposed');
      const guard = fileURLToPath(new URL('./backend.guard.js', import.meta.url));
      const child = spawn(process.execPath, [guard, binary, ...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
      this.child = child;
      this.url = `http://127.0.0.1:${port}`;
      let failure: Error | null = null;
      child.stdout?.on('data', chunk => this.append(chunk.toString()));
      child.stderr?.on('data', chunk => this.append(chunk.toString()));
      child.once('error', error => { failure = error; });
      child.once('exit', (code, signal) => {
        failure = new Error(`Native backend exited (${code ?? signal})`);
        if (this.child === child) {
          this.child = null;
          if (!this.closed) { this.state.status = 'failed'; this.state.error = failure.message; this.nextAttempt = Date.now() + 30000; }
        }
      });
      const deadline = Date.now() + (this.options.startupMs ?? 10000);
      while (!this.closed && !failure && Date.now() < deadline) {
        try {
          const response = await fetch(`${this.url}${this.state.source === 'go' ? '/health' : '/metrics'}`, { signal: AbortSignal.timeout(500), redirect: 'error' });
          const text = await response.text();
          if (response.ok && (this.state.source !== 'mactop' || text.includes('mactop_cpu_usage_percent'))) {
            if (this.closed || failure || this.child !== child) break;
            this.state.status = 'ready'; this.state.error = null; return this.url;
          }
        } catch { /* The child can bind before its sampler is warmed up. */ }
        await delay(100);
      }
      throw failure ?? new Error(this.closed ? 'Native backend is disposed' : 'Native backend startup timed out');
    } catch (error) {
      await this.stopChild();
      if (!this.closed) {
        if (this.state.status !== 'missing') this.state.status = 'failed';
        this.state.error = error instanceof Error ? error.message : String(error);
        this.nextAttempt = Date.now() + 30000;
      }
      throw error;
    }
  }
  private async terminate(child: ChildProcess | null): Promise<void> {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>(resolve => child.once('close', () => resolve()));
    // EOF works on Windows as well as Unix and gives the supervisor time to
    // kill/reap its collector before we force the supervisor itself to exit.
    child.stdin?.end();
    await Promise.race([exited, delay(1200)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.race([exited, delay(2000)]);
  }
  private async stopChild(): Promise<void> { const child = this.child; this.child = null; await this.terminate(child); }
  async retry(): Promise<void> {
    if (this.closed || this.installation) return;
    // Await startup before replacing ownership; otherwise a late launch can
    // publish a ready endpoint after retry has already begun another child.
    await this.pending?.catch(() => {});
    await this.stopChild();
    if (!this.closed && this.state.managed) { this.state.status = 'starting'; this.nextAttempt = 0; this.state.error = null; }
  }
  async install(): Promise<void> {
    if (this.closed) throw new Error('Native backend is disposed');
    if (this.state.source !== 'mactop' || !this.state.managed || process.platform !== 'darwin') throw new Error('mactop installation is only available for a managed Apple backend');
    if (this.installation) return;
    this.state.status = 'installing'; this.state.error = null; this.state.log = '';
    // Publish ownership before any await, so multiple authenticated windows
    // cannot launch concurrent Homebrew installations or outlive disposal.
    this.installation = Promise.resolve().then(async () => {
      const brew = await executable('brew', ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']);
      if (!brew) throw new Error('Homebrew is required. Install Homebrew, then retry installation.');
      await this.pending?.catch(() => {}); await this.stopChild();
      if (this.closed) return;
      this.state.status = 'installing';
      await new Promise<void>((resolve, reject) => {
        const guard = fileURLToPath(new URL('./backend.guard.js', import.meta.url));
        const child = spawn(process.execPath, [guard, brew, 'install', 'mactop'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1' } });
        this.installer = child;
        const timeout = setTimeout(() => { child.stdin?.end(); reject(new Error('mactop installation timed out (10 minutes)')); }, 600000);
        child.stdout?.on('data', chunk => this.append(chunk.toString())); child.stderr?.on('data', chunk => this.append(chunk.toString()));
        child.once('error', error => { clearTimeout(timeout); reject(error); });
        child.once('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`mactop installation failed (${code}); see installation output`)); });
      });
      if (this.closed) return;
      if (!await this.binary()) throw new Error('mactop installation finished without an executable');
      if (!this.closed) { this.state.status = 'starting'; this.nextAttempt = 0; }
    }).catch(error => { if (!this.closed) { this.state.status = 'failed'; this.state.error = error.message; } }).finally(() => { this.installer = null; this.installation = null; });
    // Return immediately so RPC/browser deadlines do not cancel a brew install.
  }
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.closed = true;
    this.onExit();
    this.disposal = Promise.all([this.stopChild(), this.terminate(this.installer)]).then(async () => {
      await this.pending?.catch(() => {}); await this.installation;
      this.state.status = 'stopped';
      process.off('exit', this.onExit);
    });
    return this.disposal;
  }
}

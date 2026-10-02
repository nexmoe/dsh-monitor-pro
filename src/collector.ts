import si from 'systeminformation';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dedupeFsSize, parsePrometheusText, findMetricValue, RawDataAdapter } from './upstream.js';
import { emptySample, validateBackendUrl, type MonitorConfig, type Sample } from './types.js';
const exec = promisify(execFile);
const finite = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const positive = (v: unknown): number | null => { const n = finite(v); return n !== null && n > 0 ? n : null; };
const rate = (v: unknown): number | null => { const n = finite(v); return n !== null && n >= 0 ? n : null; };
const percent = (v: number) => Math.min(100, Math.max(0, v));

export function parseGpuCsv(text: string): Sample['gpus'] {
  return text.split('\n').flatMap(line => {
    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 5) return [];
    const number = (value: string) => value === '' || value === 'N/A' || value === '[N/A]' ? null : finite(Number(value));
    return [{ model: parts[0], utilization: number(parts[1]), temperature: positive(number(parts[2])), memUsed: number(parts[3]) === null ? null : Number(parts[3]) * 1024 ** 2, memTotal: positive(number(parts[4])) === null ? null : Number(parts[4]) * 1024 ** 2 }];
  });
}
async function gpuCards(): Promise<Sample['gpus']> {
  try {
    const { stdout } = await exec('nvidia-smi', ['--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'], { timeout: 4000, maxBuffer: 256 * 1024 });
    return parseGpuCsv(stdout);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
function selectDisks(rows: Sample['disks'], config: MonitorConfig): Sample['disks'] {
  // Explicit mount selection precedes upstream APFS deduplication so a chosen
  // system mount does not disappear in favor of the data volume.
  const selected = config.diskMounts.length ? rows.filter(d => config.diskMounts.includes(d.mount)) : rows;
  return dedupeFsSize(selected).filter(d => d.size > 0).map(d => ({ fs: d.fs, mount: d.mount, size: d.size, used: d.used, use: percent(d.use) })).sort((a, b) => a.mount.localeCompare(b.mount));
}
export class Collector {
  private go = new RawDataAdapter();
  private goPrevious: { timestamp: number; network: Map<string, { bytesRecv: number; bytesSent: number }>; disk: Map<string, { readBytes: number; writeBytes: number }> } | null = null;
  async collect(config: MonitorConfig): Promise<Sample> {
    if (!config.metrics.length) return this.base();
    if (config.source === 'go') return this.collectGo(config);
    if (config.source === 'mactop') return this.collectMactop(config);
    return this.collectSI(config);
  }
  private base(): Sample {
    const sample = emptySample();
    sample.host = { hostname: os.hostname(), platform: os.platform(), arch: os.arch(), release: os.release(), uptime: os.uptime() };
    return sample;
  }
  private async collectSI(config: MonitorConfig): Promise<Sample> {
    const sample = this.base();
    const enabled = new Set(config.metrics);
    const jobs: Promise<void>[] = [];
    const run = <T>(name: string, query: () => Promise<T>, assign: (v: T) => void) => {
      jobs.push(Promise.resolve().then(query).then(assign).catch(() => { sample.errors.push(name); }));
    };
    if (enabled.has('cpu')) run('cpu', () => si.currentLoad(), v => { sample.cpu = finite(v.currentLoad); sample.cores = v.cpus.map(c => percent(c.load)); });
    if (enabled.has('memory')) run('memory', () => si.mem(), v => { if (v.total > 0) sample.memory = { total: v.total, used: v.used, active: finite(v.active), available: finite(v.available), swapUsed: finite(v.swapused), swapTotal: finite(v.swaptotal) }; });
    if (enabled.has('network')) run('network', () => si.networkStats(config.networkInterface || '*'), rows => {
      const active = rows.filter(r => r.iface !== 'lo' && r.iface !== 'lo0' && (r.operstate === 'up' || r.operstate === 'unknown'));
      if (!active.length) return;
      const sum = (pick: (v: typeof active[number]) => number) => active.every(v => rate(pick(v)) !== null) ? active.reduce((n, v) => n + pick(v), 0) : null;
      sample.network = { rx: sum(v => v.rx_sec), tx: sum(v => v.tx_sec), interfaces: active.map(v => v.iface) };
    });
    if (enabled.has('diskIO')) run('diskIO', () => si.fsStats(), v => { sample.diskIO = { read: rate(v.rx_sec), write: rate(v.wx_sec) }; });
    if (enabled.has('diskSpace')) run('diskSpace', () => si.fsSize(), v => { sample.disks = selectDisks(v, config); });
    if (enabled.has('cpuSpeed')) run('cpuSpeed', () => si.cpuCurrentSpeed(), v => { sample.cpuSpeed = positive(v.avg); });
    if (enabled.has('cpuTemp')) run('cpuTemp', () => si.cpuTemperature(), v => { sample.cpuTemp = positive(v.main); });
    if (enabled.has('battery')) run('battery', () => si.battery(), v => {
      if (v.hasBattery && rate(v.percent) !== null) sample.battery = { percent: percent(v.percent), charging: v.isCharging, acConnected: v.acConnected, health: v.designedCapacity > 0 ? percent(v.maxCapacity / v.designedCapacity * 100) : null, timeRemaining: positive(v.timeRemaining) };
    });
    if (enabled.has('gpu')) run('gpu', gpuCards, v => { sample.gpus = v; });
    await Promise.all(jobs);
    sample.timestamp = Date.now();
    return sample;
  }
  private async backend(config: MonitorConfig, path: string): Promise<Response> {
    const response = await fetch(new URL(path, validateBackendUrl(config.backendUrl)), { signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!response.ok) throw new Error(`${config.source}: HTTP ${response.status}`);
    return response;
  }
  private async collectMactop(config: MonitorConfig): Promise<Sample> {
    const response = await this.backend(config, '/metrics');
    const metrics = parsePrometheusText(await response.text());
    if (!metrics.some(m => m.name.startsWith('mactop_'))) throw new Error('mactop endpoint returned no mactop metrics');
    const get = (name: string, labels?: Record<string, string>) => finite(findMetricValue(metrics, name, labels));
    // Supplement only dimensions absent from mactop. Its active memory equals
    // used memory; temperature and power represent the SoC, not CPU/battery.
    const supplemental = config.metrics.filter(m => ['diskSpace', 'battery'].includes(m));
    const sample = await this.collectSI({ ...config, metrics: supplemental });
    const enabled = new Set(config.metrics);
    if (enabled.has('cpu')) {
      sample.cpu = get('mactop_cpu_usage_percent');
      sample.cores = metrics.filter(m => m.name === 'mactop_cpu_core_usage_percent').sort((a, b) => Number(a.labels.core) - Number(b.labels.core)).map(m => percent(m.value));
    }
    if (enabled.has('memory')) {
      const total = positive(get('mactop_memory_gb', { type: 'total' }));
      const used = rate(get('mactop_memory_gb', { type: 'used' }));
      const gib = (value: number | null) => value === null ? null : value * 1024 ** 3;
      if (total !== null && used !== null) sample.memory = { total: total * 1024 ** 3, used: used * 1024 ** 3, active: used * 1024 ** 3, available: Math.max(0, total - used) * 1024 ** 3, swapUsed: gib(rate(get('mactop_memory_gb', { type: 'swap_used' }))), swapTotal: gib(rate(get('mactop_memory_gb', { type: 'swap_total' }))) };
    }
    const kb = (n: number | null) => n === null ? null : Math.max(0, n) * 1024;
    if (enabled.has('network')) sample.network = { rx: kb(get('mactop_network_kbytes_per_sec', { direction: 'download' })), tx: kb(get('mactop_network_kbytes_per_sec', { direction: 'upload' })), interfaces: ['mactop'] };
    if (enabled.has('diskIO')) sample.diskIO = { read: kb(get('mactop_disk_kbytes_per_sec', { operation: 'read' })), write: kb(get('mactop_disk_kbytes_per_sec', { operation: 'write' })) };
    if (enabled.has('cpuTemp')) sample.cpuTemp = positive(get('mactop_soc_temp_celsius'));
    if (enabled.has('power')) { const watts = rate(get('mactop_power_watts', { component: 'total' })); if (watts !== null) sample.power = { watts, kind: 'soc' }; }
    if (enabled.has('gpu')) {
      const utilization = get('mactop_gpu_usage_percent'), temperature = positive(get('mactop_gpu_temp_celsius'));
      if (utilization !== null || temperature !== null) sample.gpus = [{ model: 'Apple Silicon GPU', utilization, temperature, memUsed: null, memTotal: null }];
    }
    return sample;
  }
  private async collectGo(config: MonitorConfig): Promise<Sample> {
    const mapping: Record<string, string[]> = { cpu: ['cpu'], memory: ['memoryUsed', 'memoryActive'], network: ['network'], diskIO: ['fileSystem'], diskSpace: ['diskSpace'], battery: ['battery'], cpuSpeed: ['cpuSpeed'], cpuTemp: ['cpuTemp'], gpu: ['gpu'], power: ['battery'] };
    const query = encodeURIComponent(config.metrics.flatMap(m => mapping[m]).join(','));
    const response = await this.backend(config, `/api/v1/all?metrics=${query}`);
    const envelope = await response.json() as { success: boolean; data: unknown };
    if (!envelope.success || !envelope.data) throw new Error('Go backend returned success=false or missing data');
    const data = envelope.data as any;
    if (!data.cpu || !data.memory || !data.network || !data.disk || !data.host) throw new Error('Invalid Go backend payload');
    const raw = this.go.toSnapshot(data);
    const sample = this.base(), enabled = new Set(config.metrics);
    if (enabled.has('cpu')) sample.cpu = finite(data.cpu.percent?.[0]);
    if (enabled.has('memory') && raw.mem.total > 0) sample.memory = { total: raw.mem.total, used: raw.mem.used, active: finite(raw.mem.active), available: finite(raw.mem.available), swapUsed: finite(data.memory.swap?.used), swapTotal: finite(data.memory.swap?.total) };
    const networks = data.network.ioCounters ?? [];
    const disks = Object.values(data.disk.ioCounters ?? {}) as any[];
    const net = networks.find((n: any) => n.name !== 'lo' && n.name !== 'lo0');
    const disk = disks.find(d => !d.name.startsWith('loop'));
    const elapsed = this.goPrevious ? (sample.timestamp - this.goPrevious.timestamp) / 1000 : 0;
    const delta = (value: number, previous: number | undefined) => previous === undefined || elapsed <= 0 || value < previous ? null : rate((value - previous) / elapsed);
    if (enabled.has('network') && net) {
      const previous = this.goPrevious?.network.get(net.name);
      sample.network = { rx: delta(net.bytesRecv, previous?.bytesRecv), tx: delta(net.bytesSent, previous?.bytesSent), interfaces: [net.name] };
    }
    if (enabled.has('diskIO') && disk) {
      const previous = this.goPrevious?.disk.get(disk.name);
      sample.diskIO = { read: delta(disk.readBytes, previous?.readBytes), write: delta(disk.writeBytes, previous?.writeBytes) };
    }
    this.goPrevious = { timestamp: sample.timestamp, network: new Map(networks.map((n: any) => [n.name, n])), disk: new Map(disks.map(d => [d.name, d])) };
    if (enabled.has('diskSpace')) sample.disks = selectDisks(raw.fsSize, config);
    if (enabled.has('cpuSpeed')) sample.cpuSpeed = positive(raw.cpuCurrentSpeed.avg);
    if (enabled.has('cpuTemp')) sample.cpuTemp = positive(raw.cpuTemperature.main);
    if (enabled.has('battery') && raw.battery.hasBattery && finite(raw.battery.percent) !== null) sample.battery = { percent: percent(raw.battery.percent), charging: raw.battery.isCharging, acConnected: raw.battery.acConnected, health: positive(raw.battery.health), timeRemaining: positive(raw.battery.timeRemaining) };
    if (enabled.has('power') && raw.battery.hasBattery && finite(raw.battery.powerRate) !== null) sample.power = { watts: raw.battery.powerRate, kind: 'battery' };
    return sample;
  }
}

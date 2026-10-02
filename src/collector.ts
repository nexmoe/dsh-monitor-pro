import si from 'systeminformation';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dedupeFsSize, parsePrometheusText, findMetricValue, RawDataAdapter } from './upstream.js';
import { emptySample, validateBackendUrl, selectSource, enabledMetric, type MonitorConfig, type Sample, type Metric } from './types.js';
const exec = promisify(execFile);
const finite = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const positive = (v: unknown): number | null => { const n = finite(v); return n !== null && n > 0 ? n : null; };
const rate = (v: unknown): number | null => { const n = finite(v); return n !== null && n >= 0 ? n : null; };
const percent = (v: number) => Math.min(100, Math.max(0, v));
const emptyBattery = (): NonNullable<Sample['battery']> => ({ percent: 0, charging: false, acConnected: false, health: null, timeRemaining: null, cycleCount: null, currentCapacity: null, maxCapacity: null, designedCapacity: null, capacityUnit: '', voltage: null, state: 'idle', model: '', manufacturer: '' });
export function estimateBatteryMinutes(watts: number, max: number, current: number, charging: boolean): number | null {
  if (!Number.isFinite(watts) || !watts || max <= 0 || current <= 0) return null;
  const hours = (charging ? max - current : current) / (Math.abs(watts) * 1000);
  return hours > 0 && hours <= 48 ? Math.round(hours * 60) : null;
}
export function parseGpuCsv(text: string): Sample['gpus'] {
  return text.split('\n').flatMap(line => {
    const parts = line.split(',').map(p => p.trim());
    if (parts.length < 5) return [];
    const number = (value: string) => value === '' || value === 'N/A' || value === '[N/A]' ? null : finite(Number(value));
    return [{ model: parts[0], utilization: number(parts[1]), temperature: positive(number(parts[2])), memUsed: number(parts[3]) === null ? null : Number(parts[3]) * 1024 ** 2, memTotal: positive(number(parts[4])) === null ? null : Number(parts[4]) * 1024 ** 2 }];
  });
}
async function gpuCards(): Promise<Sample['gpus']> {
  try { const { stdout } = await exec('nvidia-smi', ['--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'], { timeout: 4000, maxBuffer: 256 * 1024 }); return parseGpuCsv(stdout); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
function selectDisks(rows: Sample['disks'], config: MonitorConfig): Sample['disks'] {
  // Explicit selection precedes deduplication so a requested APFS mount remains
  // visible even when its data volume is the default representative.
  const selected = config.diskMounts.length ? rows.filter(d => config.diskMounts.includes(d.mount)) : rows;
  return dedupeFsSize(selected).filter(d => d.size > 0).map(d => ({ fs: d.fs, mount: d.mount, size: d.size, used: d.used, use: percent(d.use) })).sort((a, b) => a.mount.localeCompare(b.mount));
}
export class Collector {
  private go = new RawDataAdapter();
  private goPrevious: { timestamp: number; network: Map<string, { bytesRecv: number; bytesSent: number }>; disk: Map<string, { readBytes: number; writeBytes: number }> } | null = null;
  async collect(config: MonitorConfig): Promise<Sample> {
    if (!config.metrics.length) return this.base();
    const source = selectSource(config);
    if (source === 'go') return this.collectGo(config);
    if (source === 'mactop') return this.collectMactop(config);
    return this.collectSI(config);
  }
  private base(): Sample {
    const sample = emptySample();
    sample.host = { hostname: os.hostname(), platform: os.platform(), arch: os.arch(), release: os.release(), uptime: os.uptime(), distro: os.type() };
    return sample;
  }
  private async collectSI(config: MonitorConfig): Promise<Sample> {
    const sample = this.base(), has = (m: Metric) => enabledMetric(config.metrics, m);
    const jobs: Promise<void>[] = [];
    const run = <T>(name: string, query: () => Promise<T>, assign: (v: T) => void) => { jobs.push(Promise.resolve().then(query).then(assign).catch(() => { sample.errors.push(name); })); };
    if (has('cpu')) run('cpu', () => si.currentLoad(), v => { sample.cpu = finite(v.currentLoad); sample.cores = v.cpus.map(c => percent(c.load)); });
    if (has('memory')) run('memory', () => si.mem(), v => { if (v.total > 0) sample.memory = { total: v.total, used: v.used, active: finite(v.active), available: finite(v.available), swapUsed: finite(v.swapused), swapTotal: finite(v.swaptotal) }; });
    if (has('network')) run('network', () => config.networkInterface ? si.networkStats(config.networkInterface) : si.networkStats(), rows => {
      const active = config.networkInterface === '*' ? rows.filter(r => r.iface !== 'lo' && r.iface !== 'lo0' && (r.operstate === 'up' || r.operstate === 'unknown')) : rows.slice(0, 1);
      if (!active.length) return;
      const sum = (pick: (v: typeof active[number]) => number) => active.every(v => rate(pick(v)) !== null) ? active.reduce((n, v) => n + pick(v), 0) : null;
      sample.network = { rx: sum(v => v.rx_sec), tx: sum(v => v.tx_sec), interfaces: active.map(v => v.iface) };
    });
    if (has('diskIO')) run('diskIO', () => si.fsStats(), v => { sample.diskIO = { read: rate(v.rx_sec), write: rate(v.wx_sec) }; });
    if (has('diskSpace')) run('diskSpace', () => si.fsSize(), v => { sample.disks = selectDisks(v, config); });
    if (has('cpuSpeed')) run('cpuSpeed', () => si.cpuCurrentSpeed(), v => { sample.cpuSpeed = positive(v.avg); sample.cpuSpeedMin = positive(v.min); sample.cpuSpeedMax = positive(v.max); sample.cpuSpeedCores = v.cores; });
    if (has('cpuTemp')) run('cpuTemp', () => si.cpuTemperature(), v => { sample.cpuTemp = positive(v.main); sample.cpuTempMax = positive(v.max); sample.cpuTempCores = v.cores.filter(t => t > 0); });
    if (has('osDistro')) run('osDistro', () => si.osInfo(), v => { sample.host.distro = v.distro; sample.host.release = v.release; });
    if (has('battery') || has('power')) run('battery', () => si.battery(), v => {
      if (v.hasBattery && rate(v.percent) !== null) sample.battery = { ...emptyBattery(), percent: percent(v.percent), charging: v.isCharging, acConnected: v.acConnected, health: v.designedCapacity > 0 ? percent(v.maxCapacity / v.designedCapacity * 100) : null, timeRemaining: positive(v.timeRemaining), cycleCount: rate(v.cycleCount), currentCapacity: positive(v.currentCapacity), maxCapacity: positive(v.maxCapacity), designedCapacity: positive(v.designedCapacity), capacityUnit: v.capacityUnit, voltage: positive(v.voltage), state: v.isCharging ? 'charging' : v.acConnected ? 'idle' : 'discharging', model: v.model, manufacturer: v.manufacturer };
    });
    if (has('gpu')) run('gpu', gpuCards, v => { sample.gpus = v; });
    await Promise.all(jobs); sample.timestamp = Date.now(); return sample;
  }
  private async backend(config: MonitorConfig, path: string): Promise<Response> {
    const response = await fetch(new URL(path, validateBackendUrl(config.backendUrl)), { signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (!response.ok) throw new Error(`${config.source}: HTTP ${response.status}`); return response;
  }
  private async collectMactop(config: MonitorConfig): Promise<Sample> {
    const metrics = parsePrometheusText(await (await this.backend(config, '/metrics')).text());
    if (!metrics.some(m => m.name.startsWith('mactop_'))) throw new Error('mactop endpoint returned no mactop metrics');
    const get = (name: string, labels?: Record<string, string>) => finite(findMetricValue(metrics, name, labels));
    const has = (m: Metric) => enabledMetric(config.metrics, m);
    const supplemental: Metric[] = config.metrics.filter(m => ['diskSpace', 'battery', 'osDistro'].includes(m));
    if (has('power') && !supplemental.includes('battery')) supplemental.push('battery');
    const sample = await this.collectSI({ ...config, metrics: supplemental });
    if (has('cpu')) { sample.cpu = get('mactop_cpu_usage_percent'); sample.cores = metrics.filter(m => m.name === 'mactop_cpu_core_usage_percent').sort((a, b) => Number(a.labels.core) - Number(b.labels.core)).map(m => percent(m.value)); }
    if (has('memory')) {
      const total = positive(get('mactop_memory_gb', { type: 'total' })), used = rate(get('mactop_memory_gb', { type: 'used' }));
      const gib = (value: number | null) => value === null ? null : value * 1024 ** 3;
      if (total !== null && used !== null) sample.memory = { total: total * 1024 ** 3, used: used * 1024 ** 3, active: used * 1024 ** 3, available: Math.max(0, total - used) * 1024 ** 3, swapUsed: gib(rate(get('mactop_memory_gb', { type: 'swap_used' }))), swapTotal: gib(rate(get('mactop_memory_gb', { type: 'swap_total' }))) };
    }
    const kb = (n: number | null) => n === null ? null : Math.max(0, n) * 1024;
    if (has('network')) sample.network = { rx: kb(get('mactop_network_kbytes_per_sec', { direction: 'download' })), tx: kb(get('mactop_network_kbytes_per_sec', { direction: 'upload' })), interfaces: ['mactop'] };
    if (has('diskIO')) sample.diskIO = { read: kb(get('mactop_disk_kbytes_per_sec', { operation: 'read' })), write: kb(get('mactop_disk_kbytes_per_sec', { operation: 'write' })) };
    if (has('cpuTemp')) sample.cpuTempMax = sample.cpuTemp = positive(get('mactop_soc_temp_celsius'));
    if (has('power')) { const watts = rate(get('mactop_power_watts', { component: 'total' })); if (watts !== null) sample.power = { watts, kind: 'soc' }; }
    if (has('gpu')) { const utilization = get('mactop_gpu_usage_percent'), temperature = positive(get('mactop_gpu_temp_celsius')); if (utilization !== null || temperature !== null) sample.gpus = [{ model: 'Apple Silicon GPU', utilization, temperature, memUsed: null, memTotal: null }]; }
    if (has('battery') || has('power')) {
      const battery = rate(get('mactop_battery_percent'));
      if (battery !== null) {
        const charging = get('mactop_battery_charging') === 1;
        sample.battery = { ...(sample.battery ?? emptyBattery()), percent: percent(battery), charging };
        sample.battery.state = charging ? 'charging' : sample.battery.acConnected ? 'idle' : 'discharging';
        sample.errors = sample.errors.filter(name => name !== 'battery');
      }
      if (sample.battery && process.platform === 'darwin') {
        try { const { stdout } = await exec('/usr/bin/pmset', ['-g', 'batt'], { timeout: 2000 }); const match = stdout.match(/(\d+):(\d+)\s+remaining/); if (match) sample.battery.timeRemaining = Number(match[1]) * 60 + Number(match[2]); } catch { /* SI remaining time remains the fallback. */ }
      }
    }
    return sample;
  }
  private async collectGo(config: MonitorConfig): Promise<Sample> {
    const mapping: Partial<Record<Metric, string[]>> = { cpu: ['cpu'], memory: ['memoryUsed', 'memoryActive'], memoryActive: ['memoryActive'], memoryUsed: ['memoryUsed'], memActive: ['memoryActive'], memUsed: ['memoryUsed'], network: ['network'], netRx: ['network'], netTx: ['network'], diskIO: ['fileSystem'], fileSystem: ['fileSystem'], diskRx: ['fileSystem'], diskWx: ['fileSystem'], diskSpace: ['diskSpace'], battery: ['battery'], cpuSpeed: ['cpuSpeed'], cpuTemp: ['cpuTemp'], gpu: ['gpu'], gpuTemp: ['gpuTemp'], gpuMem: ['gpuMem'], power: ['battery'], batteryPower: ['battery'], osDistro: ['osDistro'], uptime: ['uptime'] };
    const query = encodeURIComponent([...new Set(config.metrics.flatMap(m => mapping[m] ?? []))].join(','));
    const envelope = await (await this.backend(config, `/api/v1/all?metrics=${query}`)).json() as { success: boolean; data: unknown };
    if (!envelope.success || !envelope.data) throw new Error('Go backend returned success=false or missing data');
    const data = envelope.data as any;
    if (!data.cpu || !data.memory || !data.network || !data.disk || !data.host) throw new Error('Invalid Go backend payload');
    const raw = this.go.toSnapshot(data), sample = this.base(), has = (m: Metric) => enabledMetric(config.metrics, m);
    sample.host = { hostname: raw.osInfo.hostname || sample.host.hostname, platform: raw.osInfo.platform || sample.host.platform, arch: raw.osInfo.arch || sample.host.arch, release: raw.osInfo.release || sample.host.release, distro: raw.osInfo.distro || sample.host.distro, uptime: finite(raw.time.uptime) ?? sample.host.uptime };
    if (has('cpu')) sample.cpu = finite(data.cpu.percent?.[0]);
    if (has('memory') && raw.mem.total > 0) sample.memory = { total: raw.mem.total, used: raw.mem.used, active: finite(raw.mem.active), available: finite(raw.mem.available), swapUsed: finite(data.memory.swap?.used), swapTotal: finite(data.memory.swap?.total) };
    const networks = data.network.ioCounters ?? [], disks = Object.values(data.disk.ioCounters ?? {}) as any[];
    const net = networks.find((n: any) => config.networkInterface && config.networkInterface !== '*' ? n.name === config.networkInterface : n.name !== 'lo' && n.name !== 'lo0'), disk = disks.find(d => !d.name.startsWith('loop'));
    const elapsed = this.goPrevious ? (sample.timestamp - this.goPrevious.timestamp) / 1000 : 0;
    const delta = (value: number, previous: number | undefined) => previous === undefined || elapsed <= 0 || value < previous ? null : rate((value - previous) / elapsed);
    if (has('network') && net) { const previous = this.goPrevious?.network.get(net.name); sample.network = { rx: delta(net.bytesRecv, previous?.bytesRecv), tx: delta(net.bytesSent, previous?.bytesSent), interfaces: [net.name] }; }
    if (has('diskIO') && disk) { const previous = this.goPrevious?.disk.get(disk.name); sample.diskIO = { read: delta(disk.readBytes, previous?.readBytes), write: delta(disk.writeBytes, previous?.writeBytes) }; }
    this.goPrevious = { timestamp: sample.timestamp, network: new Map(networks.map((n: any) => [n.name, n])), disk: new Map(disks.map(d => [d.name, d])) };
    if (has('diskSpace')) sample.disks = selectDisks(raw.fsSize, config);
    if (has('cpuSpeed')) { sample.cpuSpeed = positive(raw.cpuCurrentSpeed.avg); sample.cpuSpeedMin = positive(raw.cpuCurrentSpeed.min); sample.cpuSpeedMax = positive(raw.cpuCurrentSpeed.max); sample.cpuSpeedCores = raw.cpuCurrentSpeed.cores; }
    if (has('cpuTemp')) { sample.cpuTemp = positive(raw.cpuTemperature.main); sample.cpuTempMax = positive(raw.cpuTemperature.max); sample.cpuTempCores = raw.cpuTemperature.cores; }
    const b = raw.battery;
    if (has('battery') && b.hasBattery && finite(b.percent) !== null) sample.battery = { ...emptyBattery(), percent: percent(b.percent), charging: b.isCharging, acConnected: b.acConnected, health: rate(b.health) === null ? null : percent(b.health), timeRemaining: b.powerState === 'charging' || b.powerState === 'discharging' ? estimateBatteryMinutes(b.powerRate, b.maxCapacity, b.currentCapacity, b.isCharging) : null, cycleCount: rate(b.cycleCount), currentCapacity: positive(b.currentCapacity), maxCapacity: positive(b.maxCapacity), designedCapacity: positive(b.designedCapacity), capacityUnit: b.capacityUnit, voltage: positive(b.voltage), state: b.powerState === 'charging' || b.powerState === 'discharging' ? b.powerState : 'idle', model: b.model, manufacturer: b.manufacturer };
    if (has('power') && b.hasBattery && finite(b.powerRate) !== null) sample.power = { watts: b.powerRate, kind: 'battery' };
    return sample;
  }
}

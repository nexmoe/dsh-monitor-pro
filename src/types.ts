export const METRICS = ['cpu', 'memory', 'network', 'diskIO', 'diskSpace', 'battery', 'cpuSpeed', 'cpuTemp', 'gpu', 'power', 'memoryActive', 'memoryUsed', 'fileSystem', 'gpuTemp', 'gpuMem', 'osDistro', 'uptime', 'memActive', 'memUsed', 'netRx', 'netTx', 'diskRx', 'diskWx', 'batteryPower'] as const;
export type Metric = typeof METRICS[number];
export type Source = 'systeminformation' | 'mactop' | 'go';
export interface MonitorConfig {
  intervalMs: number;
  historySize: number;
  metrics: Metric[];
  source: Source | 'auto';
  mactopEnabled: boolean;
  backendUrl: string;
  networkInterface: string;
  diskMounts: string[];
}
// Keep the original ten group names valid for profiles created before 0.2.
export const DEFAULT_METRICS: Metric[] = ['cpu', 'memActive', 'memUsed', 'netRx', 'netTx', 'diskRx', 'diskWx', 'battery', 'batteryPower', 'cpuTemp', 'cpuSpeed', 'gpu', 'gpuTemp', 'gpuMem', 'diskSpace', 'osDistro', 'uptime'];
export const enabledMetric = (metrics: Metric[], group: Metric) => metrics.includes(group) || ({ memory: ['memoryActive', 'memoryUsed', 'memActive', 'memUsed'], network: ['netRx', 'netTx'], diskIO: ['fileSystem', 'diskRx', 'diskWx'], gpu: ['gpuTemp', 'gpuMem'], power: ['batteryPower'] } as Partial<Record<Metric, string[]>>)[group]?.some(m => metrics.includes(m as Metric)) === true;
export interface Sample {
  timestamp: number;
  cpu: number | null;
  cores: number[];
  memory: { total: number; used: number; active: number | null; available: number | null; swapUsed: number | null; swapTotal: number | null } | null;
  network: { rx: number | null; tx: number | null; interfaces: string[] } | null;
  diskIO: { read: number | null; write: number | null } | null;
  disks: { fs: string; mount: string; size: number; used: number; use: number }[];
  battery: { percent: number; charging: boolean; acConnected: boolean; health: number | null; timeRemaining: number | null; cycleCount: number | null; currentCapacity: number | null; maxCapacity: number | null; designedCapacity: number | null; capacityUnit: string; voltage: number | null; state: 'charging' | 'discharging' | 'idle'; model: string; manufacturer: string } | null;
  cpuSpeed: number | null;
  cpuSpeedMin: number | null;
  cpuSpeedMax: number | null;
  cpuSpeedCores: number[];
  cpuTemp: number | null;
  cpuTempMax: number | null;
  cpuTempCores: number[];
  gpus: { model: string; utilization: number | null; temperature: number | null; memUsed: number | null; memTotal: number | null }[];
  power: { watts: number; kind: 'soc' | 'battery' } | null;
  host: { hostname: string; platform: string; arch: string; release: string; uptime: number; distro: string };
  errors: string[];
}
export interface BackendState {
  source: Source;
  managed: boolean;
  status: 'disabled' | 'starting' | 'ready' | 'missing' | 'failed' | 'installing' | 'stopped' | 'external';
  error: string | null;
  installCommand: string | null;
  canInstall: boolean;
  log: string;
}
export interface Payload {
  generation: string;
  config: MonitorConfig;
  backend: BackendState;
  current: Sample | null;
  history: Sample[];
  status: 'starting' | 'live' | 'degraded' | 'error' | 'stopped';
  error: string | null;
  lastAttempt: number | null;
}
export const emptySample = (): Sample => ({
  timestamp: Date.now(), cpu: null, cores: [], memory: null, network: null, diskIO: null,
  disks: [], battery: null, cpuSpeed: null, cpuSpeedMin: null, cpuSpeedMax: null, cpuSpeedCores: [], cpuTemp: null, cpuTempMax: null, cpuTempCores: [], gpus: [], power: null,
  host: { hostname: '', platform: '', arch: '', release: '', uptime: 0, distro: '' }, errors: [],
});
export function selectSource(config: Pick<MonitorConfig, 'source' | 'mactopEnabled'>, platform = process.platform, arch = process.arch): Source {
  if (config.source !== 'auto') return config.source;
  if (platform === 'win32') return 'go';
  if (platform === 'darwin' && arch === 'arm64' && config.mactopEnabled) return 'mactop';
  return 'systeminformation';
}
export function validateBackendUrl(value: string): URL {
  const url = new URL(value);
  // Legacy endpoint overrides remain loopback-only; managed processes never
  // accept an arbitrary address or forward credentials/redirects.
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('backendUrl must be a loopback HTTP origin, e.g. http://127.0.0.1:8888');
  }
  return url;
}
export function normalizeConfig(input: Partial<MonitorConfig> = {}): MonitorConfig {
  const intervalMs = input.intervalMs ?? 2000;
  const historySize = input.historySize ?? 60;
  if (!Number.isInteger(intervalMs) || intervalMs < 500 || intervalMs > 60000) throw new Error('intervalMs must be an integer between 500 and 60000');
  if (!Number.isInteger(historySize) || historySize < 10 || historySize > 600) throw new Error('historySize must be an integer between 10 and 600');
  const metrics = input.metrics ?? DEFAULT_METRICS;
  if (!Array.isArray(metrics) || metrics.some(m => !METRICS.includes(m))) throw new Error('Unknown monitor metric');
  const source = input.source ?? 'auto';
  if (!['auto', 'systeminformation', 'mactop', 'go'].includes(source)) throw new Error('Unknown monitor source');
  const backendUrl = input.backendUrl ?? '';
  if (typeof backendUrl !== 'string') throw new Error('backendUrl must be a string');
  if (backendUrl) validateBackendUrl(backendUrl);
  if (input.mactopEnabled !== undefined && typeof input.mactopEnabled !== 'boolean') throw new Error('mactopEnabled must be a boolean');
  if (input.networkInterface !== undefined && typeof input.networkInterface !== 'string') throw new Error('networkInterface must be a string');
  if (input.diskMounts && (!Array.isArray(input.diskMounts) || input.diskMounts.some(x => typeof x !== 'string'))) throw new Error('diskMounts must contain strings');
  return { intervalMs, historySize, metrics: [...new Set(metrics)], source, mactopEnabled: input.mactopEnabled ?? true, backendUrl, networkInterface: input.networkInterface ?? '', diskMounts: input.diskMounts ?? [] };
}

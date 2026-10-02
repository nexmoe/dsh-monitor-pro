export const METRICS = ['cpu', 'memory', 'network', 'diskIO', 'diskSpace', 'battery', 'cpuSpeed', 'cpuTemp', 'gpu', 'power'] as const;
export type Metric = typeof METRICS[number];
export interface MonitorConfig {
  intervalMs: number;
  historySize: number;
  metrics: Metric[];
  source: 'systeminformation' | 'mactop' | 'go';
  backendUrl: string;
  networkInterface: string;
  diskMounts: string[];
}
export interface Sample {
  timestamp: number;
  cpu: number | null;
  cores: number[];
  memory: { total: number; used: number; active: number | null; available: number | null; swapUsed: number | null; swapTotal: number | null } | null;
  network: { rx: number | null; tx: number | null; interfaces: string[] } | null;
  diskIO: { read: number | null; write: number | null } | null;
  disks: { fs: string; mount: string; size: number; used: number; use: number }[];
  battery: { percent: number; charging: boolean; acConnected: boolean; health: number | null; timeRemaining: number | null } | null;
  cpuSpeed: number | null;
  cpuTemp: number | null;
  gpus: { model: string; utilization: number | null; temperature: number | null; memUsed: number | null; memTotal: number | null }[];
  power: { watts: number; kind: 'soc' | 'battery' } | null;
  host: { hostname: string; platform: string; arch: string; release: string; uptime: number };
  errors: string[];
}
export interface Payload {
  generation: string;
  config: MonitorConfig;
  current: Sample | null;
  history: Sample[];
  status: 'starting' | 'live' | 'degraded' | 'error' | 'stopped';
  error: string | null;
  lastAttempt: number | null;
}
export const emptySample = (): Sample => ({
  timestamp: Date.now(), cpu: null, cores: [], memory: null, network: null, diskIO: null,
  disks: [], battery: null, cpuSpeed: null, cpuTemp: null, gpus: [], power: null,
  host: { hostname: '', platform: '', arch: '', release: '', uptime: 0 }, errors: [],
});
export function validateBackendUrl(value: string): URL {
  const url = new URL(value);
  // Native endpoints are local, explicitly configured services. Do not forward
  // requests, credentials or redirects to arbitrary network destinations.
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('backendUrl must be a loopback HTTP origin, e.g. http://127.0.0.1:8888');
  }
  return url;
}
export function normalizeConfig(input: Partial<MonitorConfig> = {}): MonitorConfig {
  const intervalMs = input.intervalMs ?? 2000;
  const historySize = input.historySize ?? 60;
  if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 60000) throw new Error('intervalMs must be an integer between 1000 and 60000');
  if (!Number.isInteger(historySize) || historySize < 10 || historySize > 600) throw new Error('historySize must be an integer between 10 and 600');
  const metrics = input.metrics ?? [...METRICS];
  if (!Array.isArray(metrics) || metrics.some(m => !METRICS.includes(m))) throw new Error('Unknown monitor metric');
  const source = input.source ?? 'systeminformation';
  if (!['systeminformation', 'mactop', 'go'].includes(source)) throw new Error('Unknown monitor source');
  const backendUrl = input.backendUrl ?? 'http://127.0.0.1:8888';
  if (source !== 'systeminformation') validateBackendUrl(backendUrl);
  if (input.diskMounts && (!Array.isArray(input.diskMounts) || input.diskMounts.some(x => typeof x !== 'string'))) throw new Error('diskMounts must contain strings');
  return { intervalMs, historySize, metrics: [...new Set(metrics)], source, backendUrl, networkInterface: input.networkInterface ?? '', diskMounts: input.diskMounts ?? [] };
}

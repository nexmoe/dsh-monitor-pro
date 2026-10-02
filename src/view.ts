import { METRICS, DEFAULT_METRICS, type Metric, type Sample } from './types.js';
export const CARDS = DEFAULT_METRICS;
export type ChartMode = 'line' | 'bar' | 'array';
export interface ViewPreferences {
  order: Metric[]; hidden: Metric[]; unit: 'binary' | 'decimal'; decimals: number; cores: boolean; networkUnit: 'bytes' | 'bits';
  modes: Partial<Record<Metric, ChartMode>>; colors: Partial<Record<Metric, string>>;
  significantDigits: Partial<Record<Metric, number>>; precision: 'decimals' | 'significant'; showSpace: boolean; singleUnit: boolean; uptimeFormat: string;
}
export const defaultPreferences = (): ViewPreferences => ({ order: [...CARDS], hidden: [], unit: 'binary', decimals: 1, cores: true, networkUnit: 'bytes', modes: {}, colors: {}, significantDigits: {}, precision: 'significant', showSpace: false, singleUnit: false, uptimeFormat: '{d}d {h}h {m}m' });
const expand = (m: Metric): Metric[] => ({ memory: ['memActive', 'memUsed'], memoryActive: ['memActive'], memoryUsed: ['memUsed'], network: ['netRx', 'netTx'], diskIO: ['diskRx', 'diskWx'], fileSystem: ['diskRx', 'diskWx'], power: ['batteryPower'] } as Partial<Record<Metric, Metric[]>>)[m] ?? [m];
export function visibleCards(metrics: Metric[]): Metric[] { return [...new Set(metrics.flatMap(expand))].filter(m => CARDS.includes(m)); }
export function parsePreferences(raw: unknown): ViewPreferences {
  if (!raw || typeof raw !== 'object') return defaultPreferences();
  const value = raw as Partial<ViewPreferences>, defaults = defaultPreferences();
  const order = Array.isArray(value.order) ? [...new Set(value.order.filter(m => METRICS.includes(m)).flatMap(expand))] : [];
  const modes: ViewPreferences['modes'] = {}, colors: ViewPreferences['colors'] = {}, digits: ViewPreferences['significantDigits'] = {};
  for (const m of CARDS) {
    if (['line', 'bar', 'array'].includes(value.modes?.[m] ?? '')) modes[m] = value.modes![m];
    if (/^#[\da-f]{6}$/i.test(value.colors?.[m] ?? '')) colors[m] = value.colors![m];
    const n = value.significantDigits?.[m]; if (Number.isInteger(n) && n! >= 1 && n! <= 6) digits[m] = n;
  }
  return { ...defaults, order: [...order, ...CARDS.filter(m => !order.includes(m))], hidden: Array.isArray(value.hidden) ? [...new Set(value.hidden.filter(m => METRICS.includes(m)).flatMap(expand))] : [], unit: value.unit === 'decimal' ? 'decimal' : 'binary', decimals: Number.isInteger(value.decimals) && value.decimals! >= 0 && value.decimals! <= 3 ? value.decimals! : 1, cores: value.cores !== false, networkUnit: value.networkUnit === 'bits' ? 'bits' : 'bytes', modes, colors, significantDigits: digits, precision: value.precision === 'decimals' || value.precision === undefined && value.decimals !== undefined ? 'decimals' : 'significant', showSpace: value.showSpace ?? true, singleUnit: value.singleUnit === true, uptimeFormat: typeof value.uptimeFormat === 'string' && value.uptimeFormat.length <= 100 ? value.uptimeFormat : defaults.uptimeFormat };
}
export function formatNumber(n: number, prefs: Pick<ViewPreferences, 'decimals'> & Partial<ViewPreferences>, metric?: Metric): string {
  if (!Number.isFinite(n)) return '—';
  return prefs.precision === 'significant' ? n.toLocaleString(undefined, { minimumSignificantDigits: prefs.significantDigits?.[metric!] ?? 3, maximumSignificantDigits: prefs.significantDigits?.[metric!] ?? 3, useGrouping: false }) : n.toFixed(prefs.decimals);
}
export function formatBytes(value: number | null | undefined, prefs: Pick<ViewPreferences, 'unit' | 'decimals'> & Partial<ViewPreferences>, bits = false, metric?: Metric): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const base = bits || prefs.unit === 'decimal' ? 1000 : 1024;
  const units = bits ? ['bit', 'kbit', 'Mbit', 'Gbit', 'Tbit'] : prefs.unit === 'binary' ? ['B', 'KiB', 'MiB', 'GiB', 'TiB'] : ['B', 'kB', 'MB', 'GB', 'TB'];
  let n = bits ? value * 8 : value, i = 0;
  while (Math.abs(n) >= base && i < units.length - 1) { n /= base; i++; }
  return `${formatNumber(n, prefs, metric)}${prefs.showSpace === false ? '' : ' '}${prefs.singleUnit && !bits ? ['B', 'K', 'M', 'G', 'T'][i] : units[i]}`;
}
export function formatUptime(seconds: number, template = '{d}d {h}h {m}m'): string {
  const value = Math.max(0, Math.floor(seconds));
  const fields: Record<string, number> = { d: Math.floor(value / 86400), h: Math.floor(value % 86400 / 3600), m: Math.floor(value % 3600 / 60), s: value % 60 };
  return template.replace(/\{([dhms])\}/g, (_, key: string) => String(fields[key]));
}
export function aggregateGpu(cards: Sample['gpus']): { utilization: number | null; temperature: number | null; memUsed: number | null; memTotal: number | null; memPercent: number | null } {
  const known = (pick: (c: Sample['gpus'][number]) => number | null) => cards.map(pick).filter((n): n is number => n !== null && Number.isFinite(n));
  const usage = known(c => c.utilization), temperatures = known(c => c.temperature);
  // A partial VRAM sum suggests an incorrect percentage, so require complete
  // used/total pairs; mactop's unified memory remains unavailable.
  const complete = cards.length > 0 && cards.every(c => c.memUsed !== null && c.memTotal !== null && c.memTotal > 0);
  const memUsed = complete ? cards.reduce((n, c) => n + c.memUsed!, 0) : null, memTotal = complete ? cards.reduce((n, c) => n + c.memTotal!, 0) : null;
  return { utilization: usage.length ? usage.reduce((a, b) => a + b, 0) / usage.length : null, temperature: temperatures.length ? Math.max(...temperatures) : null, memUsed, memTotal, memPercent: memUsed !== null && memTotal ? memUsed / memTotal * 100 : null };
}
export function chartPath(points: { timestamp: number; value: number | null }[], max: number, min = 0): string {
  if (!points.length) return '';
  const first = points[0].timestamp, span = Math.max(1, points.at(-1)!.timestamp - first);
  let drawing = false;
  return points.map(point => {
    if (point.value === null || !Number.isFinite(point.value)) { drawing = false; return ''; }
    const x = points.length === 1 ? 100 : (point.timestamp - first) / span * 100;
    const y = 36 - (Math.max(min, Math.min(max, point.value)) - min) / Math.max(1, max - min) * 32;
    const command = drawing ? 'L' : 'M'; drawing = true;
    return `${command}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

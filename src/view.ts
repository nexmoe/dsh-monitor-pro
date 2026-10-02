import { METRICS, type Metric } from './types.js';
export interface ViewPreferences { order: Metric[]; hidden: Metric[]; unit: 'binary' | 'decimal'; decimals: number; cores: boolean; networkUnit: 'bytes' | 'bits' }
export const defaultPreferences = (): ViewPreferences => ({ order: [...METRICS], hidden: [], unit: 'binary', decimals: 1, cores: true, networkUnit: 'bytes' });
export function parsePreferences(raw: unknown): ViewPreferences {
  if (!raw || typeof raw !== 'object') return defaultPreferences();
  const value = raw as Partial<ViewPreferences>;
  const order = Array.isArray(value.order) ? [...new Set(value.order.filter(m => METRICS.includes(m)))] : [];
  return { order: [...order, ...METRICS.filter(m => !order.includes(m))], hidden: Array.isArray(value.hidden) ? value.hidden.filter(m => METRICS.includes(m)) : [], unit: value.unit === 'decimal' ? 'decimal' : 'binary', decimals: Number.isInteger(value.decimals) && value.decimals! >= 0 && value.decimals! <= 3 ? value.decimals! : 1, cores: value.cores !== false, networkUnit: value.networkUnit === 'bits' ? 'bits' : 'bytes' };
}
export function formatBytes(value: number | null | undefined, prefs: Pick<ViewPreferences, 'unit' | 'decimals'>, bits = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const base = bits || prefs.unit === 'decimal' ? 1000 : 1024;
  const units = bits ? ['bit', 'kbit', 'Mbit', 'Gbit', 'Tbit'] : prefs.unit === 'binary' ? ['B', 'KiB', 'MiB', 'GiB', 'TiB'] : ['B', 'kB', 'MB', 'GB', 'TB'];
  let n = bits ? value * 8 : value, i = 0;
  while (Math.abs(n) >= base && i < units.length - 1) { n /= base; i++; }
  return `${n.toFixed(prefs.decimals)} ${units[i]}`;
}
export function formatUptime(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 86400)}d ${Math.floor(value % 86400 / 3600)}h ${Math.floor(value % 3600 / 60)}m`;
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

import * as React from 'react';
import { METRICS, type Metric, type Payload, type Sample } from './types.js';
import { en, zh, zhTw, ja, type TextKey } from './locales.js';
import { defaultPreferences, parsePreferences, visibleCards, formatBytes, formatNumber, formatUptime, aggregateGpu, chartPath, type ViewPreferences, type ChartMode } from './view.js';
import css from './style.css';
const PANEL = 'monitor-pro';
const NS = '@nexmoe/dsh-monitor-pro';
const STORAGE = 'dsh-monitor-pro:view:v1';
export const inject = ['slots', 'layout', 'locale', 'connection'];
function Icon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function SearchIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" strokeLinecap="round" /></svg>;
}
function RefreshIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.2-5.5" strokeLinecap="round" /><path d="M20 4v5h-5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function PlusIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14" strokeLinecap="round" /></svg>;
}
const GROUPS: Partial<Record<TextKey, Metric[]>> = {
  groupOverview: ['cpu', 'memory', 'network', 'diskSpace', 'battery'],
  groupCompute: ['cpuSpeed', 'cpuTemp', 'gpu', 'gpuTemp'],
  groupMemory: ['memActive', 'memUsed', 'gpuMem'],
  groupNetwork: ['netRx', 'netTx'],
  groupStorage: ['diskIO', 'diskRx', 'diskWx'],
  groupPower: ['power', 'batteryPower'],
  groupSystem: ['osDistro', 'uptime'],
};
function Chart({ history, picks, labels, max, format, mode = 'line', color, signed = false }: { history: Sample[]; picks: ((s: Sample) => number | null)[]; labels: string[]; max?: number; format: (n: number) => string; mode?: ChartMode; color?: string; signed?: boolean }) {
  const all = picks.flatMap(pick => history.map(pick)).filter((n): n is number => n !== null && Number.isFinite(n));
  if (!all.length) return null;
  const ceiling = max ?? (signed ? Math.max(1, ...all.map(Math.abs)) : Math.max(1, ...all));
  const floor = signed ? -ceiling : Math.min(0, ...all);
  const zeroY = 36 - (0 - floor) / Math.max(1, ceiling - floor) * 32;
  return <div className="mp-chart">
    <div className="mp-axis"><span>{format(ceiling)}</span><span>{floor < 0 ? format(floor) : '0'}</span></div>
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={labels.join(' / ')}>
      {[4, 20, 36].map(y => <path key={y} d={`M0 ${y}H100`} className="mp-gridline" vectorEffect="non-scaling-stroke" />)}
      {floor < 0 && <path d={`M0 ${zeroY}H100`} className="mp-gridline" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
      {picks.map((pick, i) => mode === 'bar' ? history.map((s, index) => {
        const value = pick(s); if (value === null || !Number.isFinite(value)) return null;
        const y = 36 - (value - floor) / Math.max(1, ceiling - floor) * 32;
        return <rect key={`${i}-${index}`} x={index * 100 / history.length} y={Math.min(y, zeroY)} width={Math.max(.2, 90 / history.length / picks.length)} height={Math.max(.2, Math.abs(y - zeroY))} fill={color ?? ['#67b9ed', '#c594f4'][i % 2]} />;
      }) : <path key={i} d={chartPath(history.map(s => ({ timestamp: s.timestamp, value: pick(s) })), ceiling, floor)} className={`mp-line mp-line-${i % 2}`} style={color ? { stroke: color } : undefined} vectorEffect="non-scaling-stroke" />)}
    </svg>
    <div className="mp-legend">{labels.map((label, i) => <span key={i}><i className={`mp-dot mp-dot-${i}`} />{label}</span>)}</div>
  </div>;
}
export function apply(ctx: any): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh, 'zh-tw': zhTw, ja }), 'monitor-pro: dictionaries');
  // A dictionary alone does not make a language selectable. Reuse an existing
  // language pack when present; own only the definitions this bundle creates.
  for (const language of [{ id: 'zh-TW', label: '繁體中文', fallback: 'en' }, { id: 'ja', label: '日本語', fallback: 'en' }]) {
    ctx.effect(() => {
      if (ctx.locale.getSnapshot().locales.some((entry: { id: string }) => entry.id.toLowerCase() === language.id.toLowerCase())) return;
      return ctx.locale.addLanguage(language);
    }, `monitor-pro: language ${language.id}`);
  }
  const translate = ctx.locale.bind(NS);
  function Page() {
    React.useSyncExternalStore(React.useCallback((notify: () => void) => ctx.locale.subscribe(notify), []), () => ctx.locale.getSnapshot().revision);
    const t = (key: TextKey): string => translate(key);
    const [data, setData] = React.useState<Payload | null>(null);
    const [transportError, setTransportError] = React.useState<string | null>(null);
    const [settings, setSettings] = React.useState(false);
    const [refresh, setRefresh] = React.useState(0);
    const [query, setQuery] = React.useState('');
    const [filter, setFilter] = React.useState<'all' | 'live' | 'unavailable'>('all');
    const [backendBusy, setBackendBusy] = React.useState(false);
    const [dismissed, setDismissed] = React.useState(false);
    async function backendAction(action: string) {
      setBackendBusy(true);
      try {
        const result = await ctx.connection.rpc.call('/api', 'monitor-pro/action', { action });
        if (!result.ok) throw new Error(result.error.message);
        cursor.current = 0; setRefresh(n => n + 1); setTransportError(null); setDismissed(false);
      } catch (error) { setTransportError(String(error)); }
      finally { setBackendBusy(false); }
    }
    const [prefs, setPrefs] = React.useState<ViewPreferences>(() => {
      try { return parsePreferences(JSON.parse(localStorage.getItem(STORAGE) ?? 'null')); } catch { return defaultPreferences(); }
    });
    const [now, setNow] = React.useState(Date.now());
    const cursor = React.useRef(0);
    const generation = React.useRef<string | undefined>(undefined);
    React.useEffect(() => { try { localStorage.setItem(STORAGE, JSON.stringify(prefs)); } catch { /* Private browsers may refuse storage. */ } }, [prefs]);
    React.useEffect(() => {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let request: AbortController | undefined;
      let running = false;
      const poll = async () => {
        if (stopped || running) return;
        if (document.hidden) { timer = setTimeout(poll, 2000); return; }
        running = true;
        request = new AbortController();
        let interval = 2000;
        const deadline = setTimeout(() => request?.abort(), 10000);
        try {
          const result = await ctx.connection.rpc.call('/api', 'monitor-pro/snapshot', { since: cursor.current, generation: generation.current }, request.signal);
          if (!result.ok) throw new Error(result.error.message);
          if (stopped) return;
          const next = result.value as Payload;
          interval = next.config.intervalMs;
          // Reloads can finish between polls, so timestamps alone cannot detect a
          // source change. Capture the generation before React defers this update.
          const resetHistory = generation.current !== next.generation || !cursor.current || !next.current || next.current.timestamp < cursor.current;
          setData(previous => {
            const existing = resetHistory ? [] : previous?.history ?? [];
            const merged = [...new Map([...existing, ...next.history].map(sample => [sample.timestamp, sample])).values()].sort((a, b) => a.timestamp - b.timestamp).slice(-next.config.historySize);
            return { ...next, history: merged };
          });
          cursor.current = next.current?.timestamp ?? 0;
          generation.current = next.generation;
          setTransportError(null);
          setNow(Date.now());
        } catch (error) {
          if (!stopped) { setTransportError(error instanceof Error ? error.message : String(error)); setNow(Date.now()); }
        } finally {
          clearTimeout(deadline);
          running = false;
          if (!stopped) timer = setTimeout(poll, interval);
        }
      };
      const visible = () => { if (!document.hidden && !running) { clearTimeout(timer); void poll(); } };
      document.addEventListener('visibilitychange', visible);
      void poll();
      return () => { stopped = true; clearTimeout(timer); request?.abort(); document.removeEventListener('visibilitychange', visible); };
    }, [refresh]);
    const sample = data?.current;
    const history = data?.history ?? [];
    const stale = !!sample && now - sample.timestamp > Math.max(15000, (data?.config.intervalMs ?? 2000) * 3);
    const status = transportError ? 'error' : stale ? 'stale' : data?.status ?? 'starting';
    const bytes = (n: number | null | undefined, metric: Metric) => formatBytes(n, prefs, false, metric);
    const rate = (n: number | null | undefined, metric: Metric, network = false) => `${formatBytes(n, prefs, network && prefs.networkUnit === 'bits', metric)}/s`;
    const number = (n: number | null | undefined, metric: Metric, suffix = '') => n === null || n === undefined ? '—' : `${formatNumber(n, prefs, metric)}${prefs.showSpace ? suffix : suffix.trimStart()}`;
    const metric = (m: Metric, extra?: string) => t((m === 'power' || m === 'batteryPower') && sample?.power ? sample.power.kind === 'soc' ? 'socPower' : 'batteryPower' : m) + (extra ? ` · ${extra}` : '');
    const row = (label: string, value: string) => <div className="mp-row"><span>{label}</span><strong>{value}</strong></div>;
    const unavailable = <p className="mp-unavailable">{t('unavailable')}</p>;
    const chart = (m: Metric, picks: ((s: Sample) => number | null)[], labels: string[], max?: number, format = (n: number) => number(n, m, '%')) => {
      return <Chart history={history} picks={picks} labels={labels} max={max} format={format} mode={prefs.modes[m]} color={prefs.colors[m]} signed={m === 'batteryPower' && sample?.power?.kind === 'battery'} />;
    };
    function content(m: Metric): React.ReactNode {
      if (!sample) return null;
      switch (m) {
        case 'cpu': return sample.cpu === null ? unavailable : <>
          <div className="mp-value">{number(sample.cpu, m, '%')}</div>
          {prefs.modes[m] === 'array' && sample.cores.length ? chart(m, sample.cores.map((_, i) => s => s.cores[i] ?? null), sample.cores.map((_, i) => `${t('core')} ${i + 1}`), 100) : chart(m, [s => s.cpu], [t('cpu')], 100)}
          {prefs.cores && sample.cores.length > 0 && <div className="mp-cores">{sample.cores.map((n, i) => <div key={i} title={`${t('core')} ${i + 1}: ${number(n, m, '%')}`}><span>{i + 1}</span><div className="mp-meter"><i style={{ width: `${n}%` }} /></div><small>{number(n, m, '%')}</small></div>)}</div>}
        </>;
        case 'memActive': case 'memUsed': return !sample.memory ? unavailable : <>
          <div className="mp-value">{bytes(m === 'memActive' ? sample.memory.active : sample.memory.used, m)}<small> / {bytes(sample.memory.total, m)}</small></div>
          {row(t('available'), bytes(sample.memory.available, m))}{row(t('swap'), `${bytes(sample.memory.swapUsed, m)} / ${bytes(sample.memory.swapTotal, m)}`)}
          {chart(m, [s => { const value = m === 'memActive' ? s.memory?.active : s.memory?.used; return value !== null && value !== undefined && s.memory?.total ? value / s.memory.total * 100 : null; }], [t(m)], 100)}
        </>;
        case 'netRx': case 'netTx': return !sample.network ? unavailable : <>
          <div className="mp-value">{rate(m === 'netRx' ? sample.network.rx : sample.network.tx, m, true)}</div>
          {chart(m, [s => (m === 'netRx' ? s.network?.rx : s.network?.tx) ?? null], [t(m)], undefined, n => rate(n, m, true))}<p className="mp-note">{sample.network.interfaces.join(', ')}</p>
        </>;
        case 'diskRx': case 'diskWx': return !sample.diskIO ? unavailable : <>
          <div className="mp-value">{rate(m === 'diskRx' ? sample.diskIO.read : sample.diskIO.write, m)}</div>
          {chart(m, [s => (m === 'diskRx' ? s.diskIO?.read : s.diskIO?.write) ?? null], [t(m)], undefined, n => rate(n, m))}
        </>;
        case 'osDistro': return <div className="mp-value">{sample.host.distro}<small>{sample.host.release} · {sample.host.arch}</small></div>;
        case 'uptime': return <div className="mp-value">{formatUptime(sample.host.uptime, prefs.uptimeFormat)}</div>;
        case 'memory': return !sample.memory ? unavailable : <>
          <div className="mp-value">{bytes(sample.memory.used, m)}<small> / {bytes(sample.memory.total, m)}</small></div>
          {row(t('active'), bytes(sample.memory.active, m))}{row(t('available'), bytes(sample.memory.available, m))}{row(t('swap'), `${bytes(sample.memory.swapUsed, m)} / ${bytes(sample.memory.swapTotal, m)}`)}
          {chart(m, [s => s.memory ? s.memory.used / s.memory.total * 100 : null, s => s.memory?.active !== null && s.memory?.active !== undefined ? s.memory.active / s.memory.total * 100 : null], [t('used'), t('active')], 100)}
        </>;
        case 'network': return !sample.network ? unavailable : <>
          {row(`↓ ${t('download')}`, rate(sample.network.rx, m, true))}{row(`↑ ${t('upload')}`, rate(sample.network.tx, m, true))}
          {chart(m, [s => s.network?.rx ?? null, s => s.network?.tx ?? null], [t('download'), t('upload')], undefined, n => rate(n, m, true))}
          <p className="mp-note">{sample.network.interfaces.join(', ')}</p>
        </>;
        case 'diskIO': return !sample.diskIO ? unavailable : <>
          {row(t('read'), rate(sample.diskIO.read, m))}{row(t('write'), rate(sample.diskIO.write, m))}
          {chart(m, [s => s.diskIO?.read ?? null, s => s.diskIO?.write ?? null], [t('read'), t('write')], undefined, n => rate(n, m))}
        </>;
        case 'diskSpace': return !sample.disks.length ? unavailable : <div className="mp-disks">{sample.disks.map(d => <div key={`${d.fs}:${d.mount}`} className="mp-disk">
          {row(d.mount, number(d.use, m, '%'))}<div className="mp-meter"><i style={{ width: `${d.use}%` }} /></div><p className="mp-note">{bytes(d.used, m)} / {bytes(d.size, m)} · {d.fs}</p>
        </div>)}</div>;
        case 'battery': return !sample.battery ? unavailable : <>
          <div className="mp-value">{number(sample.battery.percent, m, '%')}<small>{t(sample.battery.charging ? 'charging' : sample.battery.acConnected ? 'plugged' : 'discharging')}</small></div>
          {row(t('health'), number(sample.battery.health, m, '%'))}{row(t('remaining'), !sample.battery.timeRemaining || sample.battery.timeRemaining >= 2880 || sample.battery.state === 'idle' ? '—' : `${Math.round(sample.battery.timeRemaining)} ${t('minutes')}`)}
          {row(t('cycles'), number(sample.battery.cycleCount, m))}{row(t('capacity'), `${number(sample.battery.currentCapacity, m)} / ${number(sample.battery.maxCapacity, m)} ${sample.battery.capacityUnit ?? ''}`)}{row(t('voltage'), number(sample.battery.voltage, m, ' V'))}
          {(sample.battery.model || sample.battery.manufacturer) && <p className="mp-note">{sample.battery.manufacturer} {sample.battery.model}</p>}
          {chart(m, [s => s.battery?.percent ?? null], [t('battery')], 100)}
        </>;
        case 'cpuSpeed': case 'cpuTemp': {
          const speed = m === 'cpuSpeed', value = speed ? sample.cpuSpeed : sample.cpuTemp, suffix = speed ? ' GHz' : ' °C', values = speed ? sample.cpuSpeedCores : sample.cpuTempCores;
          return value === null ? unavailable : <><div className="mp-value">{number(value, m, suffix)}</div>
            {speed && row(t('minimum'), number(sample.cpuSpeedMin, m, suffix))}{row(t('maximum'), number(speed ? sample.cpuSpeedMax : sample.cpuTempMax, m, suffix))}
            {prefs.modes[m] === 'array' && values.length ? chart(m, values.map((_, i) => s => (speed ? s.cpuSpeedCores : s.cpuTempCores)[i] ?? null), values.map((_, i) => `${t('core')} ${i + 1}`), undefined, n => number(n, m, suffix)) : chart(m, [s => speed ? s.cpuSpeed : s.cpuTemp], [t(m)], undefined, n => number(n, m, suffix))}
          </>;
        }
        case 'batteryPower': case 'power': return !sample.power ? unavailable : <><div className="mp-value">{number(sample.power.watts, m, ' W')}</div>{chart(m, [s => s.power?.watts ?? null], [metric(m)], undefined, n => number(n, m, ' W'))}</>;
        case 'gpu': case 'gpuTemp': case 'gpuMem': {
          if (!sample.gpus.length) return unavailable;
          const aggregate = aggregateGpu(sample.gpus), pick = (s: Sample) => { const a = aggregateGpu(s.gpus); return m === 'gpu' ? a.utilization : m === 'gpuTemp' ? a.temperature : a.memPercent; }, suffix = m === 'gpuTemp' ? ' °C' : '%';
          return <><div className="mp-value">{m === 'gpuMem' ? <>{bytes(aggregate.memUsed, m)}<small> / {bytes(aggregate.memTotal, m)}</small></> : number(pick(sample), m, suffix)}</div>
            {prefs.modes[m] === 'array' ? chart(m, sample.gpus.map((_, i) => s => { const g = s.gpus[i]; return !g ? null : m === 'gpu' ? g.utilization : m === 'gpuTemp' ? g.temperature : g.memUsed !== null && g.memTotal ? g.memUsed / g.memTotal * 100 : null; }), sample.gpus.map(g => g.model), m === 'gpuTemp' ? undefined : 100, n => number(n, m, suffix)) : chart(m, [pick], [t(m)], m === 'gpuTemp' ? undefined : 100, n => number(n, m, suffix))}
            {sample.gpus.map((gpu, i) => <div key={`${gpu.model}:${i}`} className="mp-gpu">{row(gpu.model, m === 'gpu' ? number(gpu.utilization, m, '%') : m === 'gpuTemp' ? number(gpu.temperature, m, ' °C') : `${bytes(gpu.memUsed, m)} / ${bytes(gpu.memTotal, m)}`)}</div>)}
          </>;
        }
      }
    }
    const change = (patch: Partial<ViewPreferences>) => setPrefs(p => ({ ...p, ...patch }));
    const move = (index: number, delta: number) => {
      const order = [...prefs.order];
      [order[index], order[index + delta]] = [order[index + delta], order[index]];
      change({ order });
    };
    const download = () => {
      if (!data) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `monitor-pro-${new Date().toISOString().replace(/[:.]/g, '-')}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const enabled = prefs.order.filter(m => visibleCards(data?.config.metrics ?? []).includes(m) && !prefs.hidden.includes(m));
    const needle = query.trim().toLowerCase();
    const matches = (m: Metric) => {
      if (needle && !`${t(m)} ${m}`.toLowerCase().includes(needle)) return false;
      if (filter === 'all' || !sample) return true;
      const node = content(m);
      const missing = node === unavailable;
      return filter === 'unavailable' ? missing : !missing;
    };
    const visible = enabled.filter(matches);
    return <div className="mp-page">
      <style>{css}</style>
      <div className="mp-scroll"><div className="mp-content">
      <header className="mp-header"><div><h1>{t('panel')}</h1><p>{t('intro')}</p></div><div className="mp-toolbar">
        <button className="mp-icon" onClick={() => { cursor.current = 0; setRefresh(n => n + 1); }} aria-label={t('refresh')}><RefreshIcon /></button>
        <button className="mp-primary" onClick={() => setSettings(p => !p)} aria-expanded={settings}><PlusIcon />{t(settings ? 'close' : 'settings')}</button>
      </div></header>
      <div className="mp-filters" role="tablist" aria-label={t('panel')}>
        {([['all', 'filterAll'], ['live', 'filterLive'], ['unavailable', 'filterUnavailable']] as const).map(([id, key]) => <button key={id} role="tab" aria-selected={filter === id} className={filter === id ? 'mp-filter mp-filter-active' : 'mp-filter'} onClick={() => setFilter(id)}>{t(key)}</button>)}
        {(status === 'error' || status === 'stale' || status === 'degraded') && <span className={`mp-status mp-status-${status}`} role="status"><i />{t(status)}</span>}
        <button className="mp-filter" onClick={download} disabled={!data}>{t('export')}</button>
      </div>
      <label className="mp-search"><SearchIcon /><input value={query} placeholder={t('searchMetrics')} onChange={e => setQuery(e.target.value)} type="search" /></label>
      {(transportError || data?.error) && <div className="mp-error" role="alert"><span>{transportError ?? data?.error}</span><button onClick={() => { cursor.current = 0; setRefresh(n => n + 1); }}>{t('retry')}</button></div>}
      {!dismissed && data?.backend?.source === 'mactop' && ['missing', 'failed', 'installing'].includes(data.backend.status) && <section className="mp-settings" aria-label="mactop">
        <h2>{t(data.backend.status === 'installing' ? 'installing' : data.backend.status === 'missing' ? 'missing' : 'error')}</h2>
        <p>{t('installHelp')}</p>{!data.backend.canInstall && data.backend.status === 'missing' && <p>{t('brewHelp')}</p>}
        <div className="mp-toolbar"><button disabled={backendBusy || data.backend.status === 'installing' || !data.backend.canInstall} onClick={() => void backendAction('install')}>{t('install')}</button><button disabled={backendBusy || data.backend.status === 'installing'} onClick={() => void backendAction('retry')}>{t('retry')}</button><button disabled={backendBusy} onClick={() => void backendAction('use-si')}>{t('useSI')}</button><button onClick={() => setDismissed(true)}>{t('dismiss')}</button></div>
        {data.backend.log && <details><summary>{t('installOutput')}</summary><pre className="mp-backend-log">{data.backend.log}</pre></details>}
      </section>}
      {settings && <section className="mp-settings" aria-label={t('settings')}>
        <div className="mp-options"><label>{t('unit')}<select value={prefs.unit} onChange={e => change({ unit: e.target.value as ViewPreferences['unit'] })}><option value="binary">{t('binary')}</option><option value="decimal">{t('decimal')}</option></select></label>
          <label>{t('precision')}<select value={prefs.precision} onChange={e => change({ precision: e.target.value as ViewPreferences['precision'] })}><option value="significant">{t('significant')}</option><option value="decimals">{t('fixed')}</option></select></label>
          <label>{t('decimals')}<select value={prefs.decimals} onChange={e => change({ decimals: Number(e.target.value) })}>{[0, 1, 2, 3].map(n => <option key={n}>{n}</option>)}</select></label>
          <label>{t('networkUnit')}<select value={prefs.networkUnit} onChange={e => change({ networkUnit: e.target.value as ViewPreferences['networkUnit'] })}><option value="bytes">{t('bytes')}</option><option value="bits">{t('bits')}</option></select></label>
          <label className="mp-checkbox"><input type="checkbox" checked={prefs.cores} onChange={e => change({ cores: e.target.checked })} />{t('cores')}</label>
          <label className="mp-checkbox"><input type="checkbox" checked={prefs.showSpace} onChange={e => change({ showSpace: e.target.checked })} />{t('showSpace')}</label><label className="mp-checkbox"><input type="checkbox" checked={prefs.singleUnit} onChange={e => change({ singleUnit: e.target.checked })} />{t('singleUnit')}</label>
          <label>{t('uptimeFormat')}<input value={prefs.uptimeFormat} maxLength={100} onChange={e => change({ uptimeFormat: e.target.value })} /></label>
        </div>
        {data?.config.source === 'systeminformation' && sample?.host.platform === 'darwin' && sample.host.arch === 'arm64' && <button disabled={backendBusy} onClick={() => void backendAction('enable-mactop')}>{t('enableMactop')}</button>}
        <h2>{t('visible')} · {t('order')}</h2><div className="mp-order">{prefs.order.map((m, i) => <div key={m}>
          <label><input type="checkbox" checked={!prefs.hidden.includes(m)} onChange={e => change({ hidden: e.target.checked ? prefs.hidden.filter(x => x !== m) : [...prefs.hidden, m] })} />{t(m)}</label>
          {!['osDistro', 'uptime', 'diskSpace'].includes(m) && <><label>{t('chartMode')}<select value={prefs.modes[m] ?? 'line'} onChange={e => change({ modes: { ...prefs.modes, [m]: e.target.value as ChartMode } })}>{(['line', 'bar', ...(['cpu', 'cpuTemp', 'cpuSpeed', 'gpu', 'gpuTemp', 'gpuMem'].includes(m) ? ['array'] : [])] as ChartMode[]).map(mode => <option key={mode} value={mode}>{t(mode)}</option>)}</select></label><label>{t('color')}<input type="color" value={prefs.colors[m] ?? '#67b9ed'} onChange={e => change({ colors: { ...prefs.colors, [m]: e.target.value } })} /></label></>}
          <label>{t('digits')}<select value={prefs.significantDigits[m] ?? 3} onChange={e => change({ significantDigits: { ...prefs.significantDigits, [m]: Number(e.target.value) } })}>{[1, 2, 3, 4, 5, 6].map(n => <option key={n}>{n}</option>)}</select></label>
          <button disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${t('up')} ${t(m)}`}>↑</button><button disabled={i === prefs.order.length - 1} onClick={() => move(i, 1)} aria-label={`${t('down')} ${t(m)}`}>↓</button>
        </div>)}</div><p className="mp-note">{t('configuration')}</p><button onClick={() => setPrefs(defaultPreferences())}>{t('reset')}</button>
      </section>}
      {!sample ? <div className="mp-empty"><span className="mp-empty-glyph"><Icon /></span><p>{t('loading')}</p></div> : visible.length ? (Object.entries(GROUPS) as [TextKey, Metric[]][]).map(([group, metrics]) => {
        const items = metrics.filter(m => visible.includes(m));
        if (!items.length) return null;
        return <section className="mp-group" key={group}><div className="mp-group-head"><h2>{t(group)}</h2><span>{items.length}</span></div><div className="mp-cards">{items.map(m => <article className={m === 'diskSpace' ? 'mp-card mp-card-scroll' : 'mp-card'} key={`${group}-${m}`}><div className="mp-card-main"><h3>{metric(m, m === 'cpuTemp' && data?.config.source === 'mactop' ? 'SoC' : undefined)}</h3>{content(m)}</div></article>)}</div></section>;
      }) : <div className="mp-empty"><span className="mp-empty-glyph"><Icon /></span><p>{needle ? t('noResults') : t('disabled')}</p></div>}
      {(sample || data) && <footer className="mp-footer">
        <div className="mp-meta">
          {sample && <><span>{t('host')}: {sample.host.hostname}</span><span>{t('time')}: {new Date(sample.timestamp).toLocaleTimeString()}</span></>}
          {data && <><span>{t('source')}: {data.config.source}</span><span>{t('interval')}: {data.config.intervalMs / 1000} {t('seconds')}</span><span>{t('history')}: {history.length} {t('samples')}</span></>}
        </div>
        {data && <p>{t(data.config.source === 'go' ? 'goNote' : data.config.source === 'mactop' ? 'mactopNote' : 'networkNote')}</p>}
      </footer>}
      </div></div>
    </div>;
  }
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, locale: NS }, Page));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 20, label: () => translate('panel'), locale: NS }, Icon));
}

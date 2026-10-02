import * as React from 'react';
import { METRICS, type Metric, type Payload, type Sample } from './types.js';
import { en, zh, zhTw, ja, type TextKey } from './locales.js';
import { defaultPreferences, parsePreferences, formatBytes, formatUptime, chartPath, type ViewPreferences } from './view.js';
import css from './style.css';
const PANEL = 'monitor-pro';
const NS = '@nexmoe/dsh-monitor-pro';
const STORAGE = 'dsh-monitor-pro:view:v1';
export const inject = ['slots', 'layout', 'locale', 'connection'];
function Icon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function Chart({ history, picks, labels, max, format }: { history: Sample[]; picks: ((s: Sample) => number | null)[]; labels: string[]; max?: number; format: (n: number) => string }) {
  const all = picks.flatMap(pick => history.map(pick)).filter((n): n is number => n !== null && Number.isFinite(n));
  if (!all.length) return null;
  const ceiling = max ?? Math.max(1, ...all) * 1.15;
  const floor = Math.min(0, ...all) * 1.15;
  const zeroY = 36 - (0 - floor) / Math.max(1, ceiling - floor) * 32;
  return <div className="mp-chart">
    <div className="mp-axis"><span>{format(ceiling)}</span><span>{floor < 0 ? format(floor) : '0'}</span></div>
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={labels.join(' / ')}>
      {[4, 20, 36].map(y => <path key={y} d={`M0 ${y}H100`} className="mp-gridline" vectorEffect="non-scaling-stroke" />)}
      {floor < 0 && <path d={`M0 ${zeroY}H100`} className="mp-gridline" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
      {picks.map((pick, i) => <path key={i} d={chartPath(history.map(s => ({ timestamp: s.timestamp, value: pick(s) })), ceiling, floor)} className={`mp-line mp-line-${i}`} vectorEffect="non-scaling-stroke" />)}
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
    const [paused, setPaused] = React.useState(false);
    const [settings, setSettings] = React.useState(false);
    const [refresh, setRefresh] = React.useState(0);
    const [prefs, setPrefs] = React.useState<ViewPreferences>(() => {
      try { return parsePreferences(JSON.parse(localStorage.getItem(STORAGE) ?? 'null')); } catch { return defaultPreferences(); }
    });
    const [now, setNow] = React.useState(Date.now());
    const cursor = React.useRef(0);
    const generation = React.useRef<string | undefined>(undefined);
    React.useEffect(() => { try { localStorage.setItem(STORAGE, JSON.stringify(prefs)); } catch { /* Private browsers may refuse storage. */ } }, [prefs]);
    React.useEffect(() => {
      if (paused) return;
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
    }, [paused, refresh]);
    const sample = data?.current;
    const history = data?.history ?? [];
    const stale = !paused && !!sample && now - sample.timestamp > Math.max(15000, (data?.config.intervalMs ?? 2000) * 3);
    const status = paused ? 'paused' : transportError ? 'error' : stale ? 'stale' : data?.status ?? 'starting';
    const bytes = (n: number | null | undefined) => formatBytes(n, prefs);
    const rate = (n: number | null | undefined, network = false) => `${formatBytes(n, prefs, network && prefs.networkUnit === 'bits')}/s`;
    const number = (n: number | null | undefined, suffix = '') => n === null || n === undefined ? '—' : `${n.toFixed(prefs.decimals)}${suffix}`;
    const metric = (m: Metric, extra?: string) => t(m === 'power' && sample?.power ? sample.power.kind === 'soc' ? 'socPower' : 'batteryPower' : m) + (extra ? ` · ${extra}` : '');
    const row = (label: string, value: string) => <div className="mp-row"><span>{label}</span><strong>{value}</strong></div>;
    const unavailable = <p className="mp-unavailable">{t('unavailable')}</p>;
    const chart = (picks: ((s: Sample) => number | null)[], labels: string[], max?: number, format = (n: number) => number(n, '%')) => <Chart history={history} picks={picks} labels={labels} max={max} format={format} />;
    function content(m: Metric): React.ReactNode {
      if (!sample) return null;
      switch (m) {
        case 'cpu': return sample.cpu === null ? unavailable : <>
          <div className="mp-value">{number(sample.cpu, '%')}</div>
          {chart([s => s.cpu], [t('cpu')], 100)}
          {prefs.cores && sample.cores.length > 0 && <div className="mp-cores">{sample.cores.map((n, i) => <div key={i} title={`${t('core')} ${i + 1}: ${number(n, '%')}`}><span>{i + 1}</span><div className="mp-meter"><i style={{ width: `${n}%` }} /></div><small>{number(n, '%')}</small></div>)}</div>}
        </>;
        case 'memory': return !sample.memory ? unavailable : <>
          <div className="mp-value">{bytes(sample.memory.used)}<small> / {bytes(sample.memory.total)}</small></div>
          {row(t('active'), bytes(sample.memory.active))}{row(t('available'), bytes(sample.memory.available))}{row(t('swap'), `${bytes(sample.memory.swapUsed)} / ${bytes(sample.memory.swapTotal)}`)}
          {chart([s => s.memory ? s.memory.used / s.memory.total * 100 : null, s => s.memory?.active !== null && s.memory?.active !== undefined ? s.memory.active / s.memory.total * 100 : null], [t('used'), t('active')], 100)}
        </>;
        case 'network': return !sample.network ? unavailable : <>
          {row(`↓ ${t('download')}`, rate(sample.network.rx, true))}{row(`↑ ${t('upload')}`, rate(sample.network.tx, true))}
          {chart([s => s.network?.rx ?? null, s => s.network?.tx ?? null], [t('download'), t('upload')], undefined, n => rate(n, true))}
          <p className="mp-note">{sample.network.interfaces.join(', ')}</p>
        </>;
        case 'diskIO': return !sample.diskIO ? unavailable : <>
          {row(t('read'), rate(sample.diskIO.read))}{row(t('write'), rate(sample.diskIO.write))}
          {chart([s => s.diskIO?.read ?? null, s => s.diskIO?.write ?? null], [t('read'), t('write')], undefined, n => rate(n))}
        </>;
        case 'diskSpace': return !sample.disks.length ? unavailable : <>{sample.disks.map(d => <div key={`${d.fs}:${d.mount}`} className="mp-disk">
          {row(d.mount, number(d.use, '%'))}<div className="mp-meter"><i style={{ width: `${d.use}%` }} /></div><p className="mp-note">{bytes(d.used)} / {bytes(d.size)} · {d.fs}</p>
        </div>)}</>;
        case 'battery': return !sample.battery ? unavailable : <>
          <div className="mp-value">{number(sample.battery.percent, '%')}<small>{t(sample.battery.charging ? 'charging' : sample.battery.acConnected ? 'plugged' : 'discharging')}</small></div>
          {row(t('health'), number(sample.battery.health, '%'))}{row(t('remaining'), sample.battery.timeRemaining === null ? '—' : `${Math.round(sample.battery.timeRemaining)} ${t('minutes')}`)}
          {chart([s => s.battery?.percent ?? null], [t('battery')], 100)}
        </>;
        case 'cpuSpeed': return sample.cpuSpeed === null ? unavailable : <><div className="mp-value">{number(sample.cpuSpeed, ' GHz')}</div>{chart([s => s.cpuSpeed], [t('cpuSpeed')], undefined, n => number(n, ' GHz'))}</>;
        case 'cpuTemp': return sample.cpuTemp === null ? unavailable : <><div className="mp-value">{number(sample.cpuTemp, ' °C')}</div>{chart([s => s.cpuTemp], [t('cpuTemp')], undefined, n => number(n, ' °C'))}</>;
        case 'power': return !sample.power ? unavailable : <><div className="mp-value">{number(sample.power.watts, ' W')}</div>{chart([s => s.power?.watts ?? null], [metric('power')], undefined, n => number(n, ' W'))}</>;
        case 'gpu': return !sample.gpus.length ? unavailable : <>{sample.gpus.map((gpu, i) => <div key={`${gpu.model}:${i}`} className="mp-gpu">
          <h3>{gpu.model}</h3><div className="mp-value">{number(gpu.utilization, '%')}<small>{number(gpu.temperature, ' °C')}</small></div>
          {row(t('vram'), gpu.memTotal === null ? '—' : `${bytes(gpu.memUsed)} / ${bytes(gpu.memTotal)}`)}
          {chart([s => s.gpus[i]?.utilization ?? null], [gpu.model], 100)}
        </div>)}</>;
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
    return <div className="mp-page">
      <style>{css}</style>
      <header className="mp-header"><div><h1><Icon />{t('panel')}</h1><p>{t('intro')}</p></div><div className="mp-toolbar">
        <button onClick={() => setPaused(p => !p)}>{t(paused ? 'resume' : 'pause')}</button><button onClick={() => setSettings(p => !p)} aria-expanded={settings}>{t(settings ? 'close' : 'settings')}</button><button onClick={download} disabled={!data}>{t('export')}</button>
      </div></header>
      <div className="mp-meta"><span className={`mp-status mp-status-${status}`} role="status"><i />{t(status)}</span>
        {sample && <><span>{t('host')}: {sample.host.hostname} · {sample.host.platform}/{sample.host.arch}</span><span>{t('uptime')}: {formatUptime(sample.host.uptime)}</span><span>{t('time')}: {new Date(sample.timestamp).toLocaleTimeString()}</span></>}
        {data && <><span>{t('source')}: {data.config.source}</span><span>{t('interval')}: {data.config.intervalMs / 1000} {t('seconds')}</span><span>{t('history')}: {history.length} {t('samples')}</span></>}
      </div>
      {(transportError || data?.error) && <div className="mp-error" role="alert"><span>{transportError ?? data?.error}</span><button onClick={() => { cursor.current = 0; setRefresh(n => n + 1); }}>{t('retry')}</button></div>}
      {settings && <section className="mp-settings" aria-label={t('settings')}>
        <div className="mp-options"><label>{t('unit')}<select value={prefs.unit} onChange={e => change({ unit: e.target.value as ViewPreferences['unit'] })}><option value="binary">{t('binary')}</option><option value="decimal">{t('decimal')}</option></select></label>
          <label>{t('decimals')}<select value={prefs.decimals} onChange={e => change({ decimals: Number(e.target.value) })}>{[0, 1, 2, 3].map(n => <option key={n}>{n}</option>)}</select></label>
          <label>{t('networkUnit')}<select value={prefs.networkUnit} onChange={e => change({ networkUnit: e.target.value as ViewPreferences['networkUnit'] })}><option value="bytes">{t('bytes')}</option><option value="bits">{t('bits')}</option></select></label>
          <label className="mp-checkbox"><input type="checkbox" checked={prefs.cores} onChange={e => change({ cores: e.target.checked })} />{t('cores')}</label>
        </div>
        <h2>{t('visible')} · {t('order')}</h2><div className="mp-order">{prefs.order.map((m, i) => <div key={m}>
          <label><input type="checkbox" checked={!prefs.hidden.includes(m)} onChange={e => change({ hidden: e.target.checked ? prefs.hidden.filter(x => x !== m) : [...prefs.hidden, m] })} />{t(m)}</label>
          <button disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${t('up')} ${t(m)}`}>↑</button><button disabled={i === prefs.order.length - 1} onClick={() => move(i, 1)} aria-label={`${t('down')} ${t(m)}`}>↓</button>
        </div>)}</div><p className="mp-note">{t('configuration')}</p><button onClick={() => setPrefs(defaultPreferences())}>{t('reset')}</button>
      </section>}
      {!sample ? <p className="mp-empty">{t('loading')}</p> : <div className="mp-cards">{prefs.order.filter(m => data?.config.metrics.includes(m) && !prefs.hidden.includes(m)).map(m => <section className="mp-card" key={m}><h2>{metric(m, m === 'cpuTemp' && data?.config.source === 'mactop' ? 'SoC' : undefined)}</h2>{content(m)}</section>)}</div>}
      {data && !data.config.metrics.length && <p className="mp-empty">{t('disabled')}</p>}
      {data && <footer className="mp-note">{t(data.config.source === 'go' ? 'goNote' : data.config.source === 'mactop' ? 'mactopNote' : 'networkNote')}</footer>}
    </div>;
  }
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, locale: NS }, Page));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 20, label: () => translate('panel'), locale: NS }, Icon));
}

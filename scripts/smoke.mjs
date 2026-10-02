import { MonitorService } from '../dist/service.js';
const service = new MonitorService({ intervalMs: 2000 });
try {
  await service.sample();
  await new Promise(resolve => setTimeout(resolve, 1200));
  await service.sample();
  const state = service.snapshot();
  if (!state.current || state.status === 'error') throw new Error(state.error ?? 'No host sample');
  const s = state.current;
  console.log(JSON.stringify({ status: state.status, source: state.config.source, platform: `${s.host.platform}/${s.host.arch}`, samples: state.history.length, cpu: s.cpu, cores: s.cores.length, memoryGiB: s.memory?.total / 1024 ** 3, network: s.network, disks: s.disks.length, battery: s.battery?.percent ?? null, gpuCount: s.gpus.length, errors: s.errors }, null, 2));
} finally { await service.dispose(); }

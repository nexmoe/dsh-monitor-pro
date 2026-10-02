import z from '@deepseek-ai/schemastery';
import { MonitorService } from './service.js';
import { METRICS } from './types.js';
export const name = 'monitor-pro';
export const inject = ['connection'];
export const Config = z.object({
  intervalMs: z.number().min(1000).max(60000).default(2000).description('采样间隔（毫秒） / Sampling interval in milliseconds'),
  historySize: z.number().min(10).max(600).default(60).description('历史采样数 / Maximum history samples'),
  metrics: z.array(z.union([...METRICS])).default([...METRICS]).description('启用的指标 / Enabled metrics'),
  source: z.union(['systeminformation', 'mactop', 'go']).default('systeminformation').description('采集源 / Collector source'),
  backendUrl: z.string().default('http://127.0.0.1:8888').description('已启动的本地原生后端 / Running loopback native backend'),
  networkInterface: z.string().default('').description('网卡；空值汇总活动接口（SI） / Interface; empty sums active SI interfaces'),
  diskMounts: z.array(z.string()).default([]).description('磁盘挂载点；空值自动去重 / Mounts; empty deduplicates automatically'),
});
// Cordis owns the route, worker and timers. Config edits recreate one collector,
// so all browser windows share the same host sampling cycle.
export function apply(ctx: any, config: any): void {
  const monitor = new MonitorService(config);
  ctx.effect(() => { monitor.start(); return () => monitor.dispose(); }, 'monitor-pro: collector');
  // Exact Fetch routes share Harness's mounted /api carrier and authentication.
  // In 0.2.0-rc.2 custom rpc.handle channels try to read webServer in the
  // Connection owner's undeclared scope, even if this caller injects it.
  // Keep the public Connection RPC envelope so the browser can use rpc.call.
  ctx.connection.fetch.register({
    path: '/api/monitor-pro/snapshot', methods: ['POST'], requestBody: 'buffered',
    async fetch(request: Request): Promise<Response> {
      if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return new Response('content type must be application/json', { status: 415 });
      let message: any;
      try { message = await request.json(); } catch { return new Response('body is not JSON', { status: 400 }); }
      const respond = (result: unknown): Response => Response.json({ type: 'server-response', rpcId: typeof message?.rpcId === 'string' ? message.rpcId : 'invalid-request', result });
      const fail = (text: string): Response => respond({ ok: false, error: { code: 'monitor/bad-request', message: text, details: {} } });
      if (!message || message.type !== 'client-request' || typeof message.rpcId !== 'string' || message.method !== 'monitor-pro/snapshot') return fail('Invalid monitor RPC request');
      const payload = message.payload ?? {};
      if (typeof payload !== 'object' || Array.isArray(payload)) return fail('payload must be an object');
      const { since, generation } = payload;
      if (generation !== undefined && typeof generation !== 'string') return fail('generation must be a string');
      if (since !== undefined && (typeof since !== 'number' || !Number.isFinite(since) || since < 0)) return fail('since must be a nonnegative timestamp');
      return respond({ ok: true, value: monitor.snapshot(since, generation) });
    },
  });
  // Tools are an optional capability: the dashboard works in deployments
  // without agents, while agents and UI read the very same cached state.
  // Register the public raw JSON Schema contract directly. Importing the Host's
  // defineTool helper from a pnpm-isolated plugin would require another copy of
  // its runtime dependency tree even though the registry is already injected.
  ctx.inject(['tools'], (toolCtx: any) => {
    toolCtx.tools.register({
      name: 'monitor_snapshot',
      description: 'Read host CPU, memory, network, disk, battery and GPU resource readings. Includes source, freshness and collection errors. Measurements describe the Harness host.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: {}, render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }] },
      isConcurrencySafe: () => true,
      execute: async () => { const snapshot = monitor.snapshot(); return { ...snapshot, history: [] }; },
    });
  });
}

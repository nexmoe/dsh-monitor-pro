import { parentPort } from 'node:worker_threads';
import { Collector } from './collector.js';
import { normalizeConfig } from './types.js';
const collector = new Collector();
parentPort?.on('message', async config => {
  try { parentPort?.postMessage({ sample: await collector.collect(normalizeConfig(config)) }); }
  catch (error) { parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
});

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Pure upstream modules are vendored in src/upstream so a fresh clone builds
// independently of the original VS Code extension or its runtime dependencies.
const host = { absWorkingDir: root, bundle: true, platform: 'node', format: 'esm', target: 'node22', packages: 'external', sourcemap: true };
await Promise.all([
  build({ ...host, entryPoints: ['src/index.ts'], outfile: 'dist/index.js' }),
  build({ ...host, entryPoints: ['src/collector.worker.ts'], outfile: 'dist/collector.worker.js' }),
  build({ ...host, entryPoints: ['src/collector.ts'], outfile: 'dist/collector.js' }),
  build({ ...host, entryPoints: ['src/service.ts'], outfile: 'dist/service.js' }),
  build({ ...host, entryPoints: ['src/view.ts'], outfile: 'dist/view.js' }),
  build({ ...host, entryPoints: ['src/types.ts'], outfile: 'dist/types.js' }),
  build({ ...host, entryPoints: ['src/backend.ts'], outfile: 'dist/backend.js' }),
  build({ ...host, entryPoints: ['src/backend.guard.ts'], outfile: 'dist/backend.guard.js' }),
  build({ ...host, entryPoints: ['src/locales.ts'], outfile: 'dist/locales.js' }),
  build({
    absWorkingDir: root, entryPoints: ['src/client.tsx'], outfile: 'dist/client.js', bundle: true,
    platform: 'browser', format: 'cjs', target: 'es2022', external: ['react'], loader: { '.css': 'text' },
    banner: { js: `window.__ModuleLoader__.load({id: '@nexmoe/dsh-monitor-pro', factory: (require) => { const module = {exports: {}}; const exports = module.exports;` },
    footer: { js: 'return module.exports; }});' },
  }),
]);
console.log('Built Host, worker and Harness Client artifacts.');

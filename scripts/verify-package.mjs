import { stat } from 'node:fs/promises';
for (const path of ['dist/index.js', 'dist/client.js', 'dist/backend.guard.js', 'dist/collector.worker.js', 'native/bin/win32-x64/monitor.exe', 'native/bin/win32-arm64/monitor.exe', 'native/THIRD_PARTY_NOTICES.txt', 'native/LICENSES/go-LICENSE.txt']) {
  const file = await stat(new URL(`../${path}`, import.meta.url)).catch(() => null);
  if (!file?.isFile() || !file.size) throw new Error(`Missing package artifact ${path}; run pnpm build and pnpm build:native first.`);
}
console.log('Required Host, Client and Windows native package artifacts are present.');

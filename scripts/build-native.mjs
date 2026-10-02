import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const native = join(root, 'native');
const platforms = { win32: 'windows', darwin: 'darwin', linux: 'linux', freebsd: 'freebsd' };
const architectures = { x64: 'amd64', arm64: 'arm64' };
const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log('Usage: node scripts/build-native.mjs [--host]\nBuild Windows x64 and ARM64 backends; --host also builds the local backend.\nSet GO to a Go executable path (defaults to go on PATH).');
} else {
  if (args.some(arg => arg !== '--host')) throw new Error(`Unknown native build argument: ${args.find(arg => arg !== '--host')}`);

  // Resolve relative executable overrides before switching the child's working
  // directory to native, so GO=.tools/go/bin/go works from the project root.
  const override = process.env.GO?.trim();
  const go = override && !isAbsolute(override) && /[/\\]/.test(override) ? resolve(override) : override || 'go';
  const targets = [
    { platform: 'win32', arch: 'x64' },
    { platform: 'win32', arch: 'arm64' },
  ];
  if (args.includes('--host')) {
    if (!platforms[process.platform] || !architectures[process.arch]) throw new Error(`Unsupported native host: ${process.platform}/${process.arch}`);
    if (!targets.some(target => target.platform === process.platform && target.arch === process.arch)) {
      targets.push({ platform: process.platform, arch: process.arch });
    }
  }

  function build(target, output) {
    return new Promise((resolveBuild, reject) => {
      const child = spawn(go, ['build', '-mod=readonly', '-trimpath', '-ldflags=-s -w', '-o', output, '.'], {
        cwd: native,
        stdio: 'inherit',
        windowsHide: true,
        env: {
          ...process.env,
          CGO_ENABLED: '0',
          GOOS: platforms[target.platform],
          GOARCH: architectures[target.arch],
          GOTOOLCHAIN: 'local',
        },
      });
      child.once('error', error => reject(new Error(`Cannot launch Go executable ${go}: ${error.message}`, { cause: error })));
      child.once('close', (code, signal) => {
        if (code === 0) resolveBuild();
        else reject(new Error(`Native build failed for ${target.platform}-${target.arch} (${signal || `exit ${code}`})`));
      });
    });
  }

  // Await each compiler process to keep cross-build memory use bounded and make
  // a failure stop packaging before any incomplete artifact can be published.
  for (const target of targets) {
    const output = join(native, 'bin', `${target.platform}-${target.arch}`, `monitor${target.platform === 'win32' ? '.exe' : ''}`);
    await mkdir(dirname(output), { recursive: true });
    console.log(`Building ${target.platform}-${target.arch} with ${go}...`);
    await build(target, output);
    const binary = await stat(output).catch(error => {
      throw new Error(`Expected native binary is absent: ${output}`, { cause: error });
    });
    if (!binary.isFile() || binary.size === 0) throw new Error(`Expected a nonempty native binary: ${output}`);
    await access(output, constants.X_OK);
    console.log(`Built native/bin/${target.platform}-${target.arch}/${target.platform === 'win32' ? 'monitor.exe' : 'monitor'} (${binary.size} bytes).`);
  }
}

#!/usr/bin/env node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const repoRoot = process.cwd();
const homebridgeVersion = process.env.HOMEBRIDGE_VERSION ?? '2.0.0';
const keepTemp = process.env.LANTERNIC_KEEP_SMOKE_DIR === '1';

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
  });

  if (result.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${args.join(' ')}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }

  return result.stdout;
};

const assertFile = path => {
  if (!existsSync(path)) {
    throw new Error(`Expected file to exist: ${path}`);
  }
};

const assertMissing = path => {
  if (existsSync(path)) {
    throw new Error(`Expected file to be excluded: ${path}`);
  }
};

const assertExecutable = path => {
  assertFile(path);

  if ((statSync(path).mode & 0o111) === 0) {
    throw new Error(`Expected file to be executable: ${path}`);
  }
};

const writeHomebridgeConfig = async (hbDir, bridgePort) => {
  await writeFile(join(hbDir, 'config.json'), `${JSON.stringify({
    bridge: {
      name: 'LanternIC Smoke',
      username: '0E:1A:66:55:44:33',
      port: bridgePort,
      pin: '031-45-154',
    },
    platforms: [
      {
        platform: 'LanternIC',
        name: 'LanternIC',
        devices: [],
        discovery: {
          enabled: false,
        },
      },
    ],
  }, null, 2)}\n`);
};

const runHomebridge = async (installDir, hbDir, bridgePort) => {
  const homebridgeBin = join(installDir, 'node_modules', 'homebridge', 'bin', 'homebridge');
  const pluginPath = join(installDir, 'node_modules');
  const child = spawn(process.execPath, [
    homebridgeBin,
    '-U',
    hbDir,
    '-P',
    pluginPath,
    '-D',
  ], {
    cwd: installDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  let sawLoaded = false;
  let sawRegistered = false;
  let sawRunning = false;

  const append = chunk => {
    output += chunk.toString('utf8');
    sawLoaded ||= output.includes('Loaded plugin: homebridge-lanternic@');
    sawRegistered ||= output.includes("Registering platform 'homebridge-lanternic.LanternIC'");
    sawRunning ||= output.includes('Homebridge v') && output.includes(`is running on port ${bridgePort}`);

    if (sawLoaded && sawRegistered && sawRunning) {
      child.kill('SIGINT');
    }
  };

  child.stdout.on('data', append);
  child.stderr.on('data', append);

  await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGINT');
      reject(new Error(`Timed out waiting for Homebridge smoke test:\n${output}`));
    }, 15_000);

    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('exit', () => {
      clearTimeout(timer);

      if (!sawLoaded || !sawRegistered || !sawRunning) {
        reject(new Error(`Homebridge smoke test did not reach expected state:\n${output}`));
        return;
      }

      resolvePromise();
    });
  });
};

const tempRoot = await mkdtemp(join(tmpdir(), 'lanternic-package-smoke-'));

try {
  const packDir = join(tempRoot, 'pack');
  const installDir = join(tempRoot, 'install');
  const hbDir = join(tempRoot, 'hb');
  const bridgePort = 51_900 + Math.floor(Math.random() * 90);
  await mkdir(packDir);
  await mkdir(installDir);
  await mkdir(hbDir);

  const packOutput = run('npm', ['pack', '--pack-destination', packDir]);
  const packOutputLines = packOutput.trim().split(/\r?\n/u);
  const tarball = [...packOutputLines].reverse().find(line => line.endsWith('.tgz'));

  if (!tarball) {
    throw new Error(`Could not find packed tarball in npm output:\n${packOutput}`);
  }

  const tarballPath = join(packDir, tarball);
  run('npm', ['init', '-y'], { cwd: installDir });
  run('npm', ['install', tarballPath, `homebridge@${homebridgeVersion}`, '--omit=dev'], { cwd: installDir });

  const pluginRoot = join(installDir, 'node_modules', 'homebridge-lanternic');
  assertFile(join(pluginRoot, 'dist', 'index.js'));
  assertFile(join(pluginRoot, 'config.schema.json'));
  assertExecutable(join(pluginRoot, 'tools', 'scan.mjs'));
  assertFile(join(installDir, 'node_modules', '.bin', 'lanternic-scan'));
  assertMissing(join(pluginRoot, 'tools', 'fake-strip.mjs'));

  run(process.execPath, ['-e', "import('homebridge-lanternic').then(m => { if (typeof m.default !== 'function') throw new Error('default export is not a function'); })"], {
    cwd: installDir,
  });

  await writeHomebridgeConfig(hbDir, bridgePort);
  await runHomebridge(installDir, hbDir, bridgePort);

  console.log(`Package smoke test passed with Homebridge ${homebridgeVersion}`);
} finally {
  if (keepTemp) {
    console.log(`Keeping smoke test directory: ${tempRoot}`);
  } else {
    await rm(resolve(tempRoot), { force: true, recursive: true });
  }
}

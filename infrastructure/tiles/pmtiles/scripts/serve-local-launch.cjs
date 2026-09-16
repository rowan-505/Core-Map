'use strict';

const { spawn } = require('child_process');
const path = require('path');

function linuxFromUnc(raw) {
  const normalized = String(raw).replace(/\\/g, '/');
  const match = normalized.match(/wsl\.localhost\/[^/]+\/(.*)$/i);
  return match ? `/${match[1]}` : normalized;
}

function distroFromUnc(raw) {
  const normalized = String(raw).replace(/\\/g, '/');
  const match = normalized.match(/wsl\.localhost\/([^/]+)\//i);
  return match ? match[1] : null;
}

const initCwd = process.env.INIT_CWD || process.cwd();
const linuxRoot = linuxFromUnc(initCwd);
const winScript = path.join(initCwd, 'infrastructure', 'tiles', 'pmtiles', 'scripts', 'serve-local.py');
const linuxScript = path.posix.join(linuxRoot, 'infrastructure/tiles/pmtiles/scripts/serve-local.py');
const distro = process.env.WSL_DISTRO_NAME || distroFromUnc(initCwd);

function run(command, args, cwd) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    cwd,
    env: process.env,
    windowsHide: true,
  });
  child.on('error', (err) => {
    console.error(err.message);
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code == null ? 1 : code));
}

if (process.platform !== 'win32') {
  run('python3', [linuxScript], linuxRoot);
} else if (distro) {
  run(
    'wsl.exe',
    ['-d', distro, '-e', 'python3', linuxScript],
    process.env.WINDIR || 'C:\\Windows',
  );
} else {
  run('python', [winScript], initCwd);
}

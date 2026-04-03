import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const mode = process.argv[2] === 'dist' ? 'dist' : 'pack';
const skipBuild = process.argv.includes('--skip-build');
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electronBuilderBin = path.join(
  ROOT_DIR,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder',
);
const cachedWinElectronDist = path.join(ROOT_DIR, '.electron-dist', 'win32-x64');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function resolveWinElectronDistArg() {
  if (process.platform === 'win32') {
    return null;
  }

  const cachedBinary = path.join(cachedWinElectronDist, 'electron.exe');
  if (fs.existsSync(cachedBinary)) {
    return '-c.electronDist=.electron-dist/win32-x64';
  }

  return '-c.electronDist=';
}

async function runWinBuilder(target) {
  const distArg = resolveWinElectronDistArg();
  const args = ['--win', target, '--x64'];

  if (distArg) {
    args.push(distArg);
  }

  await run(electronBuilderBin, args);
}

async function main() {
  if (!skipBuild) {
    await run(npmBin, ['run', 'icons:build']);
    await run(npmBin, ['run', 'build']);
  }

  await runWinBuilder('dir');

  if (mode !== 'dist') {
    return;
  }

  await runWinBuilder('zip');
  await runWinBuilder('nsis');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const mode = process.argv[2] === 'dist' ? 'dist' : 'pack';
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

  if (fs.existsSync(path.join(cachedWinElectronDist, 'electron.exe'))) {
    return '-c.electronDist=.electron-dist/win32-x64';
  }

  return '-c.electronDist=';
}

async function main() {
  await run(npmBin, ['run', 'icons:build']);
  await run(npmBin, ['run', 'build']);

  const winElectronDistArg = resolveWinElectronDistArg();
  const winDirArgs = ['--win', 'dir', '--x64'];
  const winZipArgs = ['--win', 'zip', '--x64'];
  const winNsisArgs = ['--win', 'nsis', '--x64'];

  if (winElectronDistArg) {
    winDirArgs.push(winElectronDistArg);
    winZipArgs.push(winElectronDistArg);
    winNsisArgs.push(winElectronDistArg);
  }

  await run(electronBuilderBin, ['--mac', 'dir', '--arm64']);
  await run(electronBuilderBin, winDirArgs);

  if (mode !== 'dist') {
    return;
  }

  await run(electronBuilderBin, ['--mac', 'zip', '--arm64']);
  await run(electronBuilderBin, winZipArgs);

  if (process.platform === 'win32') {
    await run(electronBuilderBin, winNsisArgs);
    return;
  }

  console.log('[desktop:dist:all] skipped Windows NSIS installer on non-Windows host; use Windows to build .exe');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

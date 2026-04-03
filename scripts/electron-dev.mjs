import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function waitForUrl(url, timeoutMs = 15000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }

      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
        if (response.ok || response.status < 500) {
          clearInterval(timer);
          resolve();
        }
      } catch {
        // Keep waiting until Vite is listening.
      }
    }, 300);
  });
}

const viteProcess = spawn(npmCommand, ['run', 'dev'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    BROWSER: 'none',
  },
});

let electronProcess;

function shutdown(code = 0) {
  if (electronProcess && !electronProcess.killed) {
    electronProcess.kill('SIGTERM');
  }
  if (viteProcess && !viteProcess.killed) {
    viteProcess.kill('SIGTERM');
  }
  process.exit(code);
}

viteProcess.on('exit', (code) => {
  if (!electronProcess) {
    process.exit(code ?? 0);
    return;
  }

  shutdown(code ?? 0);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

try {
  await waitForUrl('http://localhost:8080');
} catch (error) {
  console.error(error.message);
  shutdown(1);
}

electronProcess = spawn(npmCommand, ['run', 'electron'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DESKTOP_RUNTIME: '1',
    ELECTRON_RENDERER_URL: 'http://localhost:8080',
  },
});

electronProcess.on('exit', (code) => {
  shutdown(code ?? 0);
});

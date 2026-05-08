import { spawn } from 'node:child_process';
import net from 'node:net';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const HOST = '127.0.0.1';
const DEFAULT_PORT = 8080;

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

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, HOST);
  });
}

async function findAvailablePort(startPort = DEFAULT_PORT, attempts = 20) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const candidate = startPort + offset;
    if (await canListen(candidate)) {
      return candidate;
    }
  }

  throw new Error(`No available port found starting from ${startPort}`);
}

const rendererPort = await findAvailablePort();
const rendererUrl = `http://localhost:${rendererPort}`;

const viteProcess = spawn(npmCommand, ['run', 'dev'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    BROWSER: 'none',
    PORT: String(rendererPort),
    VITE_DEV_SERVER_PORT: String(rendererPort),
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
  await waitForUrl(rendererUrl);
} catch (error) {
  console.error(error.message);
  shutdown(1);
}

electronProcess = spawn(npmCommand, ['run', 'electron'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    DESKTOP_RUNTIME: '1',
    ELECTRON_RENDERER_URL: rendererUrl,
  },
});

electronProcess.on('exit', (code) => {
  shutdown(code ?? 0);
});

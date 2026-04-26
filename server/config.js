import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

dotenv.config();

const rawSocketPath = process.env.DB_SOCKET?.trim();
const socketPath = rawSocketPath && fs.existsSync(rawSocketPath) ? rawSocketPath : undefined;

function applyProxyConfig() {
  const hasExplicitProxy = Boolean(
    process.env.HTTP_PROXY || process.env.http_proxy ||
    process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.ALL_PROXY || process.env.all_proxy
  );

  if (hasExplicitProxy) {
    process.env.NODE_USE_ENV_PROXY ||= '1';
    process.env.NO_PROXY ||= '127.0.0.1,localhost,::1';
    return;
  }

  if (process.platform !== 'darwin') {
    return;
  }

  try {
    const output = execFileSync('scutil', ['--proxy'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const httpsEnabled = /HTTPSEnable\s*:\s*1/.test(output);
    const httpsHost = output.match(/HTTPSProxy\s*:\s*(.+)/)?.[1]?.trim();
    const httpsPort = output.match(/HTTPSPort\s*:\s*(\d+)/)?.[1]?.trim();
    const httpEnabled = /HTTPEnable\s*:\s*1/.test(output);
    const httpHost = output.match(/HTTPProxy\s*:\s*(.+)/)?.[1]?.trim();
    const httpPort = output.match(/HTTPPort\s*:\s*(\d+)/)?.[1]?.trim();
    if (httpsEnabled && httpsHost && httpsPort) {
      process.env.HTTPS_PROXY = `http://${httpsHost}:${httpsPort}`;
    }
    if (httpEnabled && httpHost && httpPort) {
      process.env.HTTP_PROXY = `http://${httpHost}:${httpPort}`;
    }

    if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY) {
      process.env.NODE_USE_ENV_PROXY = '1';
      process.env.NO_PROXY ||= '127.0.0.1,localhost,::1';
    }
  } catch {
    // Ignore proxy autodetection failures and fall back to direct connections.
  }
}

applyProxyConfig();

const rawSqlitePath = process.env.DB_SQLITE_PATH?.trim();
const defaultSqlitePath = path.resolve(process.cwd(), '.codexpoolmatrix', 'codexpoolmatrix.sqlite');
const dbDriver = (process.env.DB_DRIVER || 'sqlite').trim().toLowerCase();

export const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3001),
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:8080',
  proxy: {
    http: process.env.HTTP_PROXY || process.env.http_proxy || '',
    https: process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '',
    all: process.env.ALL_PROXY || process.env.all_proxy || '',
    noProxy: process.env.NO_PROXY || process.env.no_proxy || '127.0.0.1,localhost,::1',
  },
  db: {
    driver: dbDriver === 'mysql' ? 'mysql' : 'sqlite',
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'codex_pool_manager',
    socketPath,
    sqlitePath: rawSqlitePath ? path.resolve(rawSqlitePath) : defaultSqlitePath,
  },
};

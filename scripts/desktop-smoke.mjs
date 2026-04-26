import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const SERVER_ENTRY_URL = pathToFileURL(path.join(ROOT_DIR, 'server', 'index.js')).href;

process.env.DESKTOP_RUNTIME = '1';
process.env.HOST ||= '127.0.0.1';
process.env.DB_SQLITE_PATH ||= path.join(ROOT_DIR, '.codexpoolmatrix', 'codexpoolmatrix.sqlite');

const serverModule = await import(SERVER_ENTRY_URL);

async function expectOk(name, payload) {
  const response = await serverModule.invokeApiRequest(payload);

  if (!response.ok) {
    throw new Error(`${name} failed with status ${response.status}`);
  }

  return response.data;
}

try {
  const health = await expectOk('health', { path: '/api/health' });
  const settings = await expectOk('settings', { path: '/api/settings' });
  const accounts = await expectOk('accounts', { path: '/api/accounts' });

  console.log(JSON.stringify({
    ok: true,
    health,
    strategy: settings?.strategy || null,
    accounts: Array.isArray(accounts) ? accounts.length : 0,
  }, null, 2));
} finally {
  await serverModule.stopServer();
}

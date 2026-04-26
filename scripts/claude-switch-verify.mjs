import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const SERVER_ENTRY_URL = pathToFileURL(path.join(ROOT_DIR, 'server', 'index.js')).href;

const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cpm-claude-verify-'));
process.env.HOME = tempHome;
process.env.DESKTOP_RUNTIME = '1';
process.env.HOST = '127.0.0.1';
process.env.DB_SQLITE_PATH = path.join(tempHome, 'codexpoolmatrix.sqlite');
process.env.DESKTOP_ACCOUNTS_DIR = path.join(tempHome, 'accounts');

const serverModule = await import(SERVER_ENTRY_URL);

async function request(name, payload) {
  const response = await serverModule.invokeApiRequest(payload);
  if (!response.ok) {
    throw new Error(`${name} failed with status ${response.status}: ${JSON.stringify(response.data)}`);
  }
  return response.data;
}

try {
  const settings = await request('getSettings', { path: '/api/settings' });

  const account = await request('createAccount', {
    path: '/api/accounts',
    method: 'POST',
    body: {
      account_id: 'claude-relay-test',
      email: '',
      auth_type: 'plus',
      auth_file_path: '',
      provider_mode: 'api',
      api_base_url: 'http://39.99.254.2:4000',
      api_key: '',
      api_model: '',
      api_cli_config: '',
      platform: 'claude',
    },
  });

  await request('switchMode', {
    path: '/api/settings',
    method: 'PUT',
    body: { ...settings, mode: 'claude' },
  });

  await request('setActive', {
    path: `/api/accounts/${account.id}`,
    method: 'PATCH',
    body: { action: 'setActive' },
  });

  const managedStatus = await request('managedStatus', { path: '/api/codex/managed-status' });
  const currentAuth = await request('currentAuth', { path: '/api/codex/current-auth' });
  const claudeSettings = JSON.parse(await fs.readFile(path.join(tempHome, '.claude', 'settings.json'), 'utf8'));
  const claudeMatrixState = JSON.parse(await fs.readFile(path.join(tempHome, '.claude', 'matrix-cli-state.json'), 'utf8'));

  assert.equal(managedStatus.runtime_mode, 'claude');
  assert.equal(managedStatus.current_account_id, 'claude-relay-test');
  assert.equal(managedStatus.matrix_state_mode, 'api');
  assert.equal(managedStatus.matrix_state_account_id, 'claude-relay-test');
  assert.equal(managedStatus.cli_managed, true);
  assert.equal(currentAuth.found, true);
  assert.equal(currentAuth.provider_mode, 'api');
  assert.equal(currentAuth.account_id, 'claude-relay-test');
  assert.equal(claudeSettings.env.ANTHROPIC_BASE_URL, 'http://39.99.254.2:4000');
  assert.equal(claudeMatrixState.mode, 'api');
  assert.equal(claudeMatrixState.account_id, 'claude-relay-test');

  console.log(JSON.stringify({
    ok: true,
    tempHome,
    managedStatus,
    currentAuth,
    claudeSettings,
    claudeMatrixState,
  }, null, 2));
} finally {
  await serverModule.stopServer();
}

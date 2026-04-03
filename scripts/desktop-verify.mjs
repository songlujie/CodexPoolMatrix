import crypto from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const SERVER_ENTRY_URL = pathToFileURL(path.join(ROOT_DIR, 'server', 'index.js')).href;

process.env.DESKTOP_RUNTIME = '1';
process.env.HOST ||= '127.0.0.1';
process.env.DB_SQLITE_PATH ||= path.join(ROOT_DIR, '.codexpoolmatrix', 'codexpoolmatrix.sqlite');

const serverModule = await import(SERVER_ENTRY_URL);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(name, payload) {
  const response = await serverModule.invokeApiRequest(payload);

  if (!response.ok) {
    throw new Error(`${name} failed with status ${response.status}: ${JSON.stringify(response.data)}`);
  }

  return response.data;
}

const cleanup = [];

async function runCleanup() {
  for (const step of cleanup.reverse()) {
    await step().catch(() => null);
  }
  cleanup.length = 0;
}

try {
  const summary = {};

  const health = await request('health', { path: '/api/health' });
  assert(health?.ok === true, 'health payload is invalid');
  summary.health = health.ok;

  const initialAccounts = await request('listAccounts', { path: '/api/accounts' });
  const initialTasks = await request('listTasks', { path: '/api/tasks' });
  const initialLogs = await request('listLogs', { path: '/api/logs?limit=5' });
  const initialPlatforms = await request('listPlatforms', { path: '/api/platforms' });
  const initialSettings = await request('getSettings', { path: '/api/settings' });

  assert(Array.isArray(initialAccounts) && initialAccounts.length > 0, 'accounts should not be empty');
  assert(Array.isArray(initialTasks), 'tasks payload should be an array');
  assert(Array.isArray(initialLogs), 'logs payload should be an array');
  assert(Array.isArray(initialPlatforms) && initialPlatforms.length > 0, 'platforms should not be empty');
  assert(initialSettings?.strategy, 'settings payload is invalid');

  summary.initial = {
    accounts: initialAccounts.length,
    tasks: initialTasks.length,
    logs: initialLogs.length,
    platforms: initialPlatforms.length,
    strategy: initialSettings.strategy,
  };

  const scanResult = await request('scanDir', { path: '/api/accounts/scan-dir' });
  assert(Array.isArray(scanResult?.files), 'scan-dir files payload is invalid');
  summary.scanDirCount = scanResult.files.length;

  const currentAuth = await request('getCurrentAuth', { path: '/api/codex/current-auth' });
  const managedStatus = await request('getManagedStatus', { path: '/api/codex/managed-status' });
  const codexUsage = await request('getCodexUsage', { path: '/api/codex-usage' });

  summary.codex = {
    currentAuthFound: Boolean(currentAuth?.found),
    managedStatusOk: Boolean(managedStatus?.ok),
    usageFound: Boolean(codexUsage?.found),
  };

  const tempPlatform = `verify-${Date.now()}`;
  const platformsAfterAdd = await request('addPlatform', {
    path: '/api/platforms',
    method: 'POST',
    body: { name: tempPlatform },
  });
  assert(platformsAfterAdd.includes(tempPlatform), 'temporary platform was not added');
  cleanup.push(async () => {
    await serverModule.invokeApiRequest({
      path: `/api/platforms/${encodeURIComponent(tempPlatform)}`,
      method: 'DELETE',
    }).catch(() => null);
  });

  const tempAccountId = `verify-${Date.now()}`;
  const tempAccount = await request('createApiAccount', {
    path: '/api/accounts',
    method: 'POST',
    body: {
      account_id: tempAccountId,
      email: `${tempAccountId}@local.test`,
      auth_type: 'plus',
      auth_file_path: '',
      platform: tempPlatform,
      provider_mode: 'api',
      api_base_url: 'https://example.invalid/v1',
      api_key: 'sk-test',
      api_model: 'gpt-4.1-mini',
      api_cli_config: 'model = "gpt-4.1-mini"\nmax_output_tokens = 2048',
    },
  });
  assert(tempAccount?.provider_mode === 'api', 'temporary account should be api mode');
  cleanup.push(async () => {
    await serverModule.invokeApiRequest({
      path: `/api/accounts/${tempAccount.id}`,
      method: 'DELETE',
    }).catch(() => null);
  });

  const tempAccountAuthInfo = await request('getAccountAuthInfo', {
    path: `/api/accounts/${tempAccount.id}/auth-info`,
  });
  assert(tempAccountAuthInfo?.provider_mode === 'api', 'api account auth-info payload is invalid');

  const cliPreview = await request('previewApiCliConfig', {
    path: `/api/accounts/${tempAccount.id}/api-cli-config/preview`,
    method: 'POST',
    body: {
      api_cli_config: 'model = "gpt-4.1-mini"\nmodel = "ignored"\nmax_output_tokens = 4096',
    },
  });
  assert(cliPreview?.ok === true, 'CLI preview did not succeed');
  assert(String(cliPreview?.sanitized || '').includes('max_output_tokens = 4096'), 'CLI preview sanitization failed');

  const cliUpdate = await request('updateApiCliConfig', {
    path: `/api/accounts/${tempAccount.id}/api-cli-config`,
    method: 'PUT',
    body: {
      api_cli_config: cliPreview.sanitized,
    },
  });
  assert(cliUpdate?.api_cli_config === cliPreview.sanitized, 'CLI config update did not persist');

  const createdTask = await request('createTask', {
    path: '/api/tasks',
    method: 'POST',
    body: {
      description: `verify task ${crypto.randomUUID()}`,
      priority: 'medium',
      account: tempAccount.id,
    },
  });
  assert(createdTask?.assigned_account_id === tempAccount.id, 'task did not bind to temporary account');
  cleanup.push(async () => {
    await serverModule.invokeApiRequest({
      path: '/api/tasks/batch-cancel',
      method: 'POST',
      body: { ids: [createdTask.id] },
    }).catch(() => null);
  });

  const cancelResult = await request('batchCancelTasks', {
    path: '/api/tasks/batch-cancel',
    method: 'POST',
    body: { ids: [createdTask.id] },
  });
  assert(cancelResult?.deleted === 1, 'task cancel did not report one deletion');
  cleanup.pop();

  const updatedSettings = await request('updateSettings', {
    path: '/api/settings',
    method: 'PUT',
    body: {
      ...initialSettings,
      strategy: initialSettings.strategy === 'round_robin' ? 'least_used' : 'round_robin',
    },
  });
  assert(updatedSettings?.strategy !== initialSettings.strategy, 'settings update did not change strategy');
  cleanup.push(async () => {
    await serverModule.invokeApiRequest({
      path: '/api/settings',
      method: 'PUT',
      body: initialSettings,
    }).catch(() => null);
  });

  await request('restoreSettings', {
    path: '/api/settings',
    method: 'PUT',
    body: initialSettings,
  });
  cleanup.pop();

  await runCleanup();

  const finalAccounts = await request('finalAccounts', { path: '/api/accounts' });
  const finalTasks = await request('finalTasks', { path: '/api/tasks' });
  const finalPlatforms = await request('finalPlatforms', { path: '/api/platforms' });
  const finalSettings = await request('finalSettings', { path: '/api/settings' });

  summary.final = {
    accounts: finalAccounts.length,
    tasks: finalTasks.length,
    platforms: finalPlatforms.length,
    strategy: finalSettings.strategy,
  };

  assert(finalAccounts.length === initialAccounts.length, 'accounts were not restored');
  assert(finalTasks.length === initialTasks.length, 'tasks were not restored');
  assert(finalPlatforms.length === initialPlatforms.length, 'platforms were not restored');
  assert(finalSettings.strategy === initialSettings.strategy, 'settings were not restored');

  console.log(JSON.stringify({ ok: true, summary }, null, 2));
} finally {
  await runCleanup();
  await serverModule.stopServer();
}

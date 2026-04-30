import { pool } from '../db.js';
import { createLog } from './log-service.js';

function normalizeStoredMode(mode = 'codex') {
  return mode === 'trae' || mode === 'claude' ? 'claude' : 'codex';
}

function toStoredMode(mode = 'codex') {
  return mode === 'claude' ? 'trae' : 'codex';
}

export async function getSettings() {
  const [rows] = await pool.query('SELECT * FROM settings WHERE id = 1');
  const { id, updated_at, trae_path, ...settings } = rows[0];
  return {
    ...settings,
    claude_path: trae_path || '',
    mode: normalizeStoredMode(settings.mode),
  };
}

export async function updateSettings(body) {
  const currentSettings = await getSettings();
  const normalizedMode = normalizeStoredMode(body.mode);
  const nextSettings = {
    ...currentSettings,
    ...body,
    mode: normalizedMode,
    current_codex_account_id: body.current_codex_account_id ?? currentSettings.current_codex_account_id ?? null,
    current_claude_account_id: body.current_claude_account_id ?? currentSettings.current_claude_account_id ?? null,
  };

  await pool.execute(
    `UPDATE settings SET
      strategy = ?, auto_rotation = ?, rest_after_tasks = ?, cooldown_minutes = ?,
      rate_limit_buffer = ?, max_concurrent_tasks = ?, global_rate_limit = ?,
      auto_retry = ?, max_retries = ?, task_timeout_minutes = ?, auto_dispatch = ?,
      openclaw_endpoint = ?, openclaw_api_key = ?, codex_path = ?, trae_path = ?,
      mode = ?, current_codex_account_id = ?, current_claude_account_id = ?,
      auto_launch = ?, auto_token_refresh = ?, token_refresh_interval_hours = ?,
      updated_at = NOW()
    WHERE id = 1`,
    [
      nextSettings.strategy,
      nextSettings.auto_rotation,
      nextSettings.rest_after_tasks,
      nextSettings.cooldown_minutes,
      nextSettings.rate_limit_buffer,
      nextSettings.max_concurrent_tasks,
      nextSettings.global_rate_limit,
      nextSettings.auto_retry,
      nextSettings.max_retries,
      nextSettings.task_timeout_minutes,
      nextSettings.auto_dispatch,
      nextSettings.openclaw_endpoint,
      nextSettings.openclaw_api_key,
      nextSettings.codex_path,
      nextSettings.claude_path ?? '',
      toStoredMode(normalizedMode),
      nextSettings.current_codex_account_id,
      nextSettings.current_claude_account_id,
      nextSettings.auto_launch,
      nextSettings.auto_token_refresh ?? true,
      nextSettings.token_refresh_interval_hours ?? 72,
    ],
  );
  await createLog({ level: 'info', message: 'Settings updated' });

  return {
    ...nextSettings,
    mode: normalizedMode,
  };
}

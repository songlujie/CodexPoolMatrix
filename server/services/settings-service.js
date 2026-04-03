import { pool } from '../db.js';
import { createLog } from './log-service.js';

export async function getSettings() {
  const [rows] = await pool.query('SELECT * FROM settings WHERE id = 1');
  const { id, updated_at, trae_path, ...settings } = rows[0];
  return {
    ...settings,
    claude_path: trae_path || '',
    mode: 'codex',
  };
}

export async function updateSettings(body) {
  await pool.execute(
    `UPDATE settings SET
      strategy = ?, auto_rotation = ?, rest_after_tasks = ?, cooldown_minutes = ?,
      rate_limit_buffer = ?, max_concurrent_tasks = ?, global_rate_limit = ?,
      auto_retry = ?, max_retries = ?, task_timeout_minutes = ?, auto_dispatch = ?,
      openclaw_endpoint = ?, openclaw_api_key = ?, codex_path = ?, trae_path = ?,
      mode = ?, auto_launch = ?, auto_token_refresh = ?, token_refresh_interval_hours = ?,
      updated_at = NOW()
    WHERE id = 1`,
    [
      body.strategy,
      body.auto_rotation,
      body.rest_after_tasks,
      body.cooldown_minutes,
      body.rate_limit_buffer,
      body.max_concurrent_tasks,
      body.global_rate_limit,
      body.auto_retry,
      body.max_retries,
      body.task_timeout_minutes,
      body.auto_dispatch,
      body.openclaw_endpoint,
      body.openclaw_api_key,
      body.codex_path,
      body.claude_path ?? '',
      'codex',
      body.auto_launch,
      body.auto_token_refresh ?? true,
      body.token_refresh_interval_hours ?? 72,
    ],
  );
  await createLog({ level: 'info', message: 'Settings updated' });

  return body;
}

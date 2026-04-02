import mysql from 'mysql2/promise';
import { config } from './config.js';
import { pool } from './db.js';
import { createSeedAccounts, createSeedTasks, createSeedLogs, defaultSettings } from './seed-data.js';

function getAdminConnectionOptions() {
  if (config.db.socketPath) {
    return {
      user: config.db.user,
      password: config.db.password,
      socketPath: config.db.socketPath,
    };
  }

  return {
    host: config.db.host || '127.0.0.1',
    port: config.db.port || 3306,
    user: config.db.user,
    password: config.db.password,
  };
}

async function ensureDatabase() {
  const connection = await mysql.createConnection(getAdminConnectionOptions());
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${config.db.database}\``);
  await connection.end();
}

async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id VARCHAR(64) PRIMARY KEY,
      account_id VARCHAR(64) NOT NULL,
      email VARCHAR(255) NOT NULL,
      auth_type ENUM('team', 'plus', 'free') NOT NULL,
      auth_file_path VARCHAR(255) NOT NULL,
      provider_mode ENUM('oauth', 'api') NOT NULL DEFAULT 'oauth',
      api_base_url VARCHAR(255) NOT NULL DEFAULT '',
      api_key VARCHAR(255) NOT NULL DEFAULT '',
      api_model VARCHAR(255) NOT NULL DEFAULT '',
      api_cli_config TEXT NULL,
      status ENUM('active', 'idle', 'error', 'rate_limited', 'cooldown') NOT NULL,
      is_current BOOLEAN NOT NULL DEFAULT FALSE,
      last_login_at DATETIME NOT NULL,
      total_tasks_completed INT NOT NULL DEFAULT 0,
      success_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
      session_start_at DATETIME NOT NULL,
      total_session_seconds INT NOT NULL DEFAULT 0,
      requests_this_minute INT NOT NULL DEFAULT 0,
      tokens_used_percent INT NOT NULL DEFAULT 0,
      last_request_at DATETIME NOT NULL,
      uptime_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
      platform VARCHAR(50) NOT NULL DEFAULT 'gpt',
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id VARCHAR(64) PRIMARY KEY,
      description TEXT NOT NULL,
      assigned_account_id VARCHAR(64) NULL,
      status ENUM('queued', 'running', 'completed', 'failed', 'retrying') NOT NULL,
      priority ENUM('low', 'medium', 'high') NOT NULL,
      result TEXT NULL,
      error_message TEXT NULL,
      retry_count INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL,
      started_at DATETIME NULL,
      completed_at DATETIME NULL,
      CONSTRAINT fk_tasks_account FOREIGN KEY (assigned_account_id) REFERENCES accounts(id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS logs (
      id VARCHAR(64) PRIMARY KEY,
      account_id VARCHAR(64) NULL,
      level ENUM('info', 'warn', 'error') NOT NULL,
      message TEXT NOT NULL,
      created_at DATETIME NOT NULL,
      CONSTRAINT fk_logs_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      id TINYINT PRIMARY KEY,
      strategy ENUM('round_robin', 'least_used', 'random', 'priority_based') NOT NULL,
      auto_rotation BOOLEAN NOT NULL DEFAULT TRUE,
      rest_after_tasks INT NOT NULL,
      cooldown_minutes INT NOT NULL,
      rate_limit_buffer INT NOT NULL,
      max_concurrent_tasks INT NOT NULL,
      global_rate_limit INT NOT NULL,
      auto_retry BOOLEAN NOT NULL DEFAULT TRUE,
      max_retries INT NOT NULL,
      task_timeout_minutes INT NOT NULL,
      auto_dispatch BOOLEAN NOT NULL DEFAULT TRUE,
      openclaw_endpoint VARCHAR(255) NOT NULL,
      openclaw_api_key VARCHAR(255) NOT NULL,
      codex_path VARCHAR(255) NOT NULL,
      trae_path VARCHAR(255) NOT NULL,
      mode ENUM('codex', 'trae') NOT NULL,
      auto_launch BOOLEAN NOT NULL DEFAULT FALSE,
      auto_token_refresh BOOLEAN NOT NULL DEFAULT TRUE,
      token_refresh_interval_hours INT NOT NULL DEFAULT 72,
      updated_at DATETIME NOT NULL
    )
  `);
}

async function createIndexIfMissing(tableName, indexName, columnsSql) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.statistics
     WHERE table_schema = ?
       AND table_name = ?
       AND index_name = ?`,
    [config.db.database, tableName, indexName],
  );

  if (rows[0].count > 0) {
    return;
  }

  try {
    await pool.query(`CREATE INDEX \`${indexName}\` ON \`${tableName}\` (${columnsSql})`);
  } catch (error) {
    if (error.code !== 'ER_DUP_KEYNAME') {
      throw error;
    }
  }
}

async function createIndexes() {
  const indexes = [
    ['accounts', 'idx_accounts_is_current', '`is_current`'],
    ['accounts', 'idx_accounts_status', '`status`'],
    ['logs', 'idx_logs_created_at', '`created_at`'],
    ['logs', 'idx_logs_level', '`level`'],
    ['logs', 'idx_logs_account_id', '`account_id`'],
    ['tasks', 'idx_tasks_created_at', '`created_at`'],
    ['tasks', 'idx_tasks_status', '`status`'],
    ['tasks', 'idx_tasks_assigned_account_id', '`assigned_account_id`'],
  ];

  for (const [tableName, indexName, columnsSql] of indexes) {
    await createIndexIfMissing(tableName, indexName, columnsSql);
  }
}

async function seedAccounts() {
  const [rows] = await pool.query('SELECT COUNT(*) AS count FROM accounts');
  if (rows[0].count > 0) {
    return;
  }

  const accounts = createSeedAccounts();
  for (const account of accounts) {
    await pool.execute(
      `INSERT INTO accounts (
        id, account_id, email, auth_type, auth_file_path, status, is_current,
        last_login_at, total_tasks_completed, success_rate, session_start_at,
        total_session_seconds, requests_this_minute, tokens_used_percent,
        last_request_at, uptime_percent, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        account.id,
        account.account_id,
        account.email,
        account.auth_type,
        account.auth_file_path,
        account.status,
        account.is_current,
        account.last_login_at,
        account.total_tasks_completed,
        account.success_rate,
        account.session_start_at,
        account.total_session_seconds,
        account.requests_this_minute,
        account.tokens_used_percent,
        account.last_request_at,
        account.uptime_percent,
        account.created_at,
        account.updated_at,
      ],
    );
  }

  const tasks = createSeedTasks(accounts);
  for (const task of tasks) {
    await pool.execute(
      `INSERT INTO tasks (
        id, description, assigned_account_id, status, priority, result,
        error_message, retry_count, created_at, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.description,
        task.assigned_account_id,
        task.status,
        task.priority,
        task.result,
        task.error_message,
        task.retry_count,
        task.created_at,
        task.started_at,
        task.completed_at,
      ],
    );
  }

  const logs = createSeedLogs(accounts);
  for (const log of logs) {
    await pool.execute(
      'INSERT INTO logs (id, account_id, level, message, created_at) VALUES (?, ?, ?, ?, ?)',
      [log.id, log.account_id, log.level, log.message, log.created_at],
    );
  }
}

async function seedSettings() {
  const [rows] = await pool.query('SELECT COUNT(*) AS count FROM settings');
  if (rows[0].count > 0) {
    return;
  }

  await pool.execute(
    `INSERT INTO settings (
      id, strategy, auto_rotation, rest_after_tasks, cooldown_minutes, rate_limit_buffer,
      max_concurrent_tasks, global_rate_limit, auto_retry, max_retries, task_timeout_minutes,
      auto_dispatch, openclaw_endpoint, openclaw_api_key, codex_path, trae_path,
      mode, auto_launch, auto_token_refresh, token_refresh_interval_hours, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      defaultSettings.strategy,
      defaultSettings.auto_rotation,
      defaultSettings.rest_after_tasks,
      defaultSettings.cooldown_minutes,
      defaultSettings.rate_limit_buffer,
      defaultSettings.max_concurrent_tasks,
      defaultSettings.global_rate_limit,
      defaultSettings.auto_retry,
      defaultSettings.max_retries,
      defaultSettings.task_timeout_minutes,
      defaultSettings.auto_dispatch,
      defaultSettings.openclaw_endpoint,
      defaultSettings.openclaw_api_key,
      defaultSettings.codex_path,
      defaultSettings.trae_path,
      defaultSettings.mode,
      defaultSettings.auto_launch,
      defaultSettings.auto_token_refresh,
      defaultSettings.token_refresh_interval_hours,
    ],
  );
}

async function migrateSettings() {
  const migrations = [
    "ALTER TABLE settings ADD COLUMN auto_token_refresh BOOLEAN NOT NULL DEFAULT TRUE",
    "ALTER TABLE settings ADD COLUMN token_refresh_interval_hours INT NOT NULL DEFAULT 72",
    "ALTER TABLE accounts ADD COLUMN platform VARCHAR(50) NOT NULL DEFAULT 'gpt'",
    "ALTER TABLE accounts ADD COLUMN provider_mode ENUM('oauth', 'api') NOT NULL DEFAULT 'oauth'",
    "ALTER TABLE accounts ADD COLUMN api_base_url VARCHAR(255) NOT NULL DEFAULT ''",
    "ALTER TABLE accounts ADD COLUMN api_key VARCHAR(255) NOT NULL DEFAULT ''",
    "ALTER TABLE accounts ADD COLUMN api_model VARCHAR(255) NOT NULL DEFAULT ''",
    "ALTER TABLE accounts ADD COLUMN api_cli_config TEXT NULL",
  ];
  for (const sql of migrations) {
    try { await pool.query(sql); } catch { /* column already exists, ignore */ }
  }
}

async function normalizeCliPathsForWindows() {
  if (process.platform !== 'win32') {
    return;
  }

  await pool.execute(
    `UPDATE settings
     SET codex_path = CASE WHEN codex_path = '/usr/local/bin/codex' THEN '' ELSE codex_path END,
         trae_path = CASE WHEN trae_path = '/usr/local/bin/trae' THEN '' ELSE trae_path END,
         updated_at = NOW()
     WHERE id = 1`,
  );
}

export async function initDatabase() {
  await ensureDatabase();
  await createTables();
  await createIndexes();
  await migrateSettings();
  await normalizeCliPathsForWindows();

  if (process.env.NODE_ENV !== 'production') {
    await seedAccounts();
  }
  await seedSettings();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  initDatabase()
    .then(async () => {
      await pool.end();
      console.log('Database initialized');
    })
    .catch(async (error) => {
      console.error(error);
      await pool.end();
      process.exit(1);
    });
}

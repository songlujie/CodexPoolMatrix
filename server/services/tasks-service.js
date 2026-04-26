import crypto from 'node:crypto';
import { pool } from '../db.js';
import { createLog } from './log-service.js';

export async function listTasks() {
  const [rows] = await pool.query(`
    SELECT tasks.*, accounts.account_id AS assigned_account_name
    FROM tasks
    LEFT JOIN accounts ON accounts.id = tasks.assigned_account_id
    ORDER BY tasks.created_at DESC
  `);

  return rows;
}

export async function createTask({ description, priority, account }) {
  let assignedAccountId = null;

  if (account && account !== 'auto') {
    assignedAccountId = account;
  } else {
    const [accounts] = await pool.query(
      "SELECT id FROM accounts WHERE status IN ('active', 'idle') ORDER BY is_current DESC, updated_at ASC LIMIT 1",
    );
    assignedAccountId = accounts[0]?.id || null;
  }

  const id = crypto.randomUUID();
  await pool.execute(
    `INSERT INTO tasks (
      id, description, assigned_account_id, status, priority, result,
      error_message, retry_count, created_at, started_at, completed_at
    ) VALUES (?, ?, ?, 'queued', ?, NULL, NULL, 0, NOW(), NULL, NULL)`,
    [id, description, assignedAccountId, priority],
  );
  await createLog({ accountId: assignedAccountId, message: `Task created: ${description}` });

  const [rows] = await pool.query(`
    SELECT tasks.*, accounts.account_id AS assigned_account_name
    FROM tasks
    LEFT JOIN accounts ON accounts.id = tasks.assigned_account_id
    WHERE tasks.id = ?
  `, [id]);

  return rows[0];
}

export async function batchRetryTasks(ids = []) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { updated: 0 };
  }

  await pool.query(
    `UPDATE tasks
     SET status = 'queued', retry_count = retry_count + 1, error_message = NULL, result = NULL
     WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  await createLog({ level: 'info', message: `${ids.length} tasks queued for retry` });

  return { updated: ids.length };
}

export async function batchCancelTasks(ids = []) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { deleted: 0 };
  }

  await pool.query(`DELETE FROM tasks WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  await createLog({ level: 'warn', message: `${ids.length} tasks cancelled` });

  return { deleted: ids.length };
}

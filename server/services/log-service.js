import crypto from 'node:crypto';
import { pool } from '../db.js';

export async function createLog({ accountId = null, level = 'info', message }) {
  await pool.execute(
    'INSERT INTO logs (id, account_id, level, message, created_at) VALUES (?, ?, ?, ?, NOW())',
    [crypto.randomUUID(), accountId, level, message],
  );
}

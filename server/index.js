import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { config } from './config.js';
import { initDatabase } from './init-db.js';
import { pool } from './db.js';

/**
 * 展开路径中的 ~ 为用户主目录
 */
function expandPath(filePath) {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

/**
 * 切换账号时，将目标账号的 auth 文件复制到 Codex 的默认 auth 位置
 * Codex CLI 默认读取 ~/.codex/auth.json（无账号名后缀）
 */
async function switchAuthFile(authFilePath) {
  if (!authFilePath) return { ok: false, reason: 'auth_file_path 为空' };

  const src = expandPath(authFilePath);
  const defaultAuthDir = path.join(os.homedir(), '.codex');
  const dest = path.join(defaultAuthDir, 'auth.json');

  try {
    if (!fs.existsSync(src)) {
      return { ok: false, reason: `auth 文件不存在: ${src}` };
    }
    fs.mkdirSync(defaultAuthDir, { recursive: true });
    fs.copyFileSync(src, dest);
    return { ok: true, dest };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * 解码 JWT payload（不验证签名，只读取数据）
 */
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const padded = parts[1] + '='.repeat((4 - parts[1].length % 4) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

const app = express();

app.use(cors({ origin: config.frontendOrigin }));
app.use(express.json());

function mapAccount(row) {
  return {
    ...row,
    is_current: Boolean(row.is_current),
    success_rate: Number(row.success_rate),
    uptime_percent: Number(row.uptime_percent),
  };
}

function mapTask(row) {
  return {
    ...row,
    assigned_account_name: row.assigned_account_name || undefined,
  };
}

async function createLog({ accountId = null, level = 'info', message }) {
  await pool.execute(
    'INSERT INTO logs (id, account_id, level, message, created_at) VALUES (?, ?, ?, ?, NOW())',
    [crypto.randomUUID(), accountId, level, message],
  );
}

app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
});

app.get('/api/accounts', async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM accounts ORDER BY is_current DESC, account_id ASC');
  res.json(rows.map(mapAccount));
});

app.post('/api/accounts', async (req, res) => {
  const body = req.body;
  const id = crypto.randomUUID();
  await pool.execute(
    `INSERT INTO accounts (
      id, account_id, email, auth_type, auth_file_path, status, is_current,
      last_login_at, total_tasks_completed, success_rate, session_start_at,
      total_session_seconds, requests_this_minute, tokens_used_percent,
      last_request_at, uptime_percent, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'idle', FALSE, NOW(), 0, 100, NOW(), 0, 0, 0, NOW(), 100, NOW(), NOW())`,
    [id, body.account_id, body.email, body.auth_type, body.auth_file_path],
  );
  await createLog({ accountId: id, message: `Account ${body.account_id} added` });
  const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
  res.status(201).json(mapAccount(rows[0]));
});

app.patch('/api/accounts/:id', async (req, res) => {
  const { id } = req.params;
  const { action } = req.body;

  if (action === 'setActive') {
    // 1. 获取目标账号的 auth 文件路径
    const [targetRows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
    if (targetRows.length === 0) {
      return res.status(404).json({ message: '账号不存在' });
    }
    const targetAccount = targetRows[0];

    // 2. 实际切换 auth 文件（把该账号的 auth 文件复制到 Codex 默认读取位置）
    const switchResult = await switchAuthFile(targetAccount.auth_file_path);
    if (!switchResult.ok) {
      // auth 文件不存在时，记录警告但不阻断切换（文件可能还未创建）
      await createLog({ accountId: id, level: 'warn', message: `Auth 文件切换失败: ${switchResult.reason}` });
    } else {
      await createLog({ accountId: id, message: `Auth 文件已切换: ${switchResult.dest}` });
    }

    // 3. 更新数据库状态
    await pool.execute("UPDATE accounts SET is_current = FALSE, status = CASE WHEN status = 'active' THEN 'idle' ELSE status END, updated_at = NOW()");
    await pool.execute("UPDATE accounts SET is_current = TRUE, status = 'active', updated_at = NOW() WHERE id = ?", [id]);
    await createLog({ accountId: id, message: `账号 ${targetAccount.account_id} 已切换为活跃账号` });
  } else if (action === 'pause') {
    await pool.execute("UPDATE accounts SET status = 'idle', is_current = FALSE, updated_at = NOW() WHERE id = ?", [id]);
    await createLog({ accountId: id, level: 'warn', message: 'Account paused' });
  } else if (action === 'reset') {
    await pool.execute(
      'UPDATE accounts SET status = ?, requests_this_minute = 0, tokens_used_percent = 0, updated_at = NOW() WHERE id = ?',
      ['idle', id],
    );
    await createLog({ accountId: id, message: 'Account reset' });
  } else {
    return res.status(400).json({ message: 'Unsupported action' });
  }

  const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
  res.json(mapAccount(rows[0]));
});

app.delete('/api/accounts/:id', async (req, res) => {
  const { id } = req.params;
  await pool.execute('DELETE FROM accounts WHERE id = ?', [id]);
  await createLog({ level: 'warn', message: `Account ${id} removed` });
  res.status(204).end();
});

// 清空所有账号（用于清除假数据）
app.delete('/api/accounts', async (_req, res) => {
  const [rows] = await pool.query('SELECT COUNT(*) AS count FROM accounts');
  const count = rows[0].count;
  await pool.query('DELETE FROM accounts');
  await createLog({ level: 'warn', message: `已清空全部 ${count} 个账号` });
  res.status(204).end();
});

// 读取账号 auth 文件，解析邮箱 / 套餐 / token 有效期 / OpenAI 用量
app.get('/api/accounts/:id/auth-info', async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
  if (!rows.length) return res.status(404).json({ message: '账号不存在' });

  const account = rows[0];
  const authFilePath = expandPath(account.auth_file_path);

  if (!fs.existsSync(authFilePath)) {
    return res.json({ error: 'auth_file_not_found', path: account.auth_file_path });
  }

  let authData;
  try {
    authData = JSON.parse(fs.readFileSync(authFilePath, 'utf8'));
  } catch {
    return res.json({ error: 'invalid_auth_file' });
  }

  const idToken = authData.tokens?.id_token;
  const accessToken = authData.tokens?.access_token;

  // 从 JWT 解析基本信息
  let email = null, plan_type = null, token_expires_at = null;
  // 从 id_token 读邮箱和套餐（id_token 只有 1 小时有效期，但邮箱/套餐信息在里面）
  if (idToken) {
    const decoded = decodeJwtPayload(idToken);
    if (decoded) {
      email = decoded.email;
      plan_type = decoded['https://api.openai.com/auth']?.chatgpt_plan_type ?? null;
    }
  }

  // 从 access_token 读有效期（access_token 有效期约 10 天，这才是实际使用的 token）
  if (accessToken) {
    const decoded = decodeJwtPayload(accessToken);
    if (decoded?.exp) {
      token_expires_at = new Date(decoded.exp * 1000).toISOString();
      // 如果 access_token 里也有邮箱，优先用它
      if (!email && decoded['https://api.openai.com/profile']?.email) {
        email = decoded['https://api.openai.com/profile'].email;
      }
      if (!plan_type && decoded['https://api.openai.com/auth']?.chatgpt_plan_type) {
        plan_type = decoded['https://api.openai.com/auth'].chatgpt_plan_type;
      }
    }
  }

  // 尝试调用 OpenAI API 获取账号用量（5小时 / 周限制）
  let usage = null;
  if (accessToken) {
    try {
      const resp = await fetch('https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(6000),
      });
      if (resp.ok) {
        const data = await resp.json();
        // 提取 message_cap_rollover 相关限制信息
        const limits = data?.account_plan?.is_paid_subscription_active !== undefined ? data : null;
        if (limits) {
          usage = {
            plan: limits.account_plan?.plan_type,
            is_paid: limits.account_plan?.is_paid_subscription_active,
            message_cap: limits.message_cap ?? null,
            message_cap_rollover: limits.message_cap_rollover ?? null,
          };
        }
      }
    } catch { /* 网络超时或接口不可用，忽略 */ }
  }

  res.json({
    email,
    plan_type,
    token_expires_at,
    last_refresh: authData.last_refresh ?? null,
    usage,
  });
});

// 测试账号可用性：用该账号的 token 调一次 OpenAI，读限额 header
app.post('/api/accounts/:id/check-usage', async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
  if (!rows.length) return res.status(404).json({ message: '账号不存在' });

  const account = rows[0];
  const authFilePath = expandPath(account.auth_file_path);

  if (!fs.existsSync(authFilePath)) {
    return res.json({ ok: false, error: 'auth_file_not_found' });
  }

  let authData;
  try {
    authData = JSON.parse(fs.readFileSync(authFilePath, 'utf8'));
  } catch {
    return res.json({ ok: false, error: 'invalid_auth_file' });
  }

  const accessToken = authData.tokens?.access_token;
  if (!accessToken) return res.json({ ok: false, error: 'no_access_token' });

  // 你的账号是 ChatGPT OAuth token，走 chatgpt.com 的接口，不是 api.openai.com
  // 依次尝试两个端点，返回第一个成功的
  const endpoints = [
    { url: 'https://chatgpt.com/backend-api/me', method: 'GET' },
    { url: 'https://api.openai.com/v1/me',       method: 'GET' },
  ];

  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const resp = await fetch(endpoint.url, {
        method: endpoint.method,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(8000),
      });

      const headers = Object.fromEntries(resp.headers.entries());
      const rateLimit = {
        limit_requests:     headers['x-ratelimit-limit-requests']     ?? null,
        remaining_requests: headers['x-ratelimit-remaining-requests'] ?? null,
        reset_requests:     headers['x-ratelimit-reset-requests']     ?? null,
        limit_tokens:       headers['x-ratelimit-limit-tokens']       ?? null,
        remaining_tokens:   headers['x-ratelimit-remaining-tokens']   ?? null,
      };

      if (resp.status === 429) {
        const retryAfter = headers['retry-after'] ?? null;
        await pool.execute("UPDATE accounts SET status = 'rate_limited', updated_at = NOW() WHERE id = ?", [id]);
        await createLog({ accountId: id, level: 'warn', message: '账号已触发速率限制 (429)' });
        return res.json({ ok: false, status: 429, rate_limited: true, retry_after: retryAfter, rate_limit: rateLimit });
      }

      if (resp.status === 401) {
        await pool.execute("UPDATE accounts SET status = 'error', updated_at = NOW() WHERE id = ?", [id]);
        await createLog({ accountId: id, level: 'error', message: 'Token 无效或已过期 (401)' });
        return res.json({ ok: false, status: 401, error: 'token_invalid' });
      }

      if (resp.ok) {
        let body = null;
        try { body = await resp.json(); } catch { /* ignore */ }

        if (account.status === 'error' || account.status === 'rate_limited') {
          await pool.execute("UPDATE accounts SET status = 'idle', updated_at = NOW() WHERE id = ?", [id]);
        }
        await createLog({ accountId: id, message: `账号可用性检测通过 (${endpoint.url})` });

        // 从 /me 接口提取邮箱信息（可用于二次确认）
        const email = body?.email ?? null;
        return res.json({ ok: true, status: resp.status, email, rate_limit: rateLimit });
      }

      // 其他非成功状态码，换下一个端点继续试
      lastError = `HTTP ${resp.status} from ${endpoint.url}`;
    } catch (err) {
      lastError = `${endpoint.url}: ${err.message}`;
    }
  }

  // 所有端点都失败了
  await createLog({ accountId: id, level: 'error', message: `可用性检测失败: ${lastError}` });
  return res.json({ ok: false, error: lastError });
});

app.get('/api/tasks', async (_req, res) => {
  const [rows] = await pool.query(`
    SELECT tasks.*, accounts.account_id AS assigned_account_name
    FROM tasks
    LEFT JOIN accounts ON accounts.id = tasks.assigned_account_id
    ORDER BY tasks.created_at DESC
  `);
  res.json(rows.map(mapTask));
});

app.post('/api/tasks', async (req, res) => {
  const { description, priority, account } = req.body;
  let assignedAccountId = null;

  if (account && account !== 'auto') {
    assignedAccountId = account;
  } else {
    const [accounts] = await pool.query("SELECT id FROM accounts WHERE status IN ('active', 'idle') ORDER BY is_current DESC, updated_at ASC LIMIT 1");
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
  res.status(201).json(mapTask(rows[0]));
});

app.post('/api/tasks/batch-retry', async (req, res) => {
  const ids = req.body.ids || [];
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.json({ updated: 0 });
  }

  await pool.query(`UPDATE tasks SET status = 'queued', retry_count = retry_count + 1, error_message = NULL, result = NULL WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  await createLog({ level: 'info', message: `${ids.length} tasks queued for retry` });
  res.json({ updated: ids.length });
});

app.post('/api/tasks/batch-cancel', async (req, res) => {
  const ids = req.body.ids || [];
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.json({ deleted: 0 });
  }

  await pool.query(`DELETE FROM tasks WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  await createLog({ level: 'warn', message: `${ids.length} tasks cancelled` });
  res.json({ deleted: ids.length });
});

app.get('/api/logs', async (req, res) => {
  const { level = 'all', account = 'all' } = req.query;
  let sql = `
    SELECT logs.*, accounts.account_id AS account_name
    FROM logs
    LEFT JOIN accounts ON accounts.id = logs.account_id
    WHERE 1 = 1
  `;
  const params = [];

  if (level !== 'all') {
    sql += ' AND logs.level = ?';
    params.push(level);
  }
  if (account !== 'all') {
    sql += ' AND accounts.account_id = ?';
    params.push(account);
  }

  sql += ' ORDER BY logs.created_at ASC';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
});

app.delete('/api/logs', async (_req, res) => {
  await pool.query('DELETE FROM logs');
  res.status(204).end();
});

app.get('/api/settings', async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM settings WHERE id = 1');
  const { id, updated_at, ...settings } = rows[0];
  res.json(settings);
});

app.put('/api/settings', async (req, res) => {
  const body = req.body;
  await pool.execute(
    `UPDATE settings SET
      strategy = ?, auto_rotation = ?, rest_after_tasks = ?, cooldown_minutes = ?,
      rate_limit_buffer = ?, max_concurrent_tasks = ?, global_rate_limit = ?,
      auto_retry = ?, max_retries = ?, task_timeout_minutes = ?, auto_dispatch = ?,
      openclaw_endpoint = ?, openclaw_api_key = ?, codex_path = ?, trae_path = ?,
      mode = ?, auto_launch = ?, updated_at = NOW()
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
      body.trae_path,
      body.mode,
      body.auto_launch,
    ],
  );
  await createLog({ level: 'info', message: 'Settings updated' });
  res.json(body);
});

app.post('/api/actions/rotate', async (_req, res) => {
  const [accounts] = await pool.query('SELECT * FROM accounts ORDER BY account_id ASC');
  if (accounts.length === 0) {
    return res.status(400).json({ message: 'No accounts available' });
  }

  const activeIndex = Math.max(accounts.findIndex((account) => account.is_current), 0);
  const nextAccount = accounts[(activeIndex + 1) % accounts.length];

  await pool.execute("UPDATE accounts SET is_current = FALSE, status = CASE WHEN status = 'active' THEN 'idle' ELSE status END, updated_at = NOW()");
  await pool.execute("UPDATE accounts SET is_current = TRUE, status = 'active', updated_at = NOW() WHERE id = ?", [nextAccount.id]);
  await createLog({ accountId: nextAccount.id, message: `Rotated to ${nextAccount.account_id}` });

  const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [nextAccount.id]);
  res.json(mapAccount(rows[0]));
});

app.post('/api/actions/pause-all', async (_req, res) => {
  await pool.execute("UPDATE accounts SET status = 'idle', is_current = FALSE, updated_at = NOW()");
  await createLog({ level: 'warn', message: 'All accounts paused' });
  res.status(204).end();
});

// ─────────────────────────────────────────────
// 自动轮换：动态轮询 + 阈值触发切换
// ─────────────────────────────────────────────
let autoCheckTimer = null;
let lastAutoCheck = null; // { checked_at, account_id, primary_used, secondary_used }

/** 根据已用百分比决定下次检测间隔 */
function getCheckInterval(primaryUsed) {
  if (primaryUsed >= 80) return 5 * 60 * 1000;   // 5 分钟
  if (primaryUsed >= 50) return 10 * 60 * 1000;  // 10 分钟
  return 30 * 60 * 1000;                          // 30 分钟
}

/** 用某个账号的 token 调 Codex API，返回用量 header */
async function fetchUsageForAccount(account) {
  const authFilePath = expandPath(account.auth_file_path);
  if (!fs.existsSync(authFilePath)) return null;
  let authData;
  try { authData = JSON.parse(fs.readFileSync(authFilePath, 'utf8')); } catch { return null; }
  const accessToken = authData.tokens?.access_token;
  if (!accessToken) return null;

  try {
    const resp = await fetch('https://chatgpt.com/backend-api/codex/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        model: 'gpt-5.3-codex',
        instructions: 'Reply with one word only.',
        input: [{ role: 'user', content: 'hi' }],
        stream: true,
        store: false,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) { await resp.body?.cancel().catch(() => {}); return null; }
    const h = resp.headers;
    await resp.body?.cancel().catch(() => {});
    const pUsed = h.get('x-codex-primary-used-percent');
    const sUsed = h.get('x-codex-secondary-used-percent');
    const pResetAt = h.get('x-codex-primary-reset-at');
    const sResetAt = h.get('x-codex-secondary-reset-at');
    const pMins = h.get('x-codex-primary-window-minutes');
    const sMins = h.get('x-codex-secondary-window-minutes');
    const planType = h.get('x-codex-plan-type');
    if (pUsed == null && sUsed == null) return null;
    return {
      primary_used: Number(pUsed ?? 0),
      secondary_used: Number(sUsed ?? 0),
      plan_type: planType,
      primary: { used_percent: Number(pUsed ?? 0), window_minutes: pMins ? Number(pMins) : 300, resets_at: pResetAt ? new Date(Number(pResetAt) * 1000).toISOString() : null },
      secondary: { used_percent: Number(sUsed ?? 0), window_minutes: sMins ? Number(sMins) : 10080, resets_at: sResetAt ? new Date(Number(sResetAt) * 1000).toISOString() : null },
    };
  } catch { return null; }
}

async function runAutoCheck() {
  autoCheckTimer = null;
  let nextInterval = 30 * 60 * 1000;

  try {
    // 检查是否开启自动轮换
    const [settingsRows] = await pool.query('SELECT auto_rotation FROM settings WHERE id = 1');
    if (!settingsRows[0]?.auto_rotation) {
      autoCheckTimer = setTimeout(runAutoCheck, 60 * 1000); // 1分钟后再检查设置
      return;
    }

    // 获取当前活跃账号
    const [activeRows] = await pool.query("SELECT * FROM accounts WHERE is_current = TRUE LIMIT 1");
    if (!activeRows.length) {
      autoCheckTimer = setTimeout(runAutoCheck, nextInterval);
      return;
    }
    const account = activeRows[0];

    // 调用 API 获取用量
    const usage = await fetchUsageForAccount(account);
    if (!usage) {
      autoCheckTimer = setTimeout(runAutoCheck, 10 * 60 * 1000);
      return;
    }

    const { primary_used, secondary_used } = usage;
    lastAutoCheck = { checked_at: new Date().toISOString(), account_id: account.account_id, primary_used, secondary_used };
    await createLog({ accountId: account.id, message: `[自动] 用量检测: 5h=${primary_used}% 周=${secondary_used}%` });

    // 5小时用量超过 90% → 自动切换
    if (primary_used >= 90) {
      const [allAccounts] = await pool.query("SELECT * FROM accounts WHERE status != 'error' ORDER BY account_id ASC");
      const idx = allAccounts.findIndex(a => a.id === account.id);
      const next = allAccounts[(idx + 1) % allAccounts.length];

      if (next && next.id !== account.id) {
        await switchAuthFile(next.auth_file_path);
        await pool.execute("UPDATE accounts SET is_current = FALSE, status = CASE WHEN status = 'active' THEN 'idle' ELSE status END, updated_at = NOW()");
        await pool.execute("UPDATE accounts SET is_current = TRUE, status = 'active', updated_at = NOW() WHERE id = ?", [next.id]);
        await createLog({ accountId: next.id, level: 'warn', message: `[自动轮换] ${account.account_id} 5h用量=${primary_used}%，已切换至 ${next.account_id}` });
        nextInterval = 30 * 60 * 1000; // 切换后重置为 30 分钟
      }
    } else {
      nextInterval = getCheckInterval(primary_used);
    }
  } catch (err) {
    console.error('[自动轮换] 检测出错:', err.message);
    nextInterval = 10 * 60 * 1000;
  }

  autoCheckTimer = setTimeout(runAutoCheck, nextInterval);
}

// 查询自动轮换状态
app.get('/api/auto-check/status', (_req, res) => {
  res.json({ running: autoCheckTimer !== null, last_check: lastAutoCheck });
});

// 通过真实 Codex API 调用获取该账号的实时用量（消耗极少 token）
app.post('/api/accounts/:id/refresh-codex-usage', async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
  if (!rows.length) return res.status(404).json({ message: '账号不存在' });

  const account = rows[0];
  const authFilePath = expandPath(account.auth_file_path);

  if (!fs.existsSync(authFilePath)) {
    return res.json({ ok: false, error: 'auth_file_not_found' });
  }

  let authData;
  try {
    authData = JSON.parse(fs.readFileSync(authFilePath, 'utf8'));
  } catch {
    return res.json({ ok: false, error: 'invalid_auth_file' });
  }

  const accessToken = authData.tokens?.access_token;
  if (!accessToken) return res.json({ ok: false, error: 'no_access_token' });

  // 复用共用函数
  const usage = await fetchUsageForAccount(account);
  if (!usage) return res.json({ ok: false, error: 'no_usage_headers' });

  await createLog({ accountId: id, message: `Codex 用量刷新: 5h=${usage.primary_used}% 周=${usage.secondary_used}%` });

  res.json({
    ok: true,
    fetched_at: new Date().toISOString(),
    plan_type: usage.plan_type,
    primary: usage.primary,
    secondary: usage.secondary,
  });
});

// 读取本地 ~/.codex/sessions/ 获取最近的 Codex 用量数据（5h / 周）
app.get('/api/codex-usage', (_req, res) => {
  const sessionsDir = path.join(os.homedir(), '.codex', 'sessions');

  if (!fs.existsSync(sessionsDir)) {
    return res.json({ found: false, reason: 'sessions_dir_not_found' });
  }

  // 倒序扫描最近 7 天，找最新的含 rate_limits 的 token_count 事件
  const now = new Date();
  let latestEvent = null;
  let latestTimestamp = null;

  outer:
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const d = new Date(now.getTime() - dayOffset * 86400000);
    const year = d.getFullYear().toString();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dirPath = path.join(sessionsDir, year, month, day);

    if (!fs.existsSync(dirPath)) continue;

    // 按文件名倒序（最新文件优先）
    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .reverse();

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      let lines;
      try {
        lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).reverse();
      } catch { continue; }

      for (const line of lines) {
        try {
          const record = JSON.parse(line);
          if (
            record.type === 'event_msg' &&
            record.payload?.type === 'token_count' &&
            record.payload?.rate_limits != null
          ) {
            const ts = new Date(record.timestamp);
            if (!latestTimestamp || ts > latestTimestamp) {
              latestTimestamp = ts;
              latestEvent = record;
            }
            // 已找到此文件中的最新记录，跳出到下一文件
            break;
          }
        } catch { /* 跳过无效行 */ }
      }

      if (latestEvent) break outer; // 找到后立即停止扫描
    }
  }

  if (!latestEvent) {
    return res.json({ found: false, reason: 'no_rate_limit_data' });
  }

  const { primary, secondary } = latestEvent.payload.rate_limits;
  const recordedAt = latestEvent.timestamp;
  const recordedAtMs = new Date(recordedAt).getTime();

  // 根据记录时间 + resets_in_seconds 推算出实际重置时间
  const primaryResetsAt = primary?.resets_in_seconds != null
    ? new Date(recordedAtMs + primary.resets_in_seconds * 1000).toISOString()
    : null;
  const secondaryResetsAt = secondary?.resets_in_seconds != null
    ? new Date(recordedAtMs + secondary.resets_in_seconds * 1000).toISOString()
    : null;

  // 同时返回 token 用量（如果有的话）
  const tokenUsage = latestEvent.payload?.info?.total_token_usage ?? null;

  res.json({
    found: true,
    recorded_at: recordedAt,
    primary: primary ? {
      used_percent: primary.used_percent,
      window_minutes: primary.window_minutes,
      resets_at: primaryResetsAt,
    } : null,
    secondary: secondary ? {
      used_percent: secondary.used_percent,
      window_minutes: secondary.window_minutes,
      resets_at: secondaryResetsAt,
    } : null,
    token_usage: tokenUsage,
  });
});

app.post('/api/actions/health-check', async (_req, res) => {
  const [rows] = await pool.query('SELECT COUNT(*) AS total FROM accounts');
  await createLog({ level: 'info', message: 'Health check completed' });
  res.json({ ok: true, totalAccounts: rows[0].total });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ message: error.message || 'Unexpected server error' });
});

async function start() {
  await initDatabase();
  app.listen(config.port, () => {
    console.log(`API server listening on http://localhost:${config.port}`);
  });
  // 启动自动轮换检测（延迟 10 秒等数据库就绪）
  setTimeout(runAutoCheck, 10 * 1000);
}

start().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});

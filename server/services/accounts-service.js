import crypto from 'node:crypto';

export function createAccountsService({
  fs,
  path,
  pool,
  createLog,
  mapAccount,
  expandPath,
  requestJson,
  getAuthIdentity,
  buildAuthStorageFileName,
  sanitizeApiCliConfigSnippet,
  validateApiCliConfigSnippet,
  activateApiProviderForCurrentMode,
  validateCodexApiConfig,
  buildManagedCodexProviderBlock,
  isApiAccount,
  decodeJwtPayload,
  getCurrentAuth,
  getSelectedRuntimeMode,
  readClaudeSettings,
  readClaudeMatrixState,
  normalizeClaudeBaseUrl,
}) {
  const SAMPLE_ACCOUNT_IDS = new Set(['a26', 'a62', 'a03', 'JERRY', 'b14', 'c88', 'd42', 'e99', 'f17', 'g05']);

  function inferAuthType(planType) {
    const normalized = String(planType || '').trim().toLowerCase();
    if (normalized.includes('team')) return 'team';
    if (normalized.includes('free')) return 'free';
    return 'plus';
  }

  function isLikelySeedAccount(row = {}) {
    const accountId = String(row.account_id || '').trim();
    const email = String(row.email || '').trim().toLowerCase();
    const authFilePath = String(row.auth_file_path || '').trim();

    return SAMPLE_ACCOUNT_IDS.has(accountId)
      && email.endsWith('@codex.team')
      && /^~\/\.codex\/auth\/.+\.json$/i.test(authFilePath);
  }

  function findMatchingRuntimeAccount(rows, runtimeAccount) {
    const runtimeAccountId = String(runtimeAccount.account_id || '').trim();
    const runtimeEmail = String(runtimeAccount.email || '').trim().toLowerCase();
    const runtimePath = String(runtimeAccount.auth_file_path || '').trim();

    return rows.find((row) => {
      const rowAccountId = String(row.account_id || '').trim();
      const rowEmail = String(row.email || '').trim().toLowerCase();
      const rowPath = String(row.auth_file_path || '').trim();

      if (runtimeAccount.provider_mode === 'api' && row.provider_mode === 'api' && runtimeAccountId && rowAccountId === runtimeAccountId) {
        return true;
      }

      if (runtimeEmail && rowEmail === runtimeEmail) {
        return true;
      }

      if (runtimePath && rowPath === runtimePath) {
        return true;
      }

      return runtimeAccountId && rowAccountId === runtimeAccountId;
    });
  }

  function getClaudeEnv(settings) {
    return settings?.env && typeof settings.env === 'object' && !Array.isArray(settings.env)
      ? settings.env
      : {};
  }

  function sanitizeAccountName(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9@._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120);
  }

  function buildClaudeLocalAccountSnapshot({ settings, matrixState }) {
    const env = getClaudeEnv(settings);
    const apiKey = String(env.ANTHROPIC_AUTH_TOKEN || '').trim();
    const apiBaseUrl = normalizeClaudeBaseUrl(env.ANTHROPIC_BASE_URL || '');
    const apiModel = String(env.ANTHROPIC_MODEL || '').trim();
    const email = String(matrixState?.email || '').trim().toLowerCase();
    const currentAccountId = String(matrixState?.mode === 'api' ? (matrixState?.account_id || '') : '').trim();

    if (!apiKey) {
      const error = new Error('未检测到当前 Claude 本机配置中的 ANTHROPIC_AUTH_TOKEN');
      error.status = 400;
      throw error;
    }

    let accountId = sanitizeAccountName(currentAccountId)
      || sanitizeAccountName(email);

    if (!accountId) {
      const host = (() => {
        try {
          return apiBaseUrl ? new URL(apiBaseUrl).hostname : 'local';
        } catch {
          return 'local';
        }
      })();
      accountId = `claude-${sanitizeAccountName(host) || 'local'}`;
    }

    return {
      account_id: accountId,
      email,
      auth_type: 'plus',
      auth_file_path: '',
      provider_mode: 'api',
      api_base_url: apiBaseUrl,
      api_key: apiKey,
      api_model: apiModel,
      api_cli_config: '',
      platform: 'claude',
      source_mode: String(matrixState?.mode || '').trim() || null,
      source_account_id: String(matrixState?.account_id || '').trim() || null,
      source_email: email || null,
    };
  }

  async function buildRuntimeAccountSnapshot() {
    const currentAuth = await getCurrentAuth();
    if (!currentAuth?.found) {
      return null;
    }

    const runtimeMode = await getSelectedRuntimeMode();
    const accountId = String(currentAuth.account_id || currentAuth.email || '').trim();
    if (!accountId) {
      return null;
    }

    return {
      account_id: accountId,
      email: String(currentAuth.email || '').trim(),
      auth_type: inferAuthType(currentAuth.plan_type),
      auth_file_path: String(currentAuth.path || '').trim(),
      provider_mode: currentAuth.provider_mode === 'api' ? 'api' : 'oauth',
      api_base_url: String(currentAuth.api_base_url || '').trim(),
      api_model: String(currentAuth.api_model || '').trim(),
      api_cli_config: String(currentAuth.api_cli_config || '').trim(),
      platform: runtimeMode === 'claude' ? 'claude' : 'gpt',
      status: 'active',
    };
  }

  async function clearSeedDashboardData() {
    await pool.query('DELETE FROM tasks');
    await pool.query('DELETE FROM logs');
    await pool.query('DELETE FROM accounts');
  }

  async function ensureRuntimeAccountsSynced() {
    const runtimeAccount = await buildRuntimeAccountSnapshot();
    const [rows] = await pool.query('SELECT * FROM accounts ORDER BY is_current DESC, account_id ASC');

    if (!runtimeAccount) {
      if (rows.length > 0 && rows.every(isLikelySeedAccount)) {
        await clearSeedDashboardData();
        return [];
      }
      return rows;
    }

    let workingRows = rows;
    if (workingRows.length > 0 && workingRows.every(isLikelySeedAccount)) {
      await clearSeedDashboardData();
      workingRows = [];
    }

    const matched = findMatchingRuntimeAccount(workingRows, runtimeAccount);
    await pool.execute('UPDATE accounts SET is_current = FALSE WHERE is_current = TRUE');

    if (matched) {
      await pool.execute(
        `UPDATE accounts
         SET account_id = ?, email = ?, auth_type = ?, auth_file_path = ?, provider_mode = ?,
             api_base_url = ?, api_model = ?, api_cli_config = ?, platform = ?, status = ?, is_current = TRUE,
             updated_at = NOW()
         WHERE id = ?`,
        [
          runtimeAccount.account_id,
          runtimeAccount.email,
          runtimeAccount.auth_type,
          runtimeAccount.auth_file_path,
          runtimeAccount.provider_mode,
          runtimeAccount.api_base_url,
          runtimeAccount.api_model,
          runtimeAccount.api_cli_config,
          runtimeAccount.platform,
          runtimeAccount.status,
          matched.id,
        ],
      );
    } else {
      const id = crypto.randomUUID();
      await pool.execute(
        `INSERT INTO accounts (
          id, account_id, email, auth_type, auth_file_path, provider_mode, api_base_url, api_key, api_model, api_cli_config, platform, status, is_current,
          last_login_at, total_tasks_completed, success_rate, session_start_at, total_session_seconds, requests_this_minute, tokens_used_percent,
          last_request_at, uptime_percent, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, TRUE, NOW(), 0, 100, NOW(), 0, 0, 0, NOW(), 100, NOW(), NOW())`,
        [
          id,
          runtimeAccount.account_id,
          runtimeAccount.email,
          runtimeAccount.auth_type,
          runtimeAccount.auth_file_path,
          runtimeAccount.provider_mode,
          runtimeAccount.api_base_url,
          runtimeAccount.api_model,
          runtimeAccount.api_cli_config,
          runtimeAccount.platform,
          runtimeAccount.status,
        ],
      );
    }

    const [nextRows] = await pool.query('SELECT * FROM accounts ORDER BY is_current DESC, account_id ASC');
    return nextRows;
  }

  return {
    async listAccounts() {
      const rows = await ensureRuntimeAccountsSynced();
      return rows.map(mapAccount);
    },

    async scanAccountsDir(dir) {
      let entries;
      try {
        entries = await fs.readdir(dir);
      } catch {
        return { files: [], error: `目录不存在或无权限: ${dir}`, dir };
      }

      const jsonFiles = entries.filter((file) => file.endsWith('.json'));
      const [existingRows] = await pool.query('SELECT auth_file_path, email FROM accounts');
      const existingPaths = new Set(existingRows.map((row) => row.auth_file_path));
      const existingEmails = new Set(existingRows.map((row) => (row.email || '').toLowerCase()).filter(Boolean));

      const files = [];
      for (const file of jsonFiles) {
        const fullPath = path.join(dir, file);
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          const parsed = JSON.parse(content);
          const identity = getAuthIdentity(parsed);
          const email = identity.email;

          let auth_type = 'plus';
          const accessToken = identity.accessToken;
          if (accessToken) {
            try {
              const whamResp = await requestJson('https://chatgpt.com/backend-api/wham/usage', {
                headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
                timeoutMs: 8000,
              });
              if (whamResp.ok) {
                const pt = whamResp.json?.plan_type || '';
                auth_type = pt.includes('team') ? 'team' : pt.includes('free') ? 'free' : 'plus';
              }
            } catch {
              // Ignore network failures and fall back to plus.
            }
          }

          const suggestedName = buildAuthStorageFileName(parsed, file).fileName.replace(/\.json$/, '');
          files.push({
            file,
            full_path: fullPath,
            til_path: fullPath,
            email,
            auth_type,
            suggested_name: suggestedName,
            already_added: existingPaths.has(fullPath) || (!!email && existingEmails.has(email.toLowerCase())),
            duplicate_reason: existingPaths.has(fullPath)
              ? '已添加'
              : (email && existingEmails.has(email.toLowerCase()))
                ? '邮箱重复'
                : null,
          });
        } catch {
          files.push({ file, full_path: fullPath, error: '无法读取或解析' });
        }
      }

      return { files, dir };
    },

    async createAccount(body) {
      const id = crypto.randomUUID();
      const platform = body.platform || 'gpt';
      const providerMode = body.provider_mode === 'api' ? 'api' : 'oauth';
      const nextApiCliConfig = providerMode === 'api'
        ? validateApiCliConfigSnippet(body.api_cli_config || '')
        : sanitizeApiCliConfigSnippet(body.api_cli_config || '');

      if (providerMode === 'api') {
        await validateCodexApiConfig({
          account_id: body.account_id,
          email: body.email || '',
          api_base_url: body.api_base_url || '',
          api_key: body.api_key || '',
          api_model: body.api_model || '',
          api_cli_config: nextApiCliConfig,
        });
      }

      await pool.execute(
        `INSERT INTO accounts (
          id, account_id, email, auth_type, auth_file_path, provider_mode, api_base_url, api_key, api_model, api_cli_config, platform, status, is_current,
          last_login_at, total_tasks_completed, success_rate, session_start_at,
          total_session_seconds, requests_this_minute, tokens_used_percent,
          last_request_at, uptime_percent, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', FALSE, NOW(), 0, 100, NOW(), 0, 0, 0, NOW(), 100, NOW(), NOW())`,
        [
          id,
          body.account_id,
          body.email || '',
          body.auth_type,
          body.auth_file_path || '',
          providerMode,
          body.api_base_url || '',
          body.api_key || '',
          body.api_model || '',
          nextApiCliConfig,
          platform,
        ],
      );

      await createLog({ accountId: id, message: `Account ${body.account_id} added` });
      const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
      return mapAccount(rows[0]);
    },

    async getClaudeLocalConfig() {
      const settings = await readClaudeSettings();
      const matrixState = await readClaudeMatrixState();
      const snapshot = buildClaudeLocalAccountSnapshot({ settings, matrixState });
      const [rows] = await pool.execute(
        `SELECT * FROM accounts
         WHERE provider_mode = 'api' AND platform = 'claude'
           AND api_key = ? AND api_base_url = ? AND COALESCE(api_model, '') = ?
         ORDER BY updated_at DESC
         LIMIT 1`,
        [snapshot.api_key, snapshot.api_base_url, snapshot.api_model || ''],
      );

      return {
        ok: true,
        found: true,
        account_id: snapshot.account_id,
        email: snapshot.email || '',
        auth_type: snapshot.auth_type,
        api_base_url: snapshot.api_base_url,
        api_model: snapshot.api_model,
        platform: snapshot.platform,
        source_mode: snapshot.source_mode,
        source_account_id: snapshot.source_account_id,
        source_email: snapshot.source_email,
        already_added: rows.length > 0,
        existing_account: rows[0] ? mapAccount(rows[0]) : null,
      };
    },

    async importClaudeLocalConfig() {
      const settings = await readClaudeSettings();
      const matrixState = await readClaudeMatrixState();
      const snapshot = buildClaudeLocalAccountSnapshot({ settings, matrixState });

      await validateCodexApiConfig(snapshot);

      const [exactRows] = await pool.execute(
        `SELECT * FROM accounts
         WHERE provider_mode = 'api' AND platform = 'claude'
           AND api_key = ? AND api_base_url = ? AND COALESCE(api_model, '') = ?
         ORDER BY updated_at DESC
         LIMIT 1`,
        [snapshot.api_key, snapshot.api_base_url, snapshot.api_model || ''],
      );
      if (exactRows.length > 0) {
        const existing = exactRows[0];
        await pool.execute(
          `UPDATE accounts
           SET account_id = ?, email = ?, auth_type = ?, updated_at = NOW()
           WHERE id = ?`,
          [snapshot.account_id, snapshot.email || '', snapshot.auth_type, existing.id],
        );
        await createLog({ accountId: existing.id, message: '[Claude] 已识别为已导入的本机配置' });
        const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [existing.id]);
        return { imported: false, account: mapAccount(rows[0]) };
      }

      const [sameNameRows] = await pool.execute(
        `SELECT * FROM accounts
         WHERE provider_mode = 'api' AND platform = 'claude' AND account_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`,
        [snapshot.account_id],
      );
      if (sameNameRows.length > 0) {
        const existing = sameNameRows[0];
        await pool.execute(
          `UPDATE accounts
           SET email = ?, auth_type = ?, api_base_url = ?, api_key = ?, api_model = ?, api_cli_config = ?, updated_at = NOW()
           WHERE id = ?`,
          [
            snapshot.email || '',
            snapshot.auth_type,
            snapshot.api_base_url || '',
            snapshot.api_key,
            snapshot.api_model || '',
            snapshot.api_cli_config,
            existing.id,
          ],
        );
        await createLog({ accountId: existing.id, message: '[Claude] 已更新本机配置导入' });
        const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [existing.id]);
        return { imported: true, account: mapAccount(rows[0]) };
      }

      const account = await this.createAccount(snapshot);
      await createLog({ accountId: account.id, message: '[Claude] 已导入当前本机配置' });
      return { imported: true, account };
    },

    async updateApiCliConfig(id, api_cli_config) {
      const [targetRows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
      if (!targetRows.length) {
        const error = new Error('账号不存在');
        error.status = 404;
        throw error;
      }

      const account = targetRows[0];
      if (!isApiAccount(account)) {
        const error = new Error('仅 API 账号支持编辑 CLI 配置');
        error.status = 400;
        throw error;
      }

      const nextSnippet = validateApiCliConfigSnippet(api_cli_config || '');
      await validateCodexApiConfig({ ...account, api_cli_config: nextSnippet });
      await pool.execute('UPDATE accounts SET api_cli_config = ?, updated_at = NOW() WHERE id = ?', [nextSnippet, id]);

      if (account.is_current) {
        await activateApiProviderForCurrentMode({ ...account, api_cli_config: nextSnippet });
        await createLog({ accountId: id, message: '[API] 已同步更新 CLI 配置片段' });
      } else {
        await createLog({ accountId: id, message: '[API] 已更新 CLI 配置片段' });
      }

      const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
      return mapAccount(rows[0]);
    },

    async previewApiCliConfig(id, api_cli_config) {
      const [targetRows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
      if (!targetRows.length) {
        const error = new Error('账号不存在');
        error.status = 404;
        throw error;
      }

      const account = targetRows[0];
      if (!isApiAccount(account)) {
        const error = new Error('仅 API 账号支持预览 CLI 配置');
        error.status = 400;
        throw error;
      }

      const sanitized = validateApiCliConfigSnippet(api_cli_config || '');
      await validateCodexApiConfig({ ...account, api_cli_config: sanitized });
      return {
        ok: true,
        sanitized,
        preview: buildManagedCodexProviderBlock({ ...account, api_cli_config: sanitized }),
      };
    },

    async deleteAccount(id) {
      const [rows] = await pool.execute('SELECT id, account_id, is_current FROM accounts WHERE id = ?', [id]);
      if (!rows.length) {
        const error = new Error('账号不存在');
        error.status = 404;
        throw error;
      }

      if (rows[0].is_current) {
        const error = new Error('当前使用中的账号不允许删除，请先切换到别的账号');
        error.status = 400;
        throw error;
      }

      await pool.execute('DELETE FROM accounts WHERE id = ?', [id]);
      await createLog({ level: 'warn', message: `Account ${id} removed` });
    },

    async clearAllAccounts() {
      const [rows] = await pool.query('SELECT COUNT(*) AS count FROM accounts');
      const count = rows[0].count;
      await pool.query('DELETE FROM accounts');
      await createLog({ level: 'warn', message: `已清空全部 ${count} 个账号` });
    },

    async getAccountAuthInfo(id) {
      const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
      if (!rows.length) {
        const error = new Error('账号不存在');
        error.status = 404;
        throw error;
      }

      const account = rows[0];
      if (isApiAccount(account)) {
        return {
          email: account.email || null,
          plan_type: account.auth_type,
          token_expires_at: null,
          subscription_started_at: null,
          subscription_expires_at: null,
          subscription_last_checked_at: null,
          last_refresh: null,
          usage: null,
          provider_mode: 'api',
          api_base_url: account.api_base_url || null,
          api_model: account.api_model || null,
          api_cli_config: account.api_cli_config || null,
        };
      }

      const authFilePath = expandPath(account.auth_file_path);

      try {
        await fs.access(authFilePath);
      } catch {
        return { error: 'auth_file_not_found', path: account.auth_file_path };
      }

      let authData;
      try {
        authData = JSON.parse(await fs.readFile(authFilePath, 'utf8'));
      } catch {
        return { error: 'invalid_auth_file' };
      }

      const idToken = authData.tokens?.id_token;
      const accessToken = authData.tokens?.access_token;

      let email = null;
      let plan_type = null;
      let token_expires_at = null;
      let subscription_started_at = null;
      let subscription_expires_at = null;
      let subscription_last_checked_at = null;

      if (idToken) {
        const decoded = decodeJwtPayload(idToken);
        if (decoded) {
          email = decoded.email;
          const authClaims = decoded['https://api.openai.com/auth'] || {};
          plan_type = authClaims.chatgpt_plan_type ?? null;
          subscription_started_at = authClaims.chatgpt_subscription_active_start ?? null;
          subscription_expires_at = authClaims.chatgpt_subscription_active_until ?? null;
          subscription_last_checked_at = authClaims.chatgpt_subscription_last_checked ?? null;
        }
      }

      if (accessToken) {
        const decoded = decodeJwtPayload(accessToken);
        if (decoded?.exp) {
          token_expires_at = new Date(decoded.exp * 1000).toISOString();
          if (!email && decoded['https://api.openai.com/profile']?.email) {
            email = decoded['https://api.openai.com/profile'].email;
          }
          if (!plan_type && decoded['https://api.openai.com/auth']?.chatgpt_plan_type) {
            plan_type = decoded['https://api.openai.com/auth'].chatgpt_plan_type;
          }
        }
      }

      let usage = null;
      if (accessToken) {
        try {
          const resp = await requestJson('https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27', {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
            timeoutMs: 6000,
          });
          if (resp.ok) {
            const limits = resp.json?.account_plan?.is_paid_subscription_active !== undefined ? resp.json : null;
            if (limits) {
              usage = {
                plan: limits.account_plan?.plan_type,
                is_paid: limits.account_plan?.is_paid_subscription_active,
                message_cap: limits.message_cap ?? null,
                message_cap_rollover: limits.message_cap_rollover ?? null,
              };
            }
          }
        } catch {
          // Ignore remote usage lookup failures.
        }
      }

      return {
        email,
        plan_type,
        token_expires_at,
        subscription_started_at,
        subscription_expires_at,
        subscription_last_checked_at,
        last_refresh: authData.last_refresh ?? null,
        usage,
        provider_mode: 'oauth',
      };
    },
  };
}

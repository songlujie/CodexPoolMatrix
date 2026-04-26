export function createAccountRuntimeService({
  fs,
  pool,
  createLog,
  isApiAccount,
  getSelectedRuntimeMode,
  activateApiProviderForMode,
  activateOAuthProviderForMode,
  expandPath,
  decodeJwtPayload,
  setExpectedAccountId,
  reloadOpenClaw,
  requestJson,
  normalizeApiBaseUrl,
  buildRelayUrl,
}) {
  async function applyAccountToRuntime(nextAccount, runtimeMode) {
    if (isApiAccount(nextAccount)) {
      await activateApiProviderForMode(nextAccount, runtimeMode);
      await createLog({
        accountId: nextAccount.id,
        message: `[${runtimeMode === 'claude' ? 'Claude' : 'Codex'}] 已切换默认中转站至 ${nextAccount.account_id}`,
      });
      return;
    }

    await activateOAuthProviderForMode(nextAccount, runtimeMode);

    if (runtimeMode !== 'codex') {
      await createLog({
        accountId: nextAccount.id,
        level: 'warn',
        message: '[Claude] OAuth 账号目前不会自动导入 Claude CLI 登录态；这里只会清理 Matrix 接管的 API 环境变量。',
      });
      return;
    }

    try {
      const authFilePath = expandPath(nextAccount.auth_file_path);
      const authData = JSON.parse(await fs.readFile(authFilePath, 'utf8'));
      const payload = decodeJwtPayload(authData.tokens?.access_token);
      const accId = payload?.['https://api.openai.com/auth']?.chatgpt_account_id;
      if (accId) {
        setExpectedAccountId(accId);
      }
    } catch {
      // Ignore account-id detection failures.
    }

    const reloadResult = await reloadOpenClaw();
    if (reloadResult.ok) {
      await createLog({ accountId: nextAccount.id, message: `[OpenClaw] 已重载 (${reloadResult.method})` });
    } else {
      await createLog({ accountId: nextAccount.id, level: 'warn', message: `[OpenClaw] 重载失败: ${reloadResult.reason}` });
    }
  }

  async function performAccountSwitch(nextAccount, reason) {
    const runtimeMode = await getSelectedRuntimeMode();
    await applyAccountToRuntime(nextAccount, runtimeMode);

    await pool.execute(
      "UPDATE accounts SET is_current = FALSE, status = CASE WHEN status = 'active' THEN 'idle' ELSE status END, updated_at = NOW()",
    );
    await pool.execute("UPDATE accounts SET is_current = TRUE, status = 'active', updated_at = NOW() WHERE id = ?", [nextAccount.id]);
    await createLog({ accountId: nextAccount.id, message: reason });
  }

  async function syncRuntimeForAccount(account, reason) {
    const runtimeMode = await getSelectedRuntimeMode();
    await applyAccountToRuntime(account, runtimeMode);
    await createLog({ accountId: account.id, message: reason });
  }

  async function fetchUsageForApiAccount(account) {
    const baseUrl = normalizeApiBaseUrl(account.api_base_url);
    const apiKey = String(account.api_key || '').trim();

    if (!baseUrl) return { ok: false, error: 'api_base_url_missing' };
    if (!apiKey) return { ok: false, error: 'api_key_missing' };

    try {
      const resp = await requestJson(buildRelayUrl(baseUrl, 'models'), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        timeoutMs: 15000,
      });

      if (resp.status === 401 || resp.status === 403) {
        return { ok: false, error: 'token_invalid', status: resp.status };
      }
      if (!resp.ok) {
        return { ok: false, error: `http_${resp.status}`, status: resp.status };
      }

      const models = Array.isArray(resp.json?.data) ? resp.json.data : [];
      const modelAvailable = account.api_model
        ? models.some((model) => model?.id === account.api_model)
        : true;

      if (account.api_model && !modelAvailable) {
        return {
          ok: false,
          error: 'api_model_not_found',
          status: 404,
          provider: 'api',
          model_count: models.length,
        };
      }

      return {
        ok: true,
        plan_type: 'api',
        primary: null,
        secondary: null,
        provider: 'api',
        model_available: modelAvailable,
        model_count: models.length,
      };
    } catch (error) {
      const message = String(error?.message || 'unknown error');
      if (message.toLowerCase().includes('timeout')) {
        return { ok: false, error: '连接中转站超时，请检查代理或中转站地址' };
      }
      return { ok: false, error: `请求中转站失败: ${message}` };
    }
  }

  async function fetchUsageForAccount(account) {
    if (isApiAccount(account)) {
      return fetchUsageForApiAccount(account);
    }

    const authFilePath = expandPath(account.auth_file_path);
    try {
      await fs.access(authFilePath);
    } catch {
      return { ok: false, error: 'auth_file_not_found' };
    }

    let authData;
    try {
      authData = JSON.parse(await fs.readFile(authFilePath, 'utf8'));
    } catch {
      return { ok: false, error: 'invalid_auth_file' };
    }

    const accessToken = authData.tokens?.access_token;
    if (!accessToken) return { ok: false, error: 'no_access_token' };

    try {
      const resp = await requestJson('https://chatgpt.com/backend-api/wham/usage', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          Accept: 'application/json',
        },
        timeoutMs: 15000,
      });

      if (resp.status === 401) return { ok: false, error: 'token_invalid', status: 401 };
      if (!resp.ok) return { ok: false, error: `http_${resp.status}`, status: resp.status };

      const rl = resp.json?.rate_limit;
      if (!rl) return { ok: false, error: 'no_rate_limit_data' };

      const pw = rl.primary_window;
      const sw = rl.secondary_window;

      const primary = pw ? {
        used_percent: pw.used_percent ?? 0,
        window_minutes: Math.round((pw.limit_window_seconds ?? 18000) / 60),
        resets_at: pw.reset_at ? new Date(pw.reset_at * 1000).toISOString() : null,
      } : null;

      const secondary = sw ? {
        used_percent: sw.used_percent ?? 0,
        window_minutes: Math.round((sw.limit_window_seconds ?? 604800) / 60),
        resets_at: sw.reset_at ? new Date(sw.reset_at * 1000).toISOString() : null,
      } : null;

      if (rl.limit_reached) {
        return {
          ok: false,
          error: 'rate_limited',
          status: 429,
          primary_used: pw?.used_percent ?? 0,
          secondary_used: sw?.used_percent ?? 0,
          plan_type: resp.json?.plan_type ?? null,
          primary,
          secondary,
        };
      }

      return {
        ok: true,
        primary_used: pw?.used_percent ?? 0,
        secondary_used: sw?.used_percent ?? 0,
        plan_type: resp.json?.plan_type ?? null,
        primary,
        secondary,
      };
    } catch (err) {
      const errorName = err?.name || 'Error';
      const causeCode = err?.cause?.code || '';
      const causeMessage = err?.cause?.message || '';
      const lowerMessage = String(err?.message || '').toLowerCase();
      const lowerCause = String(causeMessage).toLowerCase();

      if (errorName === 'TimeoutError' || lowerMessage.includes('timeout')) {
        return { ok: false, error: '连接 chatgpt.com 超时，请检查网络或代理设置' };
      }
      if (causeCode === 'ENOTFOUND' || lowerCause.includes('getaddrinfo')) {
        return { ok: false, error: '无法解析 chatgpt.com，请检查 DNS 或代理设置' };
      }
      if (causeCode === 'ECONNREFUSED') {
        return { ok: false, error: '连接被拒绝，请检查网络或代理设置' };
      }
      if (causeCode === 'ECONNRESET') {
        return { ok: false, error: '连接被重置，请检查网络或代理设置' };
      }

      return {
        ok: false,
        error: `请求 chatgpt.com 失败: ${causeCode || causeMessage || err.message || 'unknown error'}`,
      };
    }
  }

  async function handleUsageCheck(id) {
    const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
    if (!rows.length) return { _status: 404, message: '账号不存在' };

    const account = rows[0];
    const usage = await fetchUsageForAccount(account);

    if (usage.error === 'rate_limited') {
      await pool.execute("UPDATE accounts SET status = 'rate_limited', updated_at = NOW() WHERE id = ?", [id]);
      await createLog({
        accountId: id,
        level: 'warn',
        message: `Codex 已限额 (5h=${usage.primary_used ?? '?'}% 周=${usage.secondary_used ?? '?'}%)`,
      });
      return {
        ok: false,
        rate_limited: true,
        status: 429,
        primary: usage.primary ?? null,
        secondary: usage.secondary ?? null,
        fetched_at: new Date().toISOString(),
      };
    }

    if (usage.error === 'token_invalid') {
      await pool.execute("UPDATE accounts SET status = 'error', updated_at = NOW() WHERE id = ?", [id]);
      await createLog({ accountId: id, level: 'error', message: 'Token 已失效 (401)' });
      return { ok: false, status: 401, error: 'token_invalid' };
    }

    if (!usage.ok) {
      await createLog({ accountId: id, level: 'error', message: `检测失败: ${usage.error}` });
      return { ok: false, error: usage.error };
    }

    if (usage.provider === 'api') {
      if (account.status === 'error' || account.status === 'rate_limited') {
        await pool.execute("UPDATE accounts SET status = 'idle', updated_at = NOW() WHERE id = ?", [id]);
      }
      await createLog({ accountId: id, message: `[API] 中转站连通正常${account.api_model ? ` (${account.api_model})` : ''}` });
      return {
        ok: true,
        status: 200,
        plan_type: account.auth_type,
        primary: null,
        secondary: null,
        fetched_at: new Date().toISOString(),
        provider: 'api',
        model_available: usage.model_available ?? true,
        model_count: usage.model_count ?? 0,
      };
    }

    const planType = usage.plan_type;
    const validTypes = ['team', 'plus', 'free'];
    if (planType && validTypes.includes(planType) && account.auth_type !== planType) {
      await pool.execute('UPDATE accounts SET auth_type = ?, updated_at = NOW() WHERE id = ?', [planType, id]);
    } else if (account.status === 'error' || account.status === 'rate_limited') {
      await pool.execute("UPDATE accounts SET status = 'idle', updated_at = NOW() WHERE id = ?", [id]);
    }
    await createLog({ accountId: id, message: `Codex 可用 (5h=${usage.primary_used}% 周=${usage.secondary_used}%)` });
    return {
      ok: true,
      status: 200,
      primary: usage.primary,
      secondary: usage.secondary,
      plan_type: usage.plan_type,
      fetched_at: new Date().toISOString(),
    };
  }

  async function updateAccountAction(id, action) {
    if (action === 'setActive') {
      const [targetRows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
      if (targetRows.length === 0) {
        const error = new Error('账号不存在');
        error.status = 404;
        throw error;
      }

      const targetAccount = targetRows[0];
      await performAccountSwitch(targetAccount, `手动切换至 ${targetAccount.account_id}`);
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
      const error = new Error('Unsupported action');
      error.status = 400;
      throw error;
    }

    const [rows] = await pool.execute('SELECT * FROM accounts WHERE id = ?', [id]);
    return rows[0];
  }

  return {
    syncRuntimeForAccount,
    performAccountSwitch,
    fetchUsageForAccount,
    handleUsageCheck,
    updateAccountAction,
  };
}

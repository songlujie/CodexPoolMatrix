export function createCodexReadService({
  fs,
  pool,
  mapAccount,
  getSelectedRuntimeMode,
  readCodexMatrixState,
  readCodexConfigText,
  detectCodexManagedProvider,
  readClaudeMatrixState,
  readClaudeSettings,
  normalizeClaudeBaseUrl,
  getAuthIdentity,
  codePaths,
  isApiAccount,
}) {
  const {
    authPath,
    configPath,
    claudeSettingsPath,
  } = codePaths;

  function getClaudeEnv(settings) {
    return settings?.env && typeof settings.env === 'object' && !Array.isArray(settings.env)
      ? settings.env
      : {};
  }

  return {
    async getCurrentAuth() {
      const runtimeMode = await getSelectedRuntimeMode();
      if (runtimeMode === 'claude') {
        const matrixState = await readClaudeMatrixState();
        const settings = await readClaudeSettings();
        const env = getClaudeEnv(settings);
        const apiKey = String(env.ANTHROPIC_AUTH_TOKEN || '').trim();
        const apiBaseUrl = normalizeClaudeBaseUrl(env.ANTHROPIC_BASE_URL || '');
        const apiModel = String(env.ANTHROPIC_MODEL || '').trim() || null;

        if (matrixState?.mode === 'oauth') {
          return {
            found: false,
            provider_mode: 'oauth',
            error: 'claude_oauth_not_supported',
            path: claudeSettingsPath,
            email: matrixState.email || null,
            account_id: matrixState.account_id || null,
            plan_type: null,
            token_expires_at: null,
            api_base_url: apiBaseUrl || null,
            api_model: apiModel,
          };
        }

        if (!apiKey && matrixState?.mode !== 'api') {
          return { found: false, error: 'auth_file_not_found', path: claudeSettingsPath };
        }

        return {
          found: true,
          provider_mode: 'api',
          path: claudeSettingsPath,
          email: matrixState?.email || null,
          account_id: matrixState?.account_id || 'ANTHROPIC_AUTH_TOKEN',
          plan_type: null,
          token_expires_at: null,
          api_base_url: apiBaseUrl || matrixState?.api_base_url || null,
          api_model: apiModel || matrixState?.api_model || null,
        };
      }

      const matrixState = await readCodexMatrixState();
      if (matrixState?.mode === 'api') {
        return {
          found: true,
          provider_mode: 'api',
          path: configPath,
          email: matrixState.email || null,
          account_id: matrixState.account_id || null,
          plan_type: null,
          token_expires_at: null,
          api_base_url: matrixState.api_base_url || null,
          api_model: matrixState.api_model || null,
          api_cli_config: matrixState.api_cli_config || null,
        };
      }

      try {
        await fs.access(authPath);
      } catch {
        return { found: false, error: 'auth_file_not_found', path: authPath };
      }

      let authData;
      try {
        authData = JSON.parse(await fs.readFile(authPath, 'utf8'));
      } catch {
        return { found: false, error: 'invalid_auth_file', path: authPath };
      }

      if (authData?.OPENAI_API_KEY && !authData?.tokens?.access_token) {
        return {
          found: true,
          provider_mode: 'api',
          path: authPath,
          email: null,
          account_id: 'OPENAI_API_KEY',
          plan_type: null,
          token_expires_at: null,
          api_base_url: null,
          api_model: null,
          api_cli_config: null,
        };
      }

      const identity = getAuthIdentity(authData);
      const authClaims = identity.payload?.['https://api.openai.com/auth'] || {};

      return {
        found: true,
        provider_mode: 'oauth',
        path: authPath,
        email: identity.email || null,
        account_id: identity.accountId || null,
        plan_type: authClaims.chatgpt_plan_type || null,
        token_expires_at: identity.payload?.exp ? new Date(identity.payload.exp * 1000).toISOString() : null,
      };
    },

    async getManagedStatus() {
      const runtimeMode = await getSelectedRuntimeMode();
      const [currentRows] = await pool.query("SELECT * FROM accounts WHERE is_current = TRUE LIMIT 1");
      const currentAccount = currentRows[0] ? mapAccount(currentRows[0]) : null;

      if (runtimeMode === 'claude') {
        const matrixState = await readClaudeMatrixState();
        const settings = await readClaudeSettings();
        const env = getClaudeEnv(settings);
        const apiKey = String(env.ANTHROPIC_AUTH_TOKEN || '').trim();
        const apiBaseUrl = normalizeClaudeBaseUrl(env.ANTHROPIC_BASE_URL || '');
        const apiModel = String(env.ANTHROPIC_MODEL || '').trim() || null;
        const managed = matrixState?.mode === 'api'
          ? Boolean(
            apiKey &&
            (!matrixState.api_base_url || apiBaseUrl === normalizeClaudeBaseUrl(matrixState.api_base_url)) &&
            (!matrixState.api_model || apiModel === matrixState.api_model),
          )
          : matrixState?.mode === 'oauth';

        return {
          ok: true,
          runtime_mode: 'claude',
          current_account_id: currentAccount?.account_id || null,
          current_provider_mode: currentAccount?.provider_mode || null,
          cli_managed: Boolean(managed),
          cli_provider: matrixState?.mode === 'api' ? 'claude-settings-env' : null,
          cli_model: apiModel || matrixState?.api_model || null,
          matrix_state_mode: matrixState?.mode || null,
          matrix_state_account_id: matrixState?.account_id || null,
          expected_account_id: isApiAccount(currentAccount) ? currentAccount.account_id : null,
          config_path: claudeSettingsPath,
        };
      }

      const matrixState = await readCodexMatrixState();
      const configText = await readCodexConfigText();
      const detected = detectCodexManagedProvider(configText);

      return {
        ok: true,
        runtime_mode: 'codex',
        current_account_id: currentAccount?.account_id || null,
        current_provider_mode: currentAccount?.provider_mode || null,
        cli_managed: detected.managed,
        cli_provider: detected.provider,
        cli_model: detected.model,
        matrix_state_mode: matrixState?.mode || null,
        matrix_state_account_id: matrixState?.account_id || null,
        expected_account_id: isApiAccount(currentAccount) ? currentAccount.account_id : null,
        config_path: configPath,
      };
    },
  };
}

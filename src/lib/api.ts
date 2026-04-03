import { Account, LogEntry, PoolSettings, Task } from '@/types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const isDesktopRuntime = typeof window !== 'undefined' && Boolean(window.codexPoolDesktop?.isElectron);

async function desktopRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await window.codexPoolDesktop!.request({
    path,
    method: init?.method || 'GET',
    headers: init?.headers,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  });

  if (!response.ok) {
    const payload = response.data && typeof response.data === 'object'
      ? response.data
      : { message: typeof response.data === 'string' ? response.data : 'Request failed' };
    throw new Error(payload.message || 'Request failed');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.data as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (isDesktopRuntime) {
    return desktopRequest<T>(path, init);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(payload.message || 'Request failed');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const api = {
  listAccounts: () => request<Account[]>('/api/accounts'),
  createAccount: (payload: Pick<Account, 'account_id' | 'email' | 'auth_type' | 'auth_file_path'> & {
    platform?: string;
    provider_mode?: 'oauth' | 'api';
    api_base_url?: string;
    api_key?: string;
    api_model?: string;
    api_cli_config?: string;
  }) => request<Account>('/api/accounts', { method: 'POST', body: JSON.stringify(payload) }),
  updateAccountAction: (id: string, action: 'setActive' | 'pause' | 'reset') => request<Account>(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) }),
  updateApiCliConfig: (id: string, api_cli_config: string) => request<Account>(`/api/accounts/${id}/api-cli-config`, {
    method: 'PUT',
    body: JSON.stringify({ api_cli_config }),
  }),
  previewApiCliConfig: (id: string, api_cli_config: string) => request<{
    ok: boolean;
    sanitized: string;
    preview: string;
  }>(`/api/accounts/${id}/api-cli-config/preview`, {
    method: 'POST',
    body: JSON.stringify({ api_cli_config }),
  }),
  deleteAccount: (id: string) => request<void>(`/api/accounts/${id}`, { method: 'DELETE' }),
  clearAllAccounts: () => request<void>('/api/accounts', { method: 'DELETE' }),
  checkAccountUsage: (id: string) => request<{
    ok: boolean;
    status?: number;
    rate_limited?: boolean;
    retry_after?: string | null;
    error?: string;
    fetched_at?: string;
    plan_type?: string | null;
    provider?: 'api';
    model_available?: boolean;
    model_count?: number;
    primary?: { used_percent: number; window_minutes: number; resets_at: string | null } | null;
    secondary?: { used_percent: number; window_minutes: number; resets_at: string | null } | null;
    rate_limit?: {
      limit_requests?: string | null;
      remaining_requests?: string | null;
      reset_requests?: string | null;
      limit_tokens?: string | null;
      remaining_tokens?: string | null;
    } | null;
  }>(`/api/accounts/${id}/check-usage`, { method: 'POST' }),
  getAccountAuthInfo: (id: string) => request<{
    email?: string;
    plan_type?: string;
    token_expires_at?: string;
    subscription_started_at?: string;
    subscription_expires_at?: string;
    subscription_last_checked_at?: string;
    last_refresh?: string;
    usage?: {
      plan?: string;
      is_paid?: boolean;
      message_cap?: number | null;
      message_cap_rollover?: string | null;
    } | null;
    provider_mode?: 'oauth' | 'api';
    api_base_url?: string | null;
    api_model?: string | null;
    api_cli_config?: string | null;
    error?: string;
    path?: string;
  }>(`/api/accounts/${id}/auth-info`),
  getCurrentCodexAuth: () => request<{
    found: boolean;
    provider_mode?: 'oauth' | 'api';
    error?: string;
    path?: string;
    email?: string | null;
    account_id?: string | null;
    plan_type?: string | null;
    token_expires_at?: string | null;
    api_base_url?: string | null;
    api_model?: string | null;
    api_cli_config?: string | null;
  }>('/api/codex/current-auth'),
  getCodexManagedStatus: () => request<{
    ok: boolean;
    runtime_mode?: 'codex' | 'claude' | null;
    current_account_id?: string | null;
    current_provider_mode?: 'oauth' | 'api' | null;
    cli_managed?: boolean;
    cli_provider?: string | null;
    cli_model?: string | null;
    matrix_state_mode?: 'api' | 'oauth' | null;
    matrix_state_account_id?: string | null;
    expected_account_id?: string | null;
    config_path?: string | null;
  }>('/api/codex/managed-status'),
  listTasks: () => request<Task[]>('/api/tasks'),
  createTask: (payload: { description: string; priority: Task['priority']; account: string }) => request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  batchRetryTasks: (ids: string[]) => request<{ updated: number }>('/api/tasks/batch-retry', { method: 'POST', body: JSON.stringify({ ids }) }),
  batchCancelTasks: (ids: string[]) => request<{ deleted: number }>('/api/tasks/batch-cancel', { method: 'POST', body: JSON.stringify({ ids }) }),
  listLogs: (params?: { level?: string; account?: string; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.level) search.set('level', params.level);
    if (params?.account) search.set('account', params.account);
    if (params?.limit) search.set('limit', String(params.limit));
    const suffix = search.toString() ? `?${search.toString()}` : '';
    return request<LogEntry[]>(`/api/logs${suffix}`);
  },
  clearLogs: () => request<void>('/api/logs', { method: 'DELETE' }),
  getSettings: () => request<PoolSettings>('/api/settings'),
  updateSettings: (payload: PoolSettings) => request<PoolSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  rotateNow: () => request<Account>('/api/actions/rotate', { method: 'POST' }),
  pauseAll: () => request<void>('/api/actions/pause-all', { method: 'POST' }),
  healthCheck: () => request<{ ok: boolean; totalAccounts: number }>('/api/actions/health-check', { method: 'POST' }),
  restartOpenClaw: () => request<{ ok: boolean; method?: string; reason?: string; note?: string }>('/api/actions/restart-openclaw', { method: 'POST' }),
  refreshCodexUsage: (id: string) => request<{
    ok: boolean;
    error?: string;
    fetched_at?: string;
    plan_type?: string | null;
    primary?: { used_percent: number; window_minutes: number; resets_at: string | null } | null;
    secondary?: { used_percent: number; window_minutes: number; resets_at: string | null } | null;
  }>(`/api/accounts/${id}/refresh-codex-usage`, { method: 'POST' }),
  refreshToken: (id: string) => request<{ ok: boolean; newExpiresAt?: string; reason?: string }>(`/api/accounts/${id}/refresh-token`, { method: 'POST' }),
  scanDir: (dir?: string) => request<{
    files: Array<{
      file: string;
      full_path: string;
      til_path: string;
      email?: string;
      auth_type?: string;
      suggested_name?: string;
      already_added?: boolean;
      error?: string;
    }>;
    dir: string;
    error?: string;
  }>(`/api/accounts/scan-dir${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`),
  refreshAllTokens: () => request<{ ok: boolean; total: number; success: number; results: Array<{ id: string; account_id: string; ok: boolean; reason?: string; newExpiresAt?: string }> }>('/api/actions/refresh-all-tokens', { method: 'POST' }),
  startCodexLogin: () => request<{ ok: boolean }>('/api/auth/codex-login', { method: 'POST' }),
  getCodexLoginStatus: () => request<{
    status: 'idle' | 'running' | 'success' | 'error';
    message: string;
    output: string;
    newFile: string | null;
    error: string | null;
  }>('/api/auth/codex-login/status'),
  cancelCodexLogin: () => request<{ ok: boolean }>('/api/auth/codex-login', { method: 'DELETE' }),
  listPlatforms: () => request<string[]>('/api/platforms'),
  addPlatform: (name: string) => request<string[]>('/api/platforms', { method: 'POST', body: JSON.stringify({ name }) }),
  deletePlatform: (name: string) => request<string[]>(`/api/platforms/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  getCodexUsage: () => request<{
    found: boolean;
    reason?: string;
    recorded_at?: string;
    primary?: { used_percent: number; window_minutes: number; resets_at: string | null } | null;
    secondary?: { used_percent: number; window_minutes: number; resets_at: string | null } | null;
    token_usage?: { input_tokens: number; output_tokens: number; total_tokens: number } | null;
  }>('/api/codex-usage'),
};

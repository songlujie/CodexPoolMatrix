export type AccountStatus = 'active' | 'idle' | 'error' | 'rate_limited' | 'cooldown';

export interface LiveUsageData {
  ok: boolean;
  error?: string;
  fetched_at?: string;
  plan_type?: string | null;
  primary?: { used_percent: number; window_minutes: number; resets_at: string | null } | null;
  secondary?: { used_percent: number; window_minutes: number; resets_at: string | null } | null;
}
export type AccountType = 'team' | 'plus' | 'free';
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'retrying';
export type LogLevel = 'info' | 'warn' | 'error';
export type PoolStrategy = 'round_robin' | 'least_used' | 'random' | 'priority_based';
export type Priority = 'low' | 'medium' | 'high';

export interface Account {
  id: string;
  account_id: string;
  email: string;
  auth_type: AccountType;
  auth_file_path: string;
  platform: string;
  status: AccountStatus;
  is_current: boolean;
  last_login_at: string;
  total_tasks_completed: number;
  success_rate: number;
  session_start_at: string;
  total_session_seconds: number;
  requests_this_minute: number;
  tokens_used_percent: number;
  last_request_at: string;
  uptime_percent: number;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  description: string;
  assigned_account_id: string | null;
  assigned_account_name?: string;
  status: TaskStatus;
  priority: Priority;
  result: string | null;
  error_message: string | null;
  retry_count: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface LogEntry {
  id: string;
  account_id: string | null;
  account_name?: string;
  level: LogLevel;
  message: string;
  created_at: string;
}

export interface PoolSettings {
  strategy: PoolStrategy;
  auto_rotation: boolean;
  rest_after_tasks: number;
  cooldown_minutes: number;
  rate_limit_buffer: number;
  max_concurrent_tasks: number;
  global_rate_limit: number;
  auto_retry: boolean;
  max_retries: number;
  task_timeout_minutes: number;
  auto_dispatch: boolean;
  openclaw_endpoint: string;
  openclaw_api_key: string;
  codex_path: string;
  trae_path: string;
  mode: 'codex' | 'trae';
  auto_launch: boolean;
  auto_token_refresh: boolean;
  token_refresh_interval_hours: number;
}

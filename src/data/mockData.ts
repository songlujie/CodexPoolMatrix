import { Account, Task, LogEntry, PoolSettings } from '@/types';

const names = ['a26','a62','a03','JERRY','b14','c88','d42','e99','f17','g05','h33','i71','j49','k22','l08','m56','n90','o64','p37','q11'];
const emails = names.map(n => `${n.toLowerCase()}@codex.team`);
const statuses: Account['status'][] = ['active','idle','idle','error','active','idle','rate_limited','cooldown','idle','active','idle','idle','error','idle','active','idle','idle','rate_limited','idle','idle'];
const types: Account['auth_type'][] = ['team','team','plus','free','team','team','plus','team','free','team','team','plus','team','team','free','team','team','team','plus','team'];

function hoursAgo(h: number) {
  return new Date(Date.now() - h * 3600000).toISOString();
}
function minsAgo(m: number) {
  return new Date(Date.now() - m * 60000).toISOString();
}

export const mockAccounts: Account[] = names.map((name, i) => ({
  id: crypto.randomUUID(),
  account_id: name,
  email: emails[i],
  auth_type: types[i],
  auth_file_path: `~/.codex/auth/${name.toLowerCase()}.json`,
  status: statuses[i],
  is_current: i === 0,
  last_login_at: hoursAgo(Math.floor(Math.random() * 48)),
  total_tasks_completed: Math.floor(Math.random() * 500) + 10,
  success_rate: Math.round((85 + Math.random() * 15) * 10) / 10,
  session_start_at: hoursAgo(Math.floor(Math.random() * 12)),
  total_session_seconds: Math.floor(Math.random() * 36000) + 1800,
  requests_this_minute: Math.floor(Math.random() * 30),
  tokens_used_percent: Math.round(Math.random() * 100),
  last_request_at: minsAgo(Math.floor(Math.random() * 10)),
  uptime_percent: Math.round((60 + Math.random() * 40) * 10) / 10,
  created_at: hoursAgo(Math.floor(Math.random() * 720)),
  updated_at: minsAgo(Math.floor(Math.random() * 60)),
}));

const taskDescs = [
  'Refactor auth module','Fix rate limiter','Deploy staging build','Run test suite','Update API docs',
  'Migrate database schema','Optimize query performance','Lint codebase','Generate API keys','Sync upstream',
  'Patch security vulnerability','Update dependencies','Build Docker image','Run integration tests','Compile assets',
];
const taskStatuses: Task['status'][] = ['completed','running','queued','failed','completed','running','queued','retrying','completed','completed','queued','running','completed','failed','queued'];

export const mockTasks: Task[] = taskDescs.map((desc, i) => {
  const acc = mockAccounts[i % mockAccounts.length];
  return {
    id: crypto.randomUUID(),
    description: desc,
    assigned_account_id: acc.id,
    assigned_account_name: acc.account_id,
    status: taskStatuses[i],
    priority: (['low','medium','high'] as const)[i % 3],
    result: taskStatuses[i] === 'completed' ? 'Success' : null,
    error_message: taskStatuses[i] === 'failed' ? 'Timeout exceeded' : null,
    retry_count: taskStatuses[i] === 'retrying' ? 2 : 0,
    created_at: minsAgo(Math.floor(Math.random() * 120)),
    started_at: ['running','completed','failed','retrying'].includes(taskStatuses[i]) ? minsAgo(Math.floor(Math.random() * 60)) : null,
    completed_at: taskStatuses[i] === 'completed' ? minsAgo(Math.floor(Math.random() * 10)) : null,
  };
});

const logMessages = [
  { level: 'info' as const, msg: 'Account rotated successfully' },
  { level: 'info' as const, msg: 'Task dispatched to pool' },
  { level: 'warn' as const, msg: 'Rate limit threshold at 80%' },
  { level: 'error' as const, msg: 'Authentication failed - token expired' },
  { level: 'info' as const, msg: 'Health check passed' },
  { level: 'warn' as const, msg: 'Cooldown period initiated' },
  { level: 'error' as const, msg: 'Connection timeout after 30s' },
  { level: 'info' as const, msg: 'Pool rebalanced' },
  { level: 'info' as const, msg: 'Session renewed' },
  { level: 'warn' as const, msg: 'High memory usage detected' },
];

export const mockLogs: LogEntry[] = Array.from({ length: 50 }, (_, i) => {
  const log = logMessages[i % logMessages.length];
  const acc = mockAccounts[i % mockAccounts.length];
  return {
    id: crypto.randomUUID(),
    account_id: acc.id,
    account_name: acc.account_id,
    level: log.level,
    message: log.msg,
    created_at: minsAgo(i * 3),
  };
});

export const defaultSettings: PoolSettings = {
  strategy: 'round_robin',
  auto_rotation: true,
  rest_after_tasks: 50,
  cooldown_minutes: 15,
  rate_limit_buffer: 20,
  max_concurrent_tasks: 3,
  global_rate_limit: 60,
  auto_retry: true,
  max_retries: 3,
  task_timeout_minutes: 10,
  auto_dispatch: true,
  openclaw_endpoint: 'https://api.openclaw.io/v1',
  openclaw_api_key: '',
  codex_path: '',
  trae_path: '',
  mode: 'codex',
  auto_launch: false,
};

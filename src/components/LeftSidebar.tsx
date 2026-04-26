import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ClipboardList, Cpu, LayoutDashboard, Settings, ScrollText, User } from 'lucide-react';
import { Account, LogEntry } from '@/types';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { useI18n } from '@/lib/i18n';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface LeftSidebarProps {
  currentAccount: Account | undefined;
  accounts: Account[];
  recentLogs: LogEntry[];
  cliAuth?: {
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
  } | null;
  cliManagedStatus?: {
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
  } | null;
}

export function LeftSidebar({ currentAccount, accounts, recentLogs, cliAuth, cliManagedStatus }: LeftSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, dateLocale } = useI18n();
  const tasksQuery = useQuery({
    queryKey: ['tasks'],
    queryFn: api.listTasks,
    staleTime: 5_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
  const pendingTaskCount = useMemo(
    () => (tasksQuery.data || []).filter((task) => task.status === 'queued' || task.status === 'running' || task.status === 'retrying').length,
    [tasksQuery.data],
  );
  type NavItem = {
    label: string;
    path: string;
    icon: typeof LayoutDashboard;
    badge?: string;
  };
  const activeProviderLabel = currentAccount?.provider_mode === 'api'
    ? t('sidebar.provider.api')
    : t('sidebar.provider.oauth');
  const claudeOauthLimited = cliManagedStatus?.runtime_mode === 'claude'
    && ((currentAccount?.provider_mode && currentAccount.provider_mode !== 'api') || cliAuth?.error === 'claude_oauth_not_supported');

  const primaryNavItems: NavItem[] = [
    { label: t('nav.dashboard'), path: '/', icon: LayoutDashboard },
    { label: t('nav.modelCalls'), path: '/model-calls', icon: Cpu },
    { label: t('nav.settings'), path: '/settings', icon: Settings },
    { label: t('nav.logs'), path: '/logs', icon: ScrollText },
  ];
  const secondaryNavItems: NavItem[] = [
    { label: t('nav.tasks'), path: '/tasks', icon: ClipboardList, badge: pendingTaskCount > 0 ? String(pendingTaskCount) : t('tasks.experimental') },
  ];

  return (
    <aside className="w-[240px] shrink-0 border-r border-border/50 bg-background/50 backdrop-blur-md flex flex-col overflow-y-auto">
      {/* 当前活跃账号 */}
      {currentAccount ? (
        <div className="p-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <User className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-foreground truncate">{currentAccount.account_id}</span>
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-dot shrink-0" />
              </div>
              <p className="text-[11px] text-muted-foreground truncate">{currentAccount.email}</p>
              <p className="text-[10px] text-muted-foreground capitalize">{activeProviderLabel} · {t('sidebar.currentActive')}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 border-b border-border/50">
          <p className="text-xs text-muted-foreground">{t('sidebar.noActive')}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{t('sidebar.noActiveHint')}</p>
        </div>
      )}

      <div className="p-4 border-b border-border/50">
        <h3 className="text-[11px] font-medium text-muted-foreground mb-2">
          {cliAuth?.provider_mode === 'api'
            ? t('sidebar.cliApiCurrent')
            : currentAccount?.provider_mode === 'api'
              ? t('sidebar.cliOauthCurrent')
              : t('sidebar.cliCurrent')}
        </h3>
        {cliAuth?.found ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground truncate">{cliAuth.email || cliAuth.account_id || t('common.none')}</p>
            <p className="text-[11px] text-muted-foreground truncate">{cliAuth.account_id || t('common.none')}</p>
            <p className="text-[10px] text-muted-foreground capitalize">
              {cliAuth.provider_mode === 'api' ? t('sidebar.provider.api') : (cliAuth.plan_type || t('common.none'))}
            </p>
            {cliAuth.provider_mode === 'api' && (
              <>
                <p className="text-[10px] text-muted-foreground truncate">{t('sidebar.cliModel')}：{cliAuth.api_model || t('common.none')}</p>
                <p className="text-[10px] text-muted-foreground break-all">{t('sidebar.cliBaseUrl')}：{cliAuth.api_base_url || t('common.none')}</p>
                <p className={`text-[10px] ${cliManagedStatus?.cli_managed ? 'text-primary' : 'text-destructive'}`}>
                  {cliManagedStatus?.cli_managed ? t('sidebar.cliManagedOk') : t('sidebar.cliManagedMismatch')}
                </p>
              </>
            )}
            {currentAccount?.provider_mode === 'api' && cliAuth.provider_mode !== 'api' && (
              <p className="text-[10px] text-muted-foreground">{t('sidebar.cliUnaffectedByApi')}</p>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t('sidebar.cliNoAuth')}</p>
            {cliAuth?.path && (
              <p className="text-[10px] text-muted-foreground break-all">{t('sidebar.cliPath')}：{cliAuth.path}</p>
            )}
          </div>
        )}
        {claudeOauthLimited ? (
          <div className="mt-3 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2">
            <p className="text-[11px] font-medium text-warning">{t('sidebar.claudeOauthLimitedTitle')}</p>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{t('sidebar.claudeOauthLimitedHint')}</p>
          </div>
        ) : null}
      </div>

      {/* 导航 */}
      <nav className="p-2 border-b border-border/50">
        {primaryNavItems.map((item) => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              }`}
            >
              <item.icon className="h-4 w-4" />
              <span className="truncate">{item.label}</span>
              {item.badge ? (
                <Badge variant="outline" className="ml-auto h-5 rounded-full px-1.5 text-[9px] font-normal">
                  {item.badge}
                </Badge>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="p-2 border-b border-border/50">
        <p className="px-3 pb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {t('sidebar.experimentalSection')}
        </p>
        {secondaryNavItems.map((item) => {
          const active = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              }`}
            >
              <item.icon className="h-4 w-4" />
              <span className="truncate">{item.label}</span>
              {item.badge ? (
                <Badge variant="outline" className="ml-auto h-5 rounded-full px-1.5 text-[9px] font-normal">
                  {item.badge}
                </Badge>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* 最近操作日志 */}
      <div className="p-4 flex-1 min-h-0">
        <h3 className="text-xs font-medium text-muted-foreground mb-3">{t('sidebar.recentOps')}</h3>
        <div className="space-y-2.5">
          {recentLogs.slice(0, 6).map((log) => (
            <button
              key={log.id}
              type="button"
              onClick={() => navigate(`/logs?account=${encodeURIComponent(log.account_name || 'all')}`)}
              className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-secondary/35"
            >
              <span className={`mt-0.5 h-1.5 w-1.5 rounded-full shrink-0 ${
                log.level === 'error' ? 'bg-destructive' : log.level === 'warn' ? 'bg-warning' : 'bg-muted-foreground'
              }`} />
              <div className="min-w-0">
                <p className="text-foreground/80 truncate">{log.message}</p>
                <p className="text-muted-foreground">{formatDistanceToNow(new Date(log.created_at), { addSuffix: true, locale: dateLocale })}</p>
              </div>
            </button>
          ))}
          {recentLogs.length === 0 && (
            <p className="text-[11px] text-muted-foreground">{t('sidebar.noLogs')}</p>
          )}
        </div>
      </div>
    </aside>
  );
}

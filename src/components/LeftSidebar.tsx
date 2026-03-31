import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Settings, ScrollText, User } from 'lucide-react';
import { Account, LogEntry } from '@/types';
import { formatDistanceToNow } from 'date-fns';
import { useI18n } from '@/lib/i18n';

interface LeftSidebarProps {
  currentAccount: Account | undefined;
  accounts: Account[];
  recentLogs: LogEntry[];
}

export function LeftSidebar({ currentAccount, accounts, recentLogs }: LeftSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, dateLocale } = useI18n();

  const navItems = [
    { label: t('nav.dashboard'), path: '/', icon: LayoutDashboard },
    { label: t('nav.settings'), path: '/settings', icon: Settings },
    { label: t('nav.logs'), path: '/logs', icon: ScrollText },
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
              <p className="text-[10px] text-muted-foreground capitalize">{currentAccount.auth_type} · {t('sidebar.currentActive')}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 border-b border-border/50">
          <p className="text-xs text-muted-foreground">{t('sidebar.noActive')}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{t('sidebar.noActiveHint')}</p>
        </div>
      )}

      {/* 导航 */}
      <nav className="p-2 border-b border-border/50">
        {navItems.map((item) => {
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
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* 最近操作日志 */}
      <div className="p-4 flex-1 min-h-0">
        <h3 className="text-xs font-medium text-muted-foreground mb-3">{t('sidebar.recentOps')}</h3>
        <div className="space-y-2.5">
          {recentLogs.slice(0, 6).map((log) => (
            <div key={log.id} className="flex items-start gap-2 text-[11px]">
              <span className={`mt-0.5 h-1.5 w-1.5 rounded-full shrink-0 ${
                log.level === 'error' ? 'bg-destructive' : log.level === 'warn' ? 'bg-warning' : 'bg-muted-foreground'
              }`} />
              <div className="min-w-0">
                <p className="text-foreground/80 truncate">{log.message}</p>
                <p className="text-muted-foreground">{formatDistanceToNow(new Date(log.created_at), { addSuffix: true, locale: dateLocale })}</p>
              </div>
            </div>
          ))}
          {recentLogs.length === 0 && (
            <p className="text-[11px] text-muted-foreground">{t('sidebar.noLogs')}</p>
          )}
        </div>
      </div>
    </aside>
  );
}

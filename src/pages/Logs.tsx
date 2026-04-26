import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LogLevel } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Download, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatAppError } from '@/lib/errors';
import { useI18n } from '@/lib/i18n';
import { useAppShell } from '@/components/app-shell-context';
import { useSidebarLogsQuery } from '@/hooks/runtime-shell-queries';

const levelColors: Record<LogLevel, string> = {
  info: 'text-muted-foreground',
  warn: 'text-warning',
  error: 'text-destructive',
};

const LOG_FETCH_LIMIT_OPTIONS = [100, 200, 500, 1000] as const;
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const LOGS_PAGE_STATE_KEY = 'cpm-logs-page-state';

interface PersistedLogsPageState {
  levelFilter: LogLevel | 'all';
  accountFilter: string;
  fetchLimit: string;
  pageSize: string;
  autoScroll: boolean;
  searchQuery: string;
}

function readPersistedLogsPageState(): PersistedLogsPageState | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(LOGS_PAGE_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedLogsPageState>;
    return {
      levelFilter: parsed.levelFilter === 'info' || parsed.levelFilter === 'warn' || parsed.levelFilter === 'error' ? parsed.levelFilter : 'all',
      accountFilter: typeof parsed.accountFilter === 'string' ? parsed.accountFilter : 'all',
      fetchLimit: typeof parsed.fetchLimit === 'string' ? parsed.fetchLimit : '200',
      pageSize: typeof parsed.pageSize === 'string' ? parsed.pageSize : '50',
      autoScroll: typeof parsed.autoScroll === 'boolean' ? parsed.autoScroll : true,
      searchQuery: typeof parsed.searchQuery === 'string' ? parsed.searchQuery : '',
    };
  } catch {
    return null;
  }
}

const LogsPage = () => {
  const [persistedState] = useState<PersistedLogsPageState | null>(() => readPersistedLogsPageState());
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>(persistedState?.levelFilter ?? 'all');
  const [accountFilter, setAccountFilter] = useState<string>(persistedState?.accountFilter ?? 'all');
  const [fetchLimit, setFetchLimit] = useState(persistedState?.fetchLimit ?? '200');
  const [pageSize, setPageSize] = useState(persistedState?.pageSize ?? '50');
  const [page, setPage] = useState(1);
  const [autoScroll, setAutoScroll] = useState(persistedState?.autoScroll ?? true);
  const [searchQuery, setSearchQuery] = useState(persistedState?.searchQuery ?? '');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const shell = useAppShell();
  const logsQuery = useSidebarLogsQuery({
    level: levelFilter,
    account: accountFilter,
    limit: Number(fetchLimit),
  });
  const logs = logsQuery.data || [];
  const accounts = shell.accounts;
  const filteredLogs = logs.filter((log) => {
    if (!searchQuery.trim()) return true;
    const search = searchQuery.toLowerCase();
    return [
      log.account_name || '',
      log.account_id || '',
      log.level,
      log.message,
    ].some((value) => value.toLowerCase().includes(search));
  });
  const numericPageSize = Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / numericPageSize));
  const safePage = Math.min(page, totalPages);
  const pagedLogs = filteredLogs.slice((safePage - 1) * numericPageSize, safePage * numericPageSize);
  const pageStart = filteredLogs.length === 0 ? 0 : (safePage - 1) * numericPageSize + 1;
  const pageEnd = filteredLogs.length === 0 ? 0 : pageStart + pagedLogs.length - 1;

  useEffect(() => {
    if (!autoScroll) return;
    setPage(totalPages);
  }, [autoScroll, totalPages]);

  useEffect(() => {
    if (!autoScroll || safePage !== totalPages || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [autoScroll, safePage, totalPages, pagedLogs.length]);

  useEffect(() => {
    const accountFromQuery = searchParams.get('account');
    if (!accountFromQuery) return;
    setAccountFilter(accountFromQuery);
    setPage(1);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('account');
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LOGS_PAGE_STATE_KEY, JSON.stringify({
      levelFilter,
      accountFilter,
      fetchLimit,
      pageSize,
      autoScroll,
      searchQuery,
    }));
  }, [levelFilter, accountFilter, fetchLimit, pageSize, autoScroll, searchQuery]);

  useEffect(() => {
    if (accountFilter !== 'all' && !accounts.some((account) => account.account_id === accountFilter)) {
      setAccountFilter('all');
    }
  }, [accountFilter, accounts]);

  const handleFilterChange = (level: LogLevel | 'all', account: string) => {
    setLevelFilter(level);
    setAccountFilter(account);
    setPage(1);
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'logs.json';
    link.click();
    URL.revokeObjectURL(url);
    toast.success(t('logs.toast.exported'));
  };

  const handleClear = async () => {
    try {
      await api.clearLogs();
      await Promise.all([shell.refreshShell(), logsQuery.refetch()]);
      toast.success(t('logs.toast.cleared'));
    } catch (error) {
      toast.error(formatAppError(error, t('logs.error.clearFailed')));
    }
  };

  if (logsQuery.isLoading) {
    return <div className="flex-1 grid place-items-center text-sm text-muted-foreground">{t('loading.logs')}</div>;
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-border/50 flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-foreground">{t('logs.title')}</h2>
        <div className="flex items-center gap-3">
          <Select value={levelFilter} onValueChange={(value) => handleFilterChange(value as LogLevel | 'all', accountFilter)}>
            <SelectTrigger className="h-7 w-28 text-xs bg-input border-border/50"><SelectValue placeholder={t('logs.level')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('logs.allLevels')}</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warn">Warn</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
          <Select value={accountFilter} onValueChange={(value) => handleFilterChange(levelFilter, value)}>
            <SelectTrigger className="h-7 w-28 text-xs bg-input border-border/50"><SelectValue placeholder={t('logs.account')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('logs.allAccounts')}</SelectItem>
              {accounts.map((account) => <SelectItem key={account.id} value={account.account_id}>{account.account_id}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setPage(1);
            }}
            placeholder={t('logs.search')}
            className="h-7 w-52 text-xs bg-input border-border/50"
          />
          <div className="flex items-center gap-2">
            <Label className="text-[11px] text-muted-foreground">{t('logs.recent')}</Label>
            <Select value={fetchLimit} onValueChange={(value) => {
              setFetchLimit(value);
              setPage(1);
            }}>
              <SelectTrigger className="h-7 w-24 text-xs bg-input border-border/50"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LOG_FETCH_LIMIT_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {t('logs.items', { count: option })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="text-[11px] text-muted-foreground">{t('logs.autoScroll')}</Label>
            <Switch checked={autoScroll} onCheckedChange={setAutoScroll} />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => logsQuery.refetch().catch((error: Error) => toast.error(formatAppError(error, t('logs.error.refreshFailed'))))}
            disabled={logsQuery.isFetching}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${logsQuery.isFetching ? 'animate-spin' : ''}`} />{t('logs.refresh')}
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleClear}>
            <Trash2 className="h-3 w-3 mr-1" />{t('logs.clear')}
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleExport}>
            <Download className="h-3 w-3 mr-1" />{t('logs.export')}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>{t('logs.showingRange', { start: pageStart, end: pageEnd, total: filteredLogs.length })}</span>
          {filteredLogs.length !== logs.length ? (
            <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px] font-normal">
              {t('logs.filteredCount', { count: filteredLogs.length, total: logs.length })}
            </Badge>
          ) : null}
          <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px] font-normal">
            {t('logs.loadedRecent', { count: fetchLimit })}
          </Badge>
        </div>
        {logsQuery.isFetching ? <span>{t('logs.refreshing')}</span> : null}
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto bg-background/50 p-4 font-mono text-xs">
        {pagedLogs.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            {logs.length === 0 ? t('logs.empty') : t('logs.emptyFiltered')}
          </p>
        ) : (
          <div className="space-y-0.5">
            {pagedLogs.map((log) => (
              <div
                key={log.id}
                className="grid grid-cols-[72px_52px_minmax(120px,180px)_minmax(0,1fr)] items-start gap-3 py-1 hover:bg-secondary/20 px-2 rounded"
              >
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {new Date(log.created_at).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className={`shrink-0 w-12 uppercase font-semibold ${levelColors[log.level]}`}>
                  {log.level}
                </span>
                <span
                  className="min-w-0 truncate text-info"
                  title={log.account_name || '—'}
                >
                  {log.account_name ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/?account=${encodeURIComponent(log.account_name)}`)}
                      className="truncate text-left hover:underline"
                      title={t('common.openInDashboard')}
                    >
                      {log.account_name}
                    </button>
                  ) : '—'}
                </span>
                <span className="min-w-0 break-words text-foreground/80">{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 flex items-center justify-between border-t border-border/50 px-4 py-3 text-xs text-muted-foreground">
        <span>{t('logs.pageOnly', { page: safePage, total: totalPages })}</span>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <span>{t('common.perPage')}</span>
            <Select value={pageSize} onValueChange={(value) => {
              setPageSize(value);
              setPage(1);
            }}>
              <SelectTrigger className="h-7 w-24 text-xs bg-input border-border/50"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setAutoScroll(false);
              setPage(1);
            }}
            disabled={safePage <= 1}
          >
            {t('common.firstPage')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setAutoScroll(false);
              setPage((current) => Math.max(1, current - 1));
            }}
            disabled={safePage <= 1}
          >
            {t('common.prevPage')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setAutoScroll(false);
              setPage((current) => Math.min(totalPages, current + 1));
            }}
            disabled={safePage >= totalPages}
          >
            {t('common.nextPage')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default LogsPage;

import { useEffect, useRef, useState } from 'react';
import { Header } from '@/components/Header';
import { LeftSidebar } from '@/components/LeftSidebar';
import { DouyinPromo } from '@/components/DouyinPromo';
import { Account, LogEntry, LogLevel, PoolSettings } from '@/types';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Download, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const levelColors: Record<LogLevel, string> = {
  info: 'text-muted-foreground',
  warn: 'text-warning',
  error: 'text-destructive',
};

const LogsPage = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settings, setSettings] = useState<PoolSettings | null>(null);
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  const loadPage = async (level = levelFilter, account = accountFilter) => {
    const [nextLogs, nextAccounts, nextSettings] = await Promise.all([
      api.listLogs({ level, account }),
      api.listAccounts(),
      api.getSettings(),
    ]);
    setLogs(nextLogs);
    setAccounts(nextAccounts);
    setSettings(nextSettings);
  };

  useEffect(() => {
    loadPage().catch((error: Error) => toast.error(error.message));
  }, []);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length, autoScroll]);

  const currentAccount = accounts.find((account) => account.is_current);

  const handleFilterChange = async (level: LogLevel | 'all', account: string) => {
    setLevelFilter(level);
    setAccountFilter(account);
    try {
      const nextLogs = await api.listLogs({ level, account });
      setLogs(nextLogs);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'logs.json';
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Logs exported');
  };

  const handleClear = async () => {
    try {
      await api.clearLogs();
      setLogs([]);
      toast.success('Logs cleared');
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  if (!settings) {
    return <div className="h-screen grid place-items-center text-sm text-muted-foreground">{t('loading.logs')}</div>;
  }

  return (
    <div className="h-screen flex flex-col">
      <DouyinPromo />
      <Header activeAccount={currentAccount?.account_id || 'None'} mode={settings.mode} onModeChange={(mode) => setSettings((prev) => prev ? { ...prev, mode } : prev)} />
      <div className="flex-1 flex min-h-0">
        <LeftSidebar currentAccount={currentAccount} accounts={accounts} recentLogs={logs} />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border/50 flex-wrap gap-2">
            <h2 className="text-sm font-semibold text-foreground">{t('logs.title')}</h2>
            <div className="flex items-center gap-3">
              <Select value={levelFilter} onValueChange={(value) => handleFilterChange(value as LogLevel | 'all', accountFilter)}>
                <SelectTrigger className="h-7 w-28 text-xs bg-input border-border/50"><SelectValue placeholder="Level" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('logs.allLevels')}</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warn">Warn</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
              <Select value={accountFilter} onValueChange={(value) => handleFilterChange(levelFilter, value)}>
                <SelectTrigger className="h-7 w-28 text-xs bg-input border-border/50"><SelectValue placeholder="Account" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('logs.allAccounts')}</SelectItem>
                  {accounts.map((account) => <SelectItem key={account.id} value={account.account_id}>{account.account_id}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1.5">
                <Label className="text-[11px] text-muted-foreground">{t('logs.autoScroll')}</Label>
                <Switch checked={autoScroll} onCheckedChange={setAutoScroll} />
              </div>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleClear}>
                <Trash2 className="h-3 w-3 mr-1" />{t('logs.clear')}
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleExport}>
                <Download className="h-3 w-3 mr-1" />{t('logs.export')}
              </Button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto bg-background/50 p-4 font-mono text-xs">
            {logs.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">{t('logs.empty')}</p>
            ) : (
              <div className="space-y-0.5">
                {logs.map((log) => (
                  <div key={log.id} className="flex gap-3 py-0.5 hover:bg-secondary/20 px-2 rounded">
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {new Date(log.created_at).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className={`shrink-0 w-12 uppercase font-semibold ${levelColors[log.level]}`}>
                      {log.level}
                    </span>
                    <span className="text-info shrink-0 w-16">{log.account_name || '—'}</span>
                    <span className="text-foreground/80">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LogsPage;

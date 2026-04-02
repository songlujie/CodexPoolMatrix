import { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { LeftSidebar } from '@/components/LeftSidebar';
import { Account, LogEntry, PoolSettings } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatAppError } from '@/lib/errors';
import { useI18n } from '@/lib/i18n';

const SettingsPage = () => {
  const [settings, setSettings] = useState<PoolSettings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [cliAuth, setCliAuth] = useState<Awaited<ReturnType<typeof api.getCurrentCodexAuth>> | null>(null);
  const [cliManagedStatus, setCliManagedStatus] = useState<Awaited<ReturnType<typeof api.getCodexManagedStatus>> | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    Promise.all([
      api.getSettings(),
      api.listAccounts(),
      api.listLogs(),
      api.getCurrentCodexAuth().catch(() => null),
      api.getCodexManagedStatus().catch(() => null),
    ])
      .then(([nextSettings, nextAccounts, nextLogs, nextCliAuth, nextCliManagedStatus]) => {
        setSettings(nextSettings);
        setAccounts(nextAccounts);
        setLogs(nextLogs);
        setCliAuth(nextCliAuth);
        setCliManagedStatus(nextCliManagedStatus);
      })
      .catch((error: Error) => toast.error(formatAppError(error, '加载设置失败')));
  }, []);

  const currentAccount = accounts.find((account) => account.is_current);

  const update = async (partial: Partial<PoolSettings>) => {
    if (!settings) return;
    const nextSettings = { ...settings, ...partial };
    setSettings(nextSettings);
    try {
      await api.updateSettings(nextSettings);
    } catch (error) {
      toast.error(formatAppError(error, '保存设置失败'));
    }
  };

  if (!settings) {
    return <div className="h-screen grid place-items-center text-sm text-muted-foreground">{t('loading.settings')}</div>;
  }

  return (
    <div className="h-screen flex flex-col">
      <Header activeAccount={currentAccount?.account_id || t('common.none')} mode={settings.mode} onModeChange={(mode) => update({ mode })} />
      <div className="flex-1 flex min-h-0">
        <LeftSidebar currentAccount={currentAccount} accounts={accounts} recentLogs={logs} cliAuth={cliAuth} cliManagedStatus={cliManagedStatus} />
        <div className="flex-1 overflow-y-auto p-6 max-w-3xl">
          <h2 className="text-sm font-semibold text-foreground mb-6">{t('settings.title')}</h2>

          <section className="space-y-4 mb-8">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('settings.global')}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t('settings.maxConcurrent')}</Label>
                <Input type="number" value={settings.max_concurrent_tasks ?? 0} onChange={(e) => update({ max_concurrent_tasks: +e.target.value })} className="h-8 text-xs bg-input border-border/50" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t('settings.globalRateLimit')}</Label>
                <Input type="number" value={settings.global_rate_limit ?? 0} onChange={(e) => update({ global_rate_limit: +e.target.value })} className="h-8 text-xs bg-input border-border/50" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t('settings.taskTimeout')}</Label>
                <Input type="number" value={settings.task_timeout_minutes ?? 0} onChange={(e) => update({ task_timeout_minutes: +e.target.value })} className="h-8 text-xs bg-input border-border/50" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t('settings.maxRetries')}</Label>
                <Input type="number" value={settings.max_retries ?? 0} onChange={(e) => update({ max_retries: +e.target.value })} className="h-8 text-xs bg-input border-border/50" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">{t('settings.autoRetry')}</Label>
              <Switch checked={settings.auto_retry} onCheckedChange={(value) => update({ auto_retry: value })} />
            </div>
          </section>

          <Separator className="bg-border/50 mb-8" />

          <section className="space-y-4 mb-8">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('settings.notifications')}</h3>
            {['Account errors', 'Rate limits hit', 'Task failures', 'Pool rotation'].map((label) => (
              <div key={label} className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">{label}</Label>
                <Switch defaultChecked />
              </div>
            ))}
          </section>

          <Separator className="bg-border/50 mb-8" />

          <section className="space-y-3 mb-8">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('settings.importExport')}</h3>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => toast.info('Import accounts API not implemented yet')}>Import Accounts (JSON)</Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => toast.success('Export from database is ready to add next')}>Export All Accounts</Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => toast.info('Import config API not implemented yet')}>Import Pool Config</Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => toast.success('Current settings are persisted in MySQL')}>Export Pool Config</Button>
            </div>
          </section>

          <Separator className="bg-border/50 mb-8" />

          <section className="space-y-3 rounded-lg border border-destructive/30 p-4">
            <h3 className="text-xs font-semibold text-destructive uppercase tracking-wider">{t('settings.dangerZone')}</h3>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" className="h-8 text-xs border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => toast.error('Bulk reset endpoint can be added next')}>Reset All Accounts</Button>
              <Button variant="outline" size="sm" className="h-8 text-xs border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => toast.error('Task history cleanup endpoint can be added next')}>Clear Task History</Button>
              <Button variant="outline" size="sm" className="h-8 text-xs border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => toast.error('Full data wipe endpoint is intentionally not wired yet')}>Delete All Data</Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;

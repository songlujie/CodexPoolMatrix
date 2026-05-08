import { type ChangeEvent, useRef } from 'react';
import { Upload } from 'lucide-react';
import { Account, PoolSettings } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatAppError } from '@/lib/errors';
import { useI18n } from '@/lib/i18n';
import { useAppShell } from '@/components/app-shell-context';
import { useEditableSettings } from '@/hooks/use-editable-settings';

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const SettingsPage = () => {
  const accountsImportRef = useRef<HTMLInputElement | null>(null);
  const configImportRef = useRef<HTMLInputElement | null>(null);
  const { t } = useI18n();
  const shell = useAppShell();
  const accounts = shell.accounts;
  const {
    settings,
    saveStatus,
    lastSavedAt,
    update,
    replaceSettings,
    saveNow,
  } = useEditableSettings({
    sourceSettings: shell.settings,
    onAfterSave: shell.refreshShell,
    onSaveError: (error) => {
      toast.error(formatAppError(error, t('settings.error.saveFailed')));
    },
  });
  const runtimeMode = settings?.mode ?? 'codex';
  const runtimePathLabel = runtimeMode === 'claude' ? t('right.claudePath') : t('right.codexPath');
  const runtimePathHint = runtimeMode === 'claude' ? t('right.claudePathHint') : t('right.codexPathHint');
  const runtimePathValue = runtimeMode === 'claude' ? (settings?.claude_path ?? '') : (settings?.codex_path ?? '');

  const saveCurrentSettings = async () => {
    if (!settings) return;
    const ok = await saveNow();
    if (ok) {
      toast.success(t('settings.toast.saved'));
    }
  };

  const handleExportAccounts = () => {
    downloadJson('accounts-export.json', {
      exported_at: new Date().toISOString(),
      total: accounts.length,
      items: accounts,
    });
    toast.success(t('settings.toast.accountsExported', { count: accounts.length }));
  };

  const handleExportSettings = () => {
    if (!settings) return;
    downloadJson('pool-settings.json', {
      exported_at: new Date().toISOString(),
      settings,
    });
    toast.success(t('settings.toast.configExported'));
  };

  const handleImportAccountsFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as { items?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
      const items = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.items)
          ? parsed.items
          : null;

      if (!items) {
        throw new Error(t('settings.error.invalidAccountsFile'));
      }

      const existingAccountIds = new Set(accounts.map((account) => account.account_id.toLowerCase()));
      const existingAuthPaths = new Set(accounts.map((account) => (account.auth_file_path || '').toLowerCase()).filter(Boolean));
      const existingEmails = new Set(accounts.map((account) => (account.email || '').toLowerCase()).filter(Boolean));

      let imported = 0;
      let skipped = 0;

      for (const item of items) {
        const accountId = String(item.account_id || '').trim();
        const email = String(item.email || '').trim();
        const authFilePath = String(item.auth_file_path || '').trim();
        const providerMode = item.provider_mode === 'api' ? 'api' : 'oauth';
        const apiKey = String(item.api_key || '').trim();
        const isDuplicate = !accountId
          || existingAccountIds.has(accountId.toLowerCase())
          || (!!authFilePath && existingAuthPaths.has(authFilePath.toLowerCase()))
          || (!!email && existingEmails.has(email.toLowerCase()))
          || (providerMode === 'api' && !apiKey);

        if (isDuplicate) {
          skipped += 1;
          continue;
        }

        await api.createAccount({
          account_id: accountId,
          email,
          auth_type: (item.auth_type as Account['auth_type']) || 'plus',
          auth_file_path: authFilePath,
          provider_mode: providerMode,
          api_base_url: String(item.api_base_url || ''),
          api_key: apiKey,
          api_model: String(item.api_model || ''),
          api_cli_config: String(item.api_cli_config || ''),
          platform: String(item.platform || 'gpt'),
        });

        imported += 1;
        existingAccountIds.add(accountId.toLowerCase());
        if (authFilePath) existingAuthPaths.add(authFilePath.toLowerCase());
        if (email) existingEmails.add(email.toLowerCase());
      }

      await shell.refreshShell();
      toast.success(t('settings.toast.accountsImported', { imported, skipped }));
    } catch (error) {
      toast.error(formatAppError(error, t('settings.error.importAccountsFailed')));
    }
  };

  const handleImportConfigFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !settings) return;

    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as { settings?: PoolSettings } | PoolSettings;
      const nextSettings = (parsed && typeof parsed === 'object' && 'settings' in parsed ? parsed.settings : parsed) as PoolSettings | null;

      if (!nextSettings || typeof nextSettings !== 'object') {
        throw new Error(t('settings.error.invalidConfigFile'));
      }

      if (!window.confirm(t('settings.confirm.importConfig'))) {
        return;
      }

      const normalizedSettings: PoolSettings = {
        ...settings,
        ...nextSettings,
        updated_at: settings.updated_at,
      };
      replaceSettings(normalizedSettings, { scheduleSave: false });
      const ok = await saveNow(normalizedSettings);
      if (!ok) return;
      toast.success(t('settings.toast.configImported'));
    } catch (error) {
      toast.error(formatAppError(error, t('settings.error.importConfigFailed')));
    }
  };

  const handleClearAllAccounts = async () => {
    if (!window.confirm(t('settings.confirm.clearAccounts'))) {
      return;
    }

    try {
      await api.clearAllAccounts();
      await shell.refreshShell();
      toast.success(t('settings.toast.accountsCleared'));
    } catch (error) {
      toast.error(formatAppError(error, t('settings.error.clearAccountsFailed')));
    }
  };

  const handleClearTaskHistory = async () => {
    if (!window.confirm(t('settings.confirm.clearTasks'))) {
      return;
    }

    try {
      const result = await api.clearTasks();
      await shell.refreshShell();
      toast.success(t('settings.toast.tasksCleared', { count: result.deleted }));
    } catch (error) {
      toast.error(formatAppError(error, t('settings.error.clearTasksFailed')));
    }
  };

  const handleClearSystemLogs = async () => {
    if (!window.confirm(t('settings.confirm.clearLogs'))) {
      return;
    }

    try {
      await api.clearLogs();
      await shell.refreshShell();
      toast.success(t('settings.toast.logsCleared'));
    } catch (error) {
      toast.error(formatAppError(error, t('settings.error.clearLogsFailed')));
    }
  };

  if (!settings) {
    return null;
  }

  const saveStatusLabel = saveStatus === 'error'
    ? t('common.saveFailed')
    : saveStatus === 'saved'
      ? t('common.saved')
      : saveStatus === 'saving'
        ? t('common.saving')
        : saveStatus === 'pending'
          ? t('common.unsavedChanges')
          : t('common.noPendingChanges');
  const saveTimeLabel = lastSavedAt
    ? t('common.lastSavedAt', { time: new Date(lastSavedAt).toLocaleTimeString() })
    : null;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('settings.title')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('settings.savedHint')}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {saveStatusLabel}{saveTimeLabel ? ` · ${saveTimeLabel}` : ''}
          </p>
        </div>
        <Button size="sm" className="h-8 text-xs" onClick={saveCurrentSettings} disabled={saveStatus === 'saving'}>
          {saveStatus === 'saving' ? t('settings.saving') : t('settings.save')}
        </Button>
      </div>

      <section className="mb-8 max-w-4xl space-y-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('settings.cli')}</h3>
        <div className="space-y-2 rounded-lg border border-border/50 p-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{runtimePathLabel}</Label>
            <Input
              value={runtimePathValue}
              onChange={(e) => update(settings.mode === 'claude' ? { claude_path: e.target.value } : { codex_path: e.target.value })}
              className="h-8 text-xs bg-input border-border/50 font-mono"
              placeholder={settings.mode === 'claude' ? '/usr/local/bin/claude' : '/opt/homebrew/bin/codex'}
            />
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">{t('settings.cliHint')}</p>
          <p className="text-[11px] leading-4 text-muted-foreground">{runtimePathHint}</p>
          <p className="text-[11px] leading-4 text-muted-foreground">{t('settings.cliExamples')}</p>
        </div>
      </section>

      <Separator className="bg-border/50 mb-8" />

      <section className="mb-8 max-w-4xl space-y-4">
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

      <section className="mb-8 max-w-4xl space-y-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('settings.notifications')}</h3>
        <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
          <p className="text-xs font-medium text-foreground">{t('settings.notificationsNotConfigurable')}</p>
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{t('settings.notificationsHint')}</p>
        </div>
      </section>

      <Separator className="bg-border/50 mb-8" />

      <section className="mb-8 max-w-4xl space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('settings.importExport')}</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-border/50 bg-card/50 p-4">
            <p className="text-xs font-medium text-foreground">{t('settings.exportAvailable')}</p>
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{t('settings.exportHint')}</p>
            <div className="mt-3 grid grid-cols-1 gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleExportAccounts}>{t('settings.exportAccounts')}</Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleExportSettings}>{t('settings.exportConfig')}</Button>
            </div>
          </div>
          <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
            <p className="text-xs font-medium text-foreground">{t('settings.importReady')}</p>
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{t('settings.importHint')}</p>
            <div className="mt-3 grid grid-cols-1 gap-2">
              <input
                ref={accountsImportRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={handleImportAccountsFile}
              />
              <input
                ref={configImportRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={handleImportConfigFile}
              />
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => accountsImportRef.current?.click()}>
                <Upload className="h-3 w-3 mr-1" />
                {t('settings.importAccounts')}
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => configImportRef.current?.click()}>
                <Upload className="h-3 w-3 mr-1" />
                {t('settings.importConfig')}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <Separator className="bg-border/50 mb-8" />

      <section className="max-w-4xl space-y-3 rounded-lg border border-destructive/30 p-4">
        <h3 className="text-xs font-semibold text-destructive uppercase tracking-wider">{t('settings.dangerZone')}</h3>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="h-8 text-xs border-destructive/30 text-destructive hover:bg-destructive/10" onClick={handleClearAllAccounts}>{t('settings.clearAccounts')}</Button>
          <Button variant="outline" size="sm" className="h-8 text-xs border-destructive/30 text-destructive hover:bg-destructive/10" onClick={handleClearTaskHistory}>{t('settings.clearTasks')}</Button>
          <Button variant="outline" size="sm" className="h-8 text-xs border-destructive/30 text-destructive hover:bg-destructive/10" onClick={handleClearSystemLogs}>{t('settings.clearLogs')}</Button>
        </div>
      </section>
    </div>
  );
};

export default SettingsPage;

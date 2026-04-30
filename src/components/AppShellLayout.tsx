import { Outlet } from 'react-router-dom';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Header } from '@/components/Header';
import { LeftSidebar } from '@/components/LeftSidebar';
import { api } from '@/lib/api';
import { formatAppError } from '@/lib/errors';
import { useI18n } from '@/lib/i18n';
import { useRuntimeShell } from '@/hooks/use-runtime-shell';
import { AppShellContext } from '@/components/app-shell-context';

function accountMatchesMode(account: { platform: string }, mode: 'codex' | 'claude') {
  return mode === 'claude' ? account.platform === 'claude' : account.platform !== 'claude';
}

export function AppShellLayout() {
  const shell = useRuntimeShell({ pollIntervalMs: 30_000 });
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [modeChanging, setModeChanging] = useState(false);

  const handleModeChange = async (mode: 'codex' | 'claude') => {
    if (!shell.settings || modeChanging) {
      return;
    }

    const modeLabel = mode === 'claude' ? t('header.mode.claude') : t('header.mode.codex');
    if (shell.settings.mode === mode) {
      toast.info(t('toast.modeAlreadyActive', { mode: modeLabel }));
      return;
    }

    const loadingToastId = toast.loading(t('toast.modeSwitching', { mode: modeLabel }));
    setModeChanging(true);

    try {
      const ok = await shell.updateMode(mode);
      if (!ok) {
        toast.dismiss(loadingToastId);
        return;
      }

      const refreshedAccounts = await api.listAccounts();
      const currentModeAccount = refreshedAccounts.find((account) => account.is_current && accountMatchesMode(account, mode));

      if (mode === 'claude' && !currentModeAccount) {
        const fallbackApiAccount = refreshedAccounts.find((account) => accountMatchesMode(account, 'claude') && account.provider_mode === 'api');
        if (!fallbackApiAccount) {
          toast.dismiss(loadingToastId);
          toast.error(t('toast.claudeModeNeedsApiAccount'));
          return;
        }

        await api.updateAccountAction(fallbackApiAccount.id, 'setActive');
        await shell.refreshShell();
        toast.info(t('toast.claudeModeAutoSwitched', { account: fallbackApiAccount.account_id }));
      } else {
        await shell.refreshShell();
      }

      toast.dismiss(loadingToastId);
      toast.success(t('toast.modeSwitched', { mode: modeLabel }));

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['model-calls'] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      ]);
    } catch (error) {
      toast.dismiss(loadingToastId);
      toast.error(formatAppError(error, t('logs.error.switchModeFailed')));
    } finally {
      setModeChanging(false);
    }
  };

  if (shell.isLoading || !shell.settings) {
    return <div className="h-screen grid place-items-center text-sm text-muted-foreground">{t('loading.dashboard')}</div>;
  }

  return (
    <AppShellContext.Provider value={shell}>
      <div className="h-screen flex flex-col">
        <Header
          activeAccount={shell.currentAccount?.account_id || t('common.none')}
          mode={shell.settings.mode}
          modeChanging={modeChanging}
          onModeChange={(mode) => void handleModeChange(mode)}
        />
        <div className="flex-1 flex min-h-0">
          <LeftSidebar
            currentAccount={shell.currentAccount}
            accounts={shell.accounts}
            recentLogs={shell.recentLogs}
            cliAuth={shell.cliAuth}
            cliManagedStatus={shell.cliManagedStatus}
          />
          <Outlet />
        </div>
      </div>
    </AppShellContext.Provider>
  );
}

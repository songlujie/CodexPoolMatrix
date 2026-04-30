import { useEffect, useState, useCallback, useRef } from 'react';
import { RightSidebar, type QuickActionKey, type QuickActionStatus } from '@/components/RightSidebar';
import { AccountGrid } from '@/components/AccountGrid';
import { PoolSettings, LiveUsageData } from '@/types';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatAppError } from '@/lib/errors';
import { useI18n } from '@/lib/i18n';
import { useAppShell } from '@/components/app-shell-context';

const CHECK_ALL_USAGE_CONCURRENCY = 4;
const BATCH_ACCOUNT_ACTION_CONCURRENCY = 4;

function settingsSnapshot(settings: PoolSettings | null | undefined) {
  return settings ? JSON.stringify(settings) : '';
}

const Index = () => {
  const [batchUsageMap, setBatchUsageMap] = useState<Record<string, LiveUsageData>>({});
  const [settings, setSettings] = useState<PoolSettings | null>(null);
  const [tokenRefreshKey, setTokenRefreshKey] = useState(0);
  const [busyAction, setBusyAction] = useState<QuickActionKey | null>(null);
  const [actionStatus, setActionStatus] = useState<QuickActionStatus | null>(null);
  const { t } = useI18n();
  const shell = useAppShell();
  const accounts = shell.accounts;

  // Settings debounce：300ms 内多次变更只保存最后一次
  const settingsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (shell.settings) {
      setSettings((prev) => {
        if (!prev) return shell.settings;
        if (settingsSnapshot(prev) === settingsSnapshot(shell.settings)) {
          return prev;
        }
        if (settingsTimerRef.current) {
          clearTimeout(settingsTimerRef.current);
          settingsTimerRef.current = null;
        }
        return shell.settings;
      });
    }
  }, [shell.settings]);

  // ── 账号操作：直接传 action，不再让父组件猜 ──

  const setRunningAction = useCallback((action: QuickActionKey, label: string, detail?: string, progress?: QuickActionStatus['progress']) => {
    setBusyAction(action);
    setActionStatus({ tone: 'running', label, detail, progress: progress ?? null });
  }, []);

  const setActionSuccess = useCallback((label: string, detail?: string, progress?: QuickActionStatus['progress']) => {
    setActionStatus({ tone: 'success', label, detail, progress: progress ?? null });
  }, []);

  const setActionError = useCallback((label: string, detail: string) => {
    setActionStatus({ tone: 'error', label, detail, progress: null });
  }, []);

  const handleAccountAction = useCallback(async (action: 'setActive' | 'pause' | 'reset', id: string) => {
    try {
      await api.updateAccountAction(id, action);
      await shell.refreshShell();
    } catch (error) {
      toast.error(formatAppError(error, t('dashboard.error.accountActionFailed')));
    }
  }, [shell, t]);

  const handleAccountRemove = useCallback(async (id: string) => {
    try {
      await api.deleteAccount(id);
      await shell.refreshShell();
    } catch (error) {
      toast.error(formatAppError(error, t('dashboard.error.accountRemoveFailed')));
      throw error;
    }
  }, [shell, t]);

  const handleAccountAdded = useCallback(async () => {
    await shell.refreshShell();
  }, [shell]);

  const handleClearAll = useCallback(async () => {
    try {
      await api.clearAllAccounts();
      await shell.refreshShell();
      toast.success(t('toast.allCleared'));
    } catch (error) {
      toast.error(formatAppError(error, t('dashboard.error.clearAllFailed')));
    }
  }, [shell, t]);

  // ── Settings：debounce 保存 ──

  const handleSettingsChange = useCallback((nextSettings: PoolSettings) => {
    setSettings(nextSettings);
    // 清除之前的定时器
    if (settingsTimerRef.current) {
      clearTimeout(settingsTimerRef.current);
    }
    // 300ms 后才真正发送请求
    settingsTimerRef.current = setTimeout(async () => {
      try {
        await api.updateSettings(nextSettings);
        await shell.refreshShell();
      } catch (error) {
        toast.error(formatAppError(error, t('dashboard.error.saveSettingsFailed')));
      }
    }, 300);
  }, [shell, t]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (settingsTimerRef.current) clearTimeout(settingsTimerRef.current);
    };
  }, []);

  const handleRotateNow = async () => {
    if (busyAction) return;
    const label = t('right.rotateNext');
    setRunningAction('rotate', label);
    try {
      const account = await api.rotateNow();
      await shell.refreshShell();
      toast.success(t('toast.rotatedToAccount', { account: account.account_id }));
      setActionSuccess(label, account.account_id);
    } catch (error) {
      const message = formatAppError(error, t('dashboard.error.rotateFailed'));
      toast.error(message);
      setActionError(label, message);
    } finally {
      setBusyAction(null);
    }
  };

  const handlePauseAll = async () => {
    if (busyAction) return;
    const label = t('right.pauseAll');
    setRunningAction('pauseAll', label);
    try {
      await api.pauseAll();
      await shell.refreshShell();
      toast.warning(t('toast.allAccountsPaused'));
      setActionSuccess(label, t('toast.allAccountsPaused'));
    } catch (error) {
      const message = formatAppError(error, t('dashboard.error.pauseAllFailed'));
      toast.error(message);
      setActionError(label, message);
    } finally {
      setBusyAction(null);
    }
  };

  const handlePauseAccounts = useCallback(async (accountIds: string[]) => {
    if (busyAction) return;

    const targetAccounts = accounts.filter((account) => accountIds.includes(account.id));
    const total = targetAccounts.length;
    const label = t('filter.pauseFiltered');
    const initialProgress = { current: 0, total, success: 0 };
    setRunningAction('pauseFiltered', label, t('toast.pausingFilteredAccounts'), initialProgress);

    if (total === 0) {
      setActionSuccess(label, t('common.none'), initialProgress);
      setBusyAction(null);
      return;
    }

    try {
      toast.info(t('toast.pausingFilteredAccounts'));
      const pendingAccounts = [...targetAccounts];
      let completed = 0;
      let success = 0;

      await Promise.all(Array.from({ length: Math.min(BATCH_ACCOUNT_ACTION_CONCURRENCY, total) }, async () => {
        while (pendingAccounts.length > 0) {
          const account = pendingAccounts.shift();
          if (!account) return;

          try {
            await api.updateAccountAction(account.id, 'pause');
            success += 1;
          } finally {
            completed += 1;
            setActionStatus({
              tone: 'running',
              label,
              detail: t('toast.pausingFilteredAccounts'),
              progress: { current: completed, total, success },
            });
          }
        }
      }));

      await shell.refreshShell();
      const detail = t('toast.pauseFilteredDone', { success, total });
      const progress = { current: total, total, success };
      toast.success(detail);
      setActionSuccess(label, detail, progress);
    } catch (error) {
      const message = formatAppError(error, t('dashboard.error.pauseFilteredFailed'));
      toast.error(message);
      setActionError(label, message);
    } finally {
      setBusyAction(null);
    }
  }, [accounts, busyAction, shell, t, setActionError, setActionSuccess, setRunningAction]);

  const handleHealthCheck = async () => {
    if (busyAction) return;
    const label = t('right.healthCheck');
    setRunningAction('healthCheck', label);
    try {
      const result = await api.healthCheck();
      await shell.refreshShell();
      const detail = t('toast.healthCheckCompleted', { count: result.totalAccounts });
      toast.success(detail);
      setActionSuccess(label, detail);
    } catch (error) {
      const message = formatAppError(error, t('dashboard.error.healthCheckFailed'));
      toast.error(message);
      setActionError(label, message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleCheckAllUsage = async (accountIds?: string[]) => {
    if (busyAction) return;
    const targetAccounts = accountIds?.length
      ? accounts.filter((account) => accountIds.includes(account.id))
      : accounts;
    const total = targetAccounts.length;
    const label = t('right.checkAllUsage');
    const initialProgress = { current: 0, total, success: 0 };
    setRunningAction('checkAllUsage', label, t('toast.checkingAllUsage'), initialProgress);
    if (total === 0) {
      setActionSuccess(label, t('common.none'), initialProgress);
      setBusyAction(null);
      return;
    }

    try {
      toast.info(t('toast.checkingAllUsage'));
      const pendingAccounts = [...targetAccounts];
      const next: Record<string, LiveUsageData> = {};
      let completed = 0;
      let success = 0;

      await Promise.all(Array.from({ length: Math.min(CHECK_ALL_USAGE_CONCURRENCY, total) }, async () => {
        while (pendingAccounts.length > 0) {
          const account = pendingAccounts.shift();
          if (!account) return;

          try {
            const result = await api.checkAccountUsage(account.id);
            next[account.id] = {
              ok: result.ok,
              fetched_at: result.fetched_at,
              plan_type: result.plan_type,
              primary: result.primary,
              secondary: result.secondary,
              error: result.error,
            };
            if (result.ok) {
              success += 1;
            }
          } finally {
            completed += 1;
            setActionStatus({
              tone: 'running',
              label,
              detail: t('toast.checkingAllUsage'),
              progress: { current: completed, total, success },
            });
          }
        }
      }));

      setBatchUsageMap({ ...next }); // new object reference triggers AccountGrid effect
      const detail = t('toast.checkAllUsageDone', { success, total });
      const progress = { current: total, total, success };
      toast.success(detail);
      setActionSuccess(label, detail, progress);
    } catch (error) {
      const message = formatAppError(error, t('dashboard.error.checkAllUsageFailed'));
      toast.error(message);
      setActionError(label, message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleRefreshAllTokens = async () => {
    if (busyAction) return;
    const label = t('right.refreshAllTokens');
    setRunningAction('refreshAllTokens', label);
    try {
      const result = await api.refreshAllTokens();
      await shell.refreshShell();
      setTokenRefreshKey(k => k + 1);
      if (result.success === result.total) {
        const detail = t('toast.refreshAllTokensSuccess', { total: result.total });
        toast.success(detail);
        setActionSuccess(label, detail, { current: result.total, total: result.total, success: result.success });
      } else {
        const detail = t('toast.refreshAllTokensPartial', {
          success: result.success,
          total: result.total,
          failed: result.total - result.success,
        });
        toast.warning(detail);
        setActionSuccess(label, detail, { current: result.total, total: result.total, success: result.success });
      }
    } catch (error) {
      const message = formatAppError(error, t('dashboard.error.refreshAllTokensFailed'));
      toast.error(message);
      setActionError(label, message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleRestartOpenClaw = async () => {
    if (busyAction) return;
    const label = t('right.reloadOpenClaw');
    setRunningAction('restartOpenClaw', label);
    try {
      const result = await api.restartOpenClaw();
      await shell.refreshShell();
      if (result.ok) {
        const detail = t('toast.openclawReloaded', { method: result.method || t('common.none') });
        toast.success(detail);
        setActionSuccess(label, detail);
      } else {
        const message = formatAppError(result.reason, t('dashboard.error.restartOpenClawFailed'));
        toast.error(message);
        setActionError(label, message);
      }
    } catch (error) {
      const message = formatAppError(error, t('dashboard.error.restartOpenClawFailed'));
      toast.error(message);
      setActionError(label, message);
    } finally {
      setBusyAction(null);
    }
  };

  if (!settings) {
    return null;
  }

  return (
    <>
      <AccountGrid
        accounts={accounts}
        runtimeMode={shell.settings?.mode ?? 'codex'}
        onAction={handleAccountAction}
        onRemove={handleAccountRemove}
        onAccountAdded={handleAccountAdded}
        onAccountUpdated={handleAccountAdded}
        onClearAll={handleClearAll}
        onCheckAllUsage={handleCheckAllUsage}
        onPauseAccounts={handlePauseAccounts}
        batchActionsDisabled={Boolean(busyAction)}
        refreshKey={tokenRefreshKey}
        pushedUsageMap={batchUsageMap}
      />
      <RightSidebar
        settings={settings}
        onSettingsChange={handleSettingsChange}
        onRotateNow={handleRotateNow}
        onPauseAll={handlePauseAll}
        onHealthCheck={handleHealthCheck}
        onRestartOpenClaw={handleRestartOpenClaw}
        onRefreshAllTokens={handleRefreshAllTokens}
        onCheckAllUsage={handleCheckAllUsage}
        busyAction={busyAction}
        actionStatus={actionStatus}
      />
    </>
  );
};

export default Index;

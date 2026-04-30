import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  type RuntimeLogParams,
  useAccountsQuery,
  useCliAuthQuery,
  useCliManagedStatusQuery,
  useRecentLogsQuery,
  useSettingsQuery,
  useSidebarLogsQuery,
} from '@/hooks/runtime-shell-queries';

interface UseRuntimeShellOptions {
  logParams?: RuntimeLogParams;
  pollIntervalMs?: number;
  includeLogs?: boolean;
}

function accountMatchesMode(account: { platform: string }, mode: 'codex' | 'claude') {
  return mode === 'claude' ? account.platform === 'claude' : account.platform !== 'claude';
}

export function useRuntimeShell(options: UseRuntimeShellOptions = {}) {
  const { logParams, pollIntervalMs, includeLogs = false } = options;
  const queryClient = useQueryClient();
  const accountsQuery = useAccountsQuery(pollIntervalMs);
  const settingsQuery = useSettingsQuery(pollIntervalMs);
  const cliAuthQuery = useCliAuthQuery(pollIntervalMs);
  const cliManagedStatusQuery = useCliManagedStatusQuery(pollIntervalMs);
  const recentLogsQuery = useRecentLogsQuery(pollIntervalMs);
  const logsQuery = useSidebarLogsQuery(logParams, pollIntervalMs, includeLogs);

  const refreshShell = useCallback(async () => {
    const tasks = [
      accountsQuery.refetch(),
      settingsQuery.refetch(),
      cliAuthQuery.refetch(),
      cliManagedStatusQuery.refetch(),
      recentLogsQuery.refetch(),
    ];

    if (includeLogs) {
      tasks.push(logsQuery.refetch());
    }

    await Promise.all(tasks);
  }, [accountsQuery, settingsQuery, cliAuthQuery, cliManagedStatusQuery, recentLogsQuery, includeLogs, logsQuery]);

  const invalidateShell = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['runtime-shell', 'accounts'] }),
      queryClient.invalidateQueries({ queryKey: ['runtime-shell', 'settings'] }),
      queryClient.invalidateQueries({ queryKey: ['runtime-shell', 'cli-auth'] }),
      queryClient.invalidateQueries({ queryKey: ['runtime-shell', 'cli-managed-status'] }),
      queryClient.invalidateQueries({ queryKey: ['runtime-shell', 'recent-logs'] }),
      queryClient.invalidateQueries({ queryKey: ['runtime-shell', 'logs'] }),
    ]);
  }, [queryClient]);

  const updateMode = useCallback(async (mode: 'codex' | 'claude') => {
    const settings = settingsQuery.data;
    if (!settings) return false;

    const nextSettings = await api.updateSettings({ ...settings, mode });
    queryClient.setQueryData(['runtime-shell', 'settings'], nextSettings);
    await refreshShell();
    return nextSettings;
  }, [queryClient, refreshShell, settingsQuery.data]);

  const accounts = accountsQuery.data || [];
  const runtimeMode = settingsQuery.data?.mode ?? 'codex';
  const currentAccount = accounts.find((account) => account.is_current && accountMatchesMode(account, runtimeMode));

  return {
    accounts,
    recentLogs: recentLogsQuery.data || [],
    logs: includeLogs ? (logsQuery.data || []) : [],
    settings: settingsQuery.data || null,
    cliAuth: cliAuthQuery.data || null,
    cliManagedStatus: cliManagedStatusQuery.data || null,
    currentAccount,
    isLoading: accountsQuery.isLoading || settingsQuery.isLoading || recentLogsQuery.isLoading || (includeLogs && logsQuery.isLoading),
    isRefreshing: accountsQuery.isFetching || settingsQuery.isFetching || cliAuthQuery.isFetching || cliManagedStatusQuery.isFetching || recentLogsQuery.isFetching || (includeLogs && logsQuery.isFetching),
    isFetchingLogs: includeLogs ? logsQuery.isFetching : false,
    refreshShell,
    invalidateShell,
    updateMode,
  };
}

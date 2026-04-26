import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Account, LogEntry, PoolSettings } from '@/types';

export type RuntimeLogParams = {
  level?: string;
  account?: string;
  limit?: number;
};

function toRefetchInterval(value?: number): number | false {
  return value && value > 0 ? value : false;
}

function baseOptions(pollIntervalMs?: number) {
  return {
    staleTime: 5_000,
    refetchInterval: toRefetchInterval(pollIntervalMs),
    refetchOnWindowFocus: false as const,
  };
}

export function useAccountsQuery(pollIntervalMs?: number) {
  return useQuery<Account[]>({
    queryKey: ['runtime-shell', 'accounts'],
    queryFn: api.listAccounts,
    ...baseOptions(pollIntervalMs),
  });
}

export function useSettingsQuery(pollIntervalMs?: number) {
  return useQuery<PoolSettings>({
    queryKey: ['runtime-shell', 'settings'],
    queryFn: api.getSettings,
    ...baseOptions(pollIntervalMs),
  });
}

export function useCliAuthQuery(pollIntervalMs?: number) {
  return useQuery<Awaited<ReturnType<typeof api.getCurrentCodexAuth>> | null>({
    queryKey: ['runtime-shell', 'cli-auth'],
    queryFn: () => api.getCurrentCodexAuth().catch(() => null),
    ...baseOptions(pollIntervalMs),
  });
}

export function useCliManagedStatusQuery(pollIntervalMs?: number) {
  return useQuery<Awaited<ReturnType<typeof api.getCodexManagedStatus>> | null>({
    queryKey: ['runtime-shell', 'cli-managed-status'],
    queryFn: () => api.getCodexManagedStatus().catch(() => null),
    ...baseOptions(pollIntervalMs),
  });
}

export function useSidebarLogsQuery(logParams?: RuntimeLogParams, pollIntervalMs?: number, enabled = true) {
  return useQuery<LogEntry[]>({
    queryKey: ['runtime-shell', 'logs', logParams?.level || 'all', logParams?.account || 'all', logParams?.limit || 0],
    queryFn: () => api.listLogs(logParams),
    enabled,
    ...baseOptions(pollIntervalMs),
  });
}

export function useRecentLogsQuery(pollIntervalMs?: number) {
  return useQuery<LogEntry[]>({
    queryKey: ['runtime-shell', 'recent-logs'],
    queryFn: async () => {
      const rows = await api.listLogs({ limit: 6 });
      return rows.slice().reverse();
    },
    ...baseOptions(pollIntervalMs),
  });
}

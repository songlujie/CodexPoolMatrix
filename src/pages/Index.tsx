import { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { LeftSidebar } from '@/components/LeftSidebar';
import { RightSidebar } from '@/components/RightSidebar';
import { AccountGrid } from '@/components/AccountGrid';
import { Account, LogEntry, PoolSettings } from '@/types';
import { toast } from 'sonner';
import { api } from '@/lib/api';

const Index = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [settings, setSettings] = useState<PoolSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDashboard = async () => {
    const [nextAccounts, nextLogs, nextSettings] = await Promise.all([
      api.listAccounts(),
      api.listLogs(),
      api.getSettings(),
    ]);
    setAccounts(nextAccounts);
    setLogs(nextLogs);
    setSettings(nextSettings);
  };

  useEffect(() => {
    loadDashboard()
      .catch((error: Error) => toast.error(error.message))
      .finally(() => setLoading(false));
  }, []);

  const currentAccount = accounts.find((account) => account.is_current);

  const handleAccountsChange = async (nextAccounts: Account[]) => {
    const previousAccounts = accounts;
    setAccounts(nextAccounts);

    try {
      if (nextAccounts.length < previousAccounts.length) {
        const removed = previousAccounts.find((account) => !nextAccounts.some((nextAccount) => nextAccount.id === account.id));
        if (removed) {
          await api.deleteAccount(removed.id);
        }
      } else {
        const changed = nextAccounts.find((account) => {
          const previous = previousAccounts.find((item) => item.id === account.id);
          return previous && (
            previous.is_current !== account.is_current ||
            previous.status !== account.status ||
            previous.requests_this_minute !== account.requests_this_minute ||
            previous.tokens_used_percent !== account.tokens_used_percent
          );
        });

        if (changed) {
          const previous = previousAccounts.find((account) => account.id === changed.id);
          if (changed.is_current && !previous?.is_current) {
            await api.updateAccountAction(changed.id, 'setActive');
          } else if (changed.status === 'idle' && previous?.status !== 'idle' && changed.requests_this_minute === previous?.requests_this_minute) {
            await api.updateAccountAction(changed.id, 'pause');
          } else if (changed.requests_this_minute === 0 && changed.tokens_used_percent === 0) {
            await api.updateAccountAction(changed.id, 'reset');
          }
        }
      }

      await loadDashboard();
    } catch (error) {
      setAccounts(previousAccounts);
      toast.error((error as Error).message);
    }
  };

  const handleSettingsChange = async (nextSettings: PoolSettings) => {
    setSettings(nextSettings);
    try {
      await api.updateSettings(nextSettings);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const handleRotateNow = async () => {
    try {
      const account = await api.rotateNow();
      await loadDashboard();
      toast.success(`Rotated to ${account.account_id}`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const handlePauseAll = async () => {
    try {
      await api.pauseAll();
      await loadDashboard();
      toast.warning('All accounts paused');
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const handleHealthCheck = async () => {
    try {
      const result = await api.healthCheck();
      await loadDashboard();
      toast.success(`Health check completed for ${result.totalAccounts} accounts`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  if (loading || !settings) {
    return <div className="h-screen grid place-items-center text-sm text-muted-foreground">Loading dashboard...</div>;
  }

  return (
    <div className="h-screen flex flex-col">
      <Header
        activeAccount={currentAccount?.account_id || 'None'}
        mode={settings.mode}
        onModeChange={(mode) => handleSettingsChange({ ...settings, mode })}
      />
      <div className="flex-1 flex min-h-0">
        <LeftSidebar currentAccount={currentAccount} accounts={accounts} recentLogs={logs} />
        <AccountGrid accounts={accounts} onAccountsChange={handleAccountsChange} />
        <RightSidebar
          settings={settings}
          onSettingsChange={handleSettingsChange}
          onRotateNow={handleRotateNow}
          onPauseAll={handlePauseAll}
          onHealthCheck={handleHealthCheck}
        />
      </div>
    </div>
  );
};

export default Index;

import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { Account, AccountStatus } from '@/types';
import { AccountCard } from './AccountCard';
import { FilterBar } from './FilterBar';
import { AddAccountDialog } from './AddAccountDialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface AccountGridProps {
  accounts: Account[];
  onAccountsChange: (accounts: Account[]) => void;
}

export function AccountGrid({ accounts, onAccountsChange }: AccountGridProps) {
  const [filter, setFilter] = useState<AccountStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [clearingAll, setClearingAll] = useState(false);

  const activeCount = accounts.filter(a => a.status === 'active').length;

  const filtered = accounts.filter(a => {
    if (filter !== 'all' && a.status !== filter) return false;
    if (search && !a.account_id.toLowerCase().includes(search.toLowerCase()) && !a.email.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleSetActive = (id: string) => {
    onAccountsChange(accounts.map(a => ({ ...a, is_current: a.id === id, status: a.id === id ? 'active' as const : a.status === 'active' ? 'idle' as const : a.status })));
    toast.success('账号已设为当前活跃');
  };

  const handlePause = (id: string) => {
    onAccountsChange(accounts.map(a => a.id === id ? { ...a, status: 'idle' as const } : a));
    toast.info('账号已暂停');
  };

  const handleReset = (id: string) => {
    onAccountsChange(accounts.map(a => a.id === id ? { ...a, status: 'idle' as const, requests_this_minute: 0, tokens_used_percent: 0 } : a));
    toast.success('账号已重置');
  };

  const handleRemove = (id: string) => {
    onAccountsChange(accounts.filter(a => a.id !== id));
    toast.success('账号已删除');
  };

  const handleAccountAdded = (account: Account) => {
    onAccountsChange([...accounts, account]);
  };

  const handleClearAll = async () => {
    if (accounts.length === 0) {
      toast.info('没有账号可以清空');
      return;
    }
    const confirmed = window.confirm(`确定要删除全部 ${accounts.length} 个账号吗？此操作不可撤销。`);
    if (!confirmed) return;

    setClearingAll(true);
    try {
      await api.clearAllAccounts();
      onAccountsChange([]);
      toast.success('已清空所有账号');
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setClearingAll(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <FilterBar
        activeCount={activeCount}
        totalCount={accounts.length}
        selectedFilter={filter}
        onFilterChange={setFilter}
        searchQuery={search}
        onSearchChange={setSearch}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onRefresh={() => { setLastRefresh(new Date()); toast.info('Pool refreshed'); }}
        lastRefresh={lastRefresh}
        extraActions={
          accounts.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
              onClick={handleClearAll}
              disabled={clearingAll}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {clearingAll ? '清空中...' : '清空全部'}
            </Button>
          ) : null
        }
      />

      <div className={`flex-1 overflow-y-auto p-4 ${
        viewMode === 'grid'
          ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 auto-rows-max'
          : 'flex flex-col gap-3'
      }`}>
        <AnimatePresence mode="popLayout">
          {filtered.map(account => (
            <AccountCard
              key={account.id}
              account={account}
              onSetActive={handleSetActive}
              onPause={handlePause}
              onReset={handleReset}
              onRemove={handleRemove}
            />
          ))}
        </AnimatePresence>

        {/* Add Account Card */}
        <AddAccountDialog onAccountAdded={handleAccountAdded} />
      </div>
    </div>
  );
}

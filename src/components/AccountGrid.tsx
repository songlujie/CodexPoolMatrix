import { lazy, Suspense, useCallback, useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { PauseCircle, Plus, Trash2, Zap } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Account, LiveUsageData } from '@/types';
import { AccountCard } from './AccountCard';
import { FilterBar } from './FilterBar';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatAppError } from '@/lib/errors';
import { useI18n } from '@/lib/i18n';

const AddAccountDialog = lazy(async () => {
  const module = await import('./AddAccountDialog');
  return { default: module.AddAccountDialog };
});

const ABNORMAL_STATUSES = new Set(['error', 'rate_limited', 'cooldown']);
const ACCOUNT_GRID_FILTERS_KEY = 'cpm-account-grid-filters';
const STATUS_SORT_WEIGHT: Record<Account['status'], number> = {
  error: 0,
  rate_limited: 1,
  cooldown: 2,
  active: 3,
  idle: 4,
};

type ScopeFilter = 'all' | 'current' | 'abnormal';
type SortBy = 'name' | 'recent_request' | 'updated' | 'status';
type ViewMode = 'grid' | 'list';
type ProviderFilter = 'all' | 'oauth' | 'api';

interface PersistedAccountGridFilters {
  platformFilter: string | 'all';
  providerFilter: ProviderFilter;
  scopeFilter: ScopeFilter;
  sortBy: SortBy;
  search: string;
  viewMode: ViewMode;
}

const DEFAULT_ACCOUNT_GRID_FILTERS: PersistedAccountGridFilters = {
  platformFilter: 'all',
  providerFilter: 'all',
  scopeFilter: 'all',
  sortBy: 'name',
  search: '',
  viewMode: 'grid',
};

function readPersistedFilters(): PersistedAccountGridFilters | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(ACCOUNT_GRID_FILTERS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedAccountGridFilters>;
    const providerFilter: ProviderFilter = parsed.providerFilter === 'oauth' || parsed.providerFilter === 'api' ? parsed.providerFilter : 'all';
    const scopeFilter: ScopeFilter = parsed.scopeFilter === 'current' || parsed.scopeFilter === 'abnormal' ? parsed.scopeFilter : 'all';
    const sortBy: SortBy = parsed.sortBy === 'recent_request' || parsed.sortBy === 'updated' || parsed.sortBy === 'status' ? parsed.sortBy : 'name';
    const viewMode: ViewMode = parsed.viewMode === 'list' ? 'list' : 'grid';
    const platformFilter = typeof parsed.platformFilter === 'string' ? parsed.platformFilter : 'all';
    const search = typeof parsed.search === 'string' ? parsed.search : '';
    return { platformFilter, providerFilter, scopeFilter, sortBy, search, viewMode };
  } catch {
    return null;
  }
}

interface AccountGridProps {
  accounts: Account[];
  onAction: (action: 'setActive' | 'pause' | 'reset', id: string) => void;
  onRemove: (id: string) => Promise<void>;
  onAccountAdded: () => void;
  onClearAll: () => void;
  onCheckAllUsage?: (accountIds?: string[]) => void;
  onPauseAccounts?: (accountIds: string[]) => void;
  batchActionsDisabled?: boolean;
  refreshKey?: number;
  pushedUsageMap?: Record<string, LiveUsageData>;  // injected from parent after batch check
}

export function AccountGrid({
  accounts,
  onAction,
  onRemove,
  onAccountAdded,
  onClearAll,
  onCheckAllUsage,
  onPauseAccounts,
  batchActionsDisabled = false,
  refreshKey,
  pushedUsageMap,
}: AccountGridProps) {
  const [persistedFilters] = useState<PersistedAccountGridFilters | null>(() => readPersistedFilters());
  const [platformFilter, setPlatformFilter] = useState<string | 'all'>(persistedFilters?.platformFilter ?? DEFAULT_ACCOUNT_GRID_FILTERS.platformFilter);
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>(persistedFilters?.providerFilter ?? DEFAULT_ACCOUNT_GRID_FILTERS.providerFilter);
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>(persistedFilters?.scopeFilter ?? DEFAULT_ACCOUNT_GRID_FILTERS.scopeFilter);
  const [sortBy, setSortBy] = useState<SortBy>(persistedFilters?.sortBy ?? DEFAULT_ACCOUNT_GRID_FILTERS.sortBy);
  const [usageMap, setUsageMap] = useState<Record<string, LiveUsageData>>({});
  const [platforms, setPlatforms] = useState<string[]>(['gpt', 'gemini', 'claude']);
  const [search, setSearch] = useState(persistedFilters?.search ?? DEFAULT_ACCOUNT_GRID_FILTERS.search);
  const [viewMode, setViewMode] = useState<ViewMode>(persistedFilters?.viewMode ?? DEFAULT_ACCOUNT_GRID_FILTERS.viewMode);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [clearingAll, setClearingAll] = useState(false);
  const [addDialogRequested, setAddDialogRequested] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingApiAccount, setEditingApiAccount] = useState<Account | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useI18n();

  // Merge usage data pushed from parent (batch check from RightSidebar)
  useEffect(() => {
    if (pushedUsageMap && Object.keys(pushedUsageMap).length > 0) {
      setUsageMap(prev => ({ ...prev, ...pushedUsageMap }));
    }
  }, [pushedUsageMap]);

  useEffect(() => {
    api.listPlatforms()
      .then(setPlatforms)
      .catch(() => {/* keep defaults */});
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ACCOUNT_GRID_FILTERS_KEY, JSON.stringify({
      platformFilter,
      providerFilter,
      scopeFilter,
      sortBy,
      search,
      viewMode,
    }));
  }, [platformFilter, providerFilter, scopeFilter, sortBy, search, viewMode]);

  useEffect(() => {
    if (platformFilter !== 'all' && !platforms.includes(platformFilter)) {
      setPlatformFilter('all');
    }
  }, [platformFilter, platforms]);

  useEffect(() => {
    const accountFromQuery = searchParams.get('account');
    const providerFromQuery = searchParams.get('provider');
    if (!accountFromQuery && !providerFromQuery) return;

    if (accountFromQuery) {
      setSearch(accountFromQuery);
      setPlatformFilter('all');
      setScopeFilter('all');
    }

    if (providerFromQuery === 'api' || providerFromQuery === 'oauth') {
      setProviderFilter(providerFromQuery);
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('account');
      next.delete('provider');
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  const activeCount = accounts.filter(a => a.status === 'active').length;
  const currentCount = accounts.filter(a => a.is_current).length;
  const abnormalCount = accounts.filter(a => ABNORMAL_STATUSES.has(a.status)).length;
  const apiCount = accounts.filter(a => a.provider_mode === 'api').length;
  const oauthCount = accounts.filter(a => a.provider_mode !== 'api').length;
  const hasActiveFilters = platformFilter !== DEFAULT_ACCOUNT_GRID_FILTERS.platformFilter
    || providerFilter !== DEFAULT_ACCOUNT_GRID_FILTERS.providerFilter
    || scopeFilter !== DEFAULT_ACCOUNT_GRID_FILTERS.scopeFilter
    || sortBy !== DEFAULT_ACCOUNT_GRID_FILTERS.sortBy
    || search !== DEFAULT_ACCOUNT_GRID_FILTERS.search
    || viewMode !== DEFAULT_ACCOUNT_GRID_FILTERS.viewMode;

  const filtered = accounts.filter(a => {
    if (platformFilter !== 'all' && (a.platform || 'gpt') !== platformFilter) return false;
    if (providerFilter === 'api' && a.provider_mode !== 'api') return false;
    if (providerFilter === 'oauth' && a.provider_mode === 'api') return false;
    if (scopeFilter === 'current' && !a.is_current) return false;
    if (scopeFilter === 'abnormal' && !ABNORMAL_STATUSES.has(a.status)) return false;
    if (search && !a.account_id.toLowerCase().includes(search.toLowerCase()) && !a.email.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    if (sortBy === 'recent_request') {
      return new Date(b.last_request_at || 0).getTime() - new Date(a.last_request_at || 0).getTime();
    }
    if (sortBy === 'updated') {
      return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
    }
    if (sortBy === 'status') {
      const weightDiff = STATUS_SORT_WEIGHT[a.status] - STATUS_SORT_WEIGHT[b.status];
      if (weightDiff !== 0) return weightDiff;
    }
    return a.account_id.localeCompare(b.account_id, 'zh-CN');
  });

  const handleSetActive = (id: string) => {
    onAction('setActive', id);
    toast.success(t('toast.accountActive'));
  };

  const handlePause = (id: string) => {
    onAction('pause', id);
    toast.info(t('toast.accountPaused'));
  };

  const handleReset = (id: string) => {
    onAction('reset', id);
    toast.success(t('toast.accountReset'));
  };

  const handleRemove = async (id: string) => {
    const target = accounts.find((account) => account.id === id);
    if (target?.is_current) {
      toast.warning(t('toast.accountCurrentCannotDelete'));
      return;
    }

    await onRemove(id);
    toast.success(t('toast.accountRemoved'));
  };

  const handleClearAll = async () => {
    if (accounts.length === 0) {
      toast.info(t('toast.noAccountsToClear'));
      return;
    }
    const confirmed = window.confirm(t('toast.confirmClear', { count: accounts.length }));
    if (!confirmed) return;

    setClearingAll(true);
    try {
      await onClearAll();
    } finally {
      setClearingAll(false);
    }
  };

  const handleAddPlatform = async (name: string) => {
    try {
      const updated = await api.addPlatform(name);
      setPlatforms(updated);
      toast.success(t('toast.platformAdded', { name }));
    } catch (e) {
      toast.error(formatAppError(e, t('filter.error.addPlatformFailed')));
    }
  };

  const handleUsageUpdate = useCallback((id: string, usage: LiveUsageData) => {
    setUsageMap(prev => ({ ...prev, [id]: usage }));
  }, []);

  const handleEditApiAccount = useCallback((account: Account) => {
    setAddDialogRequested(true);
    setAddDialogOpen(false);
    setEditingApiAccount(account);
  }, []);

  const handleResetFilters = () => {
    setPlatformFilter(DEFAULT_ACCOUNT_GRID_FILTERS.platformFilter);
    setProviderFilter(DEFAULT_ACCOUNT_GRID_FILTERS.providerFilter);
    setScopeFilter(DEFAULT_ACCOUNT_GRID_FILTERS.scopeFilter);
    setSortBy(DEFAULT_ACCOUNT_GRID_FILTERS.sortBy);
    setSearch(DEFAULT_ACCOUNT_GRID_FILTERS.search);
    setViewMode(DEFAULT_ACCOUNT_GRID_FILTERS.viewMode);
    toast.info(t('toast.filtersReset'));
  };

  const scopeCards = [
    {
      key: 'total',
      label: t('dashboard.summary.totalAccounts'),
      value: accounts.length,
      active: scopeFilter === 'all' && providerFilter === 'all',
      onClick: () => {
        setScopeFilter('all');
        setProviderFilter('all');
      },
    },
    {
      key: 'current',
      label: t('dashboard.summary.currentAccounts'),
      value: currentCount,
      active: scopeFilter === 'current',
      onClick: () => setScopeFilter('current'),
    },
    {
      key: 'abnormal',
      label: t('dashboard.summary.abnormalAccounts'),
      value: abnormalCount,
      active: scopeFilter === 'abnormal',
      onClick: () => setScopeFilter('abnormal'),
    },
  ];

  const providerCards = [
    {
      key: 'api',
      label: t('dashboard.summary.apiAccounts'),
      value: apiCount,
      active: providerFilter === 'api',
      onClick: () => setProviderFilter('api'),
    },
    {
      key: 'oauth',
      label: t('dashboard.summary.oauthAccounts'),
      value: oauthCount,
      active: providerFilter === 'oauth',
      onClick: () => setProviderFilter('oauth'),
    },
  ];

  const handleOpenAddDialog = () => {
    setEditingApiAccount(null);
    setAddDialogRequested(true);
    setAddDialogOpen(true);
  };

  const handleDeletePlatform = async (name: string) => {
    try {
      const updated = await api.deletePlatform(name);
      setPlatforms(updated);
      if (platformFilter === name) setPlatformFilter('all');
      toast.success(t('toast.platformDeleted', { name }));
    } catch (e) {
      toast.error(formatAppError(e, t('filter.error.deletePlatformFailed')));
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div className="border-b border-border/50 bg-gradient-to-b from-background via-background to-secondary/10 px-4 py-2">
        <div className="flex flex-wrap gap-2.5">
          {[
            { key: 'scope', title: t('dashboard.summary.groupScope'), cards: scopeCards },
            { key: 'provider', title: t('dashboard.summary.groupProvider'), cards: providerCards },
          ].map((group) => (
            <section key={group.key} className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/40 px-2.5 py-2">
              <div className="pr-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{group.title}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {group.cards.map((card) => (
                  <button
                    key={card.key}
                    type="button"
                    onClick={card.onClick}
                    className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-left transition-all duration-200 ${
                      card.active
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border/60 bg-background/70 text-muted-foreground hover:border-border hover:bg-card hover:text-foreground'
                    }`}
                  >
                    <span className="text-[11px] font-medium">{card.label}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                      card.active
                        ? 'bg-primary/15 text-primary'
                        : 'bg-secondary/70 text-foreground/80'
                    }`}>
                      {card.value}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
      <FilterBar
        activeCount={activeCount}
        totalCount={accounts.length}
        filteredCount={filtered.length}
        selectedPlatform={platformFilter}
        onPlatformChange={setPlatformFilter}
        providerFilter={providerFilter}
        onProviderFilterChange={setProviderFilter}
        scopeFilter={scopeFilter}
        onScopeFilterChange={setScopeFilter}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        platforms={platforms}
        onAddPlatform={handleAddPlatform}
        onDeletePlatform={handleDeletePlatform}
        searchQuery={search}
        onSearchChange={setSearch}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onRefresh={() => { setLastRefresh(new Date()); toast.info(t('toast.poolRefreshed')); }}
        onResetFilters={handleResetFilters}
        hasActiveFilters={hasActiveFilters}
        lastRefresh={lastRefresh}
        extraActions={
          accounts.length > 0 ? (
            <div className="flex items-center gap-1">
              {onCheckAllUsage ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1.5 text-primary hover:text-primary hover:bg-primary/10"
                  onClick={() => onCheckAllUsage(filtered.map((account) => account.id))}
                  disabled={batchActionsDisabled || filtered.length === 0}
                >
                  <Zap className="h-3 w-3" />
                  {filtered.length !== accounts.length ? t('filter.checkFiltered') : t('filter.checkAll')}
                </Button>
              ) : null}
              {onPauseAccounts ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1.5 text-warning hover:text-warning hover:bg-warning/10"
                  onClick={() => onPauseAccounts(filtered.map((account) => account.id))}
                  disabled={batchActionsDisabled || filtered.length === 0}
                >
                  <PauseCircle className="h-3 w-3" />
                  {filtered.length !== accounts.length ? t('filter.pauseFiltered') : t('filter.pauseAllVisible')}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
                onClick={handleClearAll}
                disabled={clearingAll || batchActionsDisabled}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {clearingAll ? t('filter.clearing') : t('filter.clearAll')}
              </Button>
            </div>
          ) : null
        }
      />

      <div className={`flex-1 overflow-y-auto p-4 ${
        viewMode === 'grid'
          ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 auto-rows-max'
          : 'flex flex-col gap-1.5'
      }`}>
        {filtered.length === 0 ? (
          <div className="col-span-full grid place-items-center rounded-2xl border border-dashed border-border/60 bg-card/30 px-6 py-14 text-center">
            <div>
              <p className="text-sm font-medium text-foreground">{t('filter.emptyTitle')}</p>
              <p className="mt-2 text-xs text-muted-foreground">{t('filter.emptyHint')}</p>
            </div>
          </div>
        ) : null}
        <AnimatePresence mode="popLayout">
          {filtered.map(account => (
            <AccountCard
              key={account.id}
              account={account}
              onSetActive={handleSetActive}
              onPause={handlePause}
              onReset={handleReset}
              onRemove={handleRemove}
              onEditApiAccount={handleEditApiAccount}
              refreshKey={refreshKey}
              viewMode={viewMode}
              externalUsage={usageMap[account.id] ?? null}
              onUsageUpdate={handleUsageUpdate}
            />
          ))}
        </AnimatePresence>

        {/* Add Account Card */}
        <button
          onClick={handleOpenAddDialog}
          onMouseEnter={() => setAddDialogRequested(true)}
          className="min-h-[220px] rounded-xl border-2 border-dashed border-border/50 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all"
        >
          <Plus className="h-8 w-8" />
          <span className="text-xs font-medium">{t('card.addAccount')}</span>
        </button>

        {addDialogRequested && (
          <Suspense fallback={null}>
            <AddAccountDialog
              hideTrigger
              open={addDialogOpen}
              onOpenChange={setAddDialogOpen}
              onAccountAdded={onAccountAdded}
              platforms={platforms}
            />
            <AddAccountDialog
              hideTrigger
              open={Boolean(editingApiAccount)}
              onOpenChange={(open) => {
                if (!open) setEditingApiAccount(null);
              }}
              onAccountAdded={() => {
                setEditingApiAccount(null);
                onAccountAdded();
              }}
              platforms={platforms}
              editingAccount={editingApiAccount}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}

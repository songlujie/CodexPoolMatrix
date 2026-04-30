import React, { useState, useRef, useEffect } from 'react';
import { Search, RefreshCw, LayoutGrid, List, Plus, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useI18n } from '@/lib/i18n';

const PLATFORM_LABELS: Record<string, string> = {
  gpt: 'GPT',
  gemini: 'Gemini',
};

interface FilterBarProps {
  activeCount: number;
  totalCount: number;
  filteredCount: number;
  selectedPlatform: string | 'all';
  onPlatformChange: (platform: string | 'all') => void;
  providerFilter: 'all' | 'oauth' | 'api';
  onProviderFilterChange: (provider: 'all' | 'oauth' | 'api') => void;
  scopeFilter: 'all' | 'current' | 'abnormal';
  onScopeFilterChange: (scope: 'all' | 'current' | 'abnormal') => void;
  sortBy: 'name' | 'recent_request' | 'updated' | 'status';
  onSortByChange: (value: 'name' | 'recent_request' | 'updated' | 'status') => void;
  platforms: string[];
  onAddPlatform: (name: string) => void;
  onDeletePlatform: (name: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
  onRefresh: () => void;
  onResetFilters?: () => void;
  hasActiveFilters?: boolean;
  lastRefresh: Date;
  extraActions?: React.ReactNode;
}

export function FilterBar({
  activeCount, totalCount, filteredCount, selectedPlatform, onPlatformChange,
  providerFilter, onProviderFilterChange,
  scopeFilter, onScopeFilterChange, sortBy, onSortByChange,
  platforms, onAddPlatform, onDeletePlatform,
  searchQuery, onSearchChange, viewMode, onViewModeChange, onRefresh, onResetFilters, hasActiveFilters, lastRefresh, extraActions,
}: FilterBarProps) {
  const { t } = useI18n();
  const [addingPlatform, setAddingPlatform] = useState(false);
  const [newPlatformName, setNewPlatformName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addingPlatform && inputRef.current) {
      inputRef.current.focus();
    }
  }, [addingPlatform]);

  const handleAddConfirm = () => {
    const clean = newPlatformName.trim();
    if (clean) {
      onAddPlatform(clean);
    }
    setNewPlatformName('');
    setAddingPlatform(false);
  };

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAddConfirm();
    if (e.key === 'Escape') {
      setNewPlatformName('');
      setAddingPlatform(false);
    }
  };

  const platformLabel = (p: string) => PLATFORM_LABELS[p] || (p.charAt(0).toUpperCase() + p.slice(1));

  return (
    <div className="flex flex-col gap-3 border-b border-border/50 p-4">
      <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Badge variant="outline" className="h-5 text-[10px] text-primary border-primary/30 bg-primary/5">
          {t('filter.active')}: {activeCount} / {totalCount}
          </Badge>
          {filteredCount !== totalCount ? (
            <Badge variant="outline" className="h-5 text-[10px] text-muted-foreground border-border/60 bg-secondary/30">
              {t('filter.filteredCount', { count: filteredCount })}
            </Badge>
          ) : null}
        </div>

        <div className="min-w-0 overflow-x-auto pb-1">
          <div className="flex min-w-max items-center gap-1">
            <button
              onClick={() => onPlatformChange('all')}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                selectedPlatform === 'all'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
              }`}
            >
              {t('filter.allPlatforms')}
            </button>

            {platforms.map(p => (
              <div key={p} className="group relative flex items-center">
                <button
                  onClick={() => onPlatformChange(p)}
                  className={`rounded-md px-2.5 py-1 pr-5 text-[11px] font-medium transition-colors ${
                    selectedPlatform === p
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                  }`}
                >
                  {platformLabel(p)}
                </button>
                {!['gpt', 'gemini', 'claude'].includes(p) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeletePlatform(p); }}
                    className="absolute right-0.5 top-1/2 flex h-3.5 w-3.5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            ))}

            {addingPlatform ? (
              <div className="flex items-center gap-1">
                <Input
                  ref={inputRef}
                  value={newPlatformName}
                  onChange={e => setNewPlatformName(e.target.value)}
                  onKeyDown={handleAddKeyDown}
                  onBlur={handleAddConfirm}
                  placeholder={t('filter.platformNamePlaceholder')}
                  className="h-6 w-24 bg-input px-2 text-[11px] border-border/50"
                />
              </div>
            ) : (
              <button
                onClick={() => setAddingPlatform(true)}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
                title={t('filter.addPlatform')}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={providerFilter} onValueChange={(value) => onProviderFilterChange(value as 'all' | 'oauth' | 'api')}>
          <SelectTrigger className="h-7 w-[calc(50%-0.25rem)] min-w-[140px] text-xs bg-input border-border/50 sm:w-32">
            <SelectValue placeholder={t('filter.provider')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('filter.provider.all')}</SelectItem>
            <SelectItem value="oauth">{t('filter.provider.oauth')}</SelectItem>
            <SelectItem value="api">{t('filter.provider.api')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={scopeFilter} onValueChange={(value) => onScopeFilterChange(value as 'all' | 'current' | 'abnormal')}>
          <SelectTrigger className="h-7 w-[calc(50%-0.25rem)] min-w-[140px] text-xs bg-input border-border/50 sm:w-32">
            <SelectValue placeholder={t('filter.scope')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('filter.scope.all')}</SelectItem>
            <SelectItem value="current">{t('filter.scope.current')}</SelectItem>
            <SelectItem value="abnormal">{t('filter.scope.abnormal')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(value) => onSortByChange(value as 'name' | 'recent_request' | 'updated' | 'status')}>
          <SelectTrigger className="h-7 w-[calc(50%-0.25rem)] min-w-[140px] text-xs bg-input border-border/50 sm:w-36">
            <SelectValue placeholder={t('filter.sort')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">{t('filter.sort.name')}</SelectItem>
            <SelectItem value="recent_request">{t('filter.sort.recentRequest')}</SelectItem>
            <SelectItem value="updated">{t('filter.sort.updated')}</SelectItem>
            <SelectItem value="status">{t('filter.sort.status')}</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative w-full min-w-0 sm:ml-auto sm:w-[240px] lg:w-[280px] xl:w-[320px] xl:max-w-[320px] xl:flex-none">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('filter.search')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-7 w-full bg-input pl-8 text-xs border-border/50"
          />
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2 max-sm:w-full max-sm:ml-0">
          <div className="flex overflow-hidden rounded-md border border-border/50">
            <button
              onClick={() => onViewModeChange('grid')}
              className={`p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onViewModeChange('list')}
              className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={onRefresh}>
            <RefreshCw className="mr-1.5 h-3 w-3" />
            {t('filter.refresh')}
          </Button>
          {onResetFilters ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs shrink-0"
              onClick={onResetFilters}
              disabled={!hasActiveFilters}
            >
              <RotateCcw className="mr-1.5 h-3 w-3" />
              {t('filter.reset')}
            </Button>
          ) : null}
          {extraActions}
        </div>
      </div>
    </div>
  );
}

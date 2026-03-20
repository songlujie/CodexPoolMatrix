import { useState } from 'react';
import React from 'react';
import { Search, RefreshCw, LayoutGrid, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { AccountStatus } from '@/types';

interface FilterBarProps {
  activeCount: number;
  totalCount: number;
  selectedFilter: AccountStatus | 'all';
  onFilterChange: (filter: AccountStatus | 'all') => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
  onRefresh: () => void;
  lastRefresh: Date;
  extraActions?: React.ReactNode;
}

const filters: { label: string; value: AccountStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Idle', value: 'idle' },
  { label: 'Error', value: 'error' },
  { label: 'Rate Limited', value: 'rate_limited' },
  { label: 'Cooldown', value: 'cooldown' },
];

export function FilterBar({
  activeCount, totalCount, selectedFilter, onFilterChange,
  searchQuery, onSearchChange, viewMode, onViewModeChange, onRefresh, lastRefresh, extraActions,
}: FilterBarProps) {
  return (
    <div className="flex items-center justify-between gap-3 p-4 border-b border-border/50 flex-wrap">
      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant="outline" className="text-primary border-primary/30 bg-primary/5 text-[10px] h-5">
          活跃: {activeCount} / {totalCount}
        </Badge>
        <div className="flex gap-1">
          {filters.map(f => (
            <button
              key={f.value}
              onClick={() => onFilterChange(f.value)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                selectedFilter === f.value
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search profiles..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-7 w-48 pl-8 text-xs bg-input border-border/50"
          />
        </div>
        <div className="flex border border-border/50 rounded-md overflow-hidden">
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
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onRefresh}>
          <RefreshCw className="h-3 w-3 mr-1.5" />
          Refresh Pool
        </Button>
        {extraActions}
      </div>
    </div>
  );
}

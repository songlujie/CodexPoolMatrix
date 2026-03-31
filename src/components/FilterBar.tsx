import React, { useState, useRef, useEffect } from 'react';
import { Search, RefreshCw, LayoutGrid, List, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/lib/i18n';

const PLATFORM_LABELS: Record<string, string> = {
  gpt: 'GPT',
  gemini: 'Gemini',
  claude: 'Claude',
};

interface FilterBarProps {
  activeCount: number;
  totalCount: number;
  selectedPlatform: string | 'all';
  onPlatformChange: (platform: string | 'all') => void;
  platforms: string[];
  onAddPlatform: (name: string) => void;
  onDeletePlatform: (name: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;
  onRefresh: () => void;
  lastRefresh: Date;
  extraActions?: React.ReactNode;
}

export function FilterBar({
  activeCount, totalCount, selectedPlatform, onPlatformChange,
  platforms, onAddPlatform, onDeletePlatform,
  searchQuery, onSearchChange, viewMode, onViewModeChange, onRefresh, lastRefresh, extraActions,
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
    <div className="flex items-center justify-between gap-3 p-4 border-b border-border/50 flex-wrap">
      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant="outline" className="text-primary border-primary/30 bg-primary/5 text-[10px] h-5">
          {t('filter.active')}: {activeCount} / {totalCount}
        </Badge>
        <div className="flex items-center gap-1 flex-wrap">
          {/* All tab */}
          <button
            onClick={() => onPlatformChange('all')}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
              selectedPlatform === 'all'
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            All
          </button>

          {/* Platform tabs */}
          {platforms.map(p => (
            <div key={p} className="flex items-center group relative">
              <button
                onClick={() => onPlatformChange(p)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors pr-5 ${
                  selectedPlatform === p
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                {platformLabel(p)}
              </button>
              {/* Delete button — only for non-default platforms */}
              {!['gpt', 'gemini', 'claude'].includes(p) && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDeletePlatform(p); }}
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity h-3.5 w-3.5 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          ))}

          {/* Add platform */}
          {addingPlatform ? (
            <div className="flex items-center gap-1">
              <Input
                ref={inputRef}
                value={newPlatformName}
                onChange={e => setNewPlatformName(e.target.value)}
                onKeyDown={handleAddKeyDown}
                onBlur={handleAddConfirm}
                placeholder="平台名..."
                className="h-6 w-24 text-[11px] px-2 bg-input border-border/50"
              />
            </div>
          ) : (
            <button
              onClick={() => setAddingPlatform(true)}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              title="添加平台"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={t('filter.search')}
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
          {t('filter.refresh')}
        </Button>
        {extraActions}
      </div>
    </div>
  );
}

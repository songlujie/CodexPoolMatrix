import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatAppError } from '@/lib/errors';
import { useI18n } from '@/lib/i18n';
import { type ModelCallLog } from '@/types';

const DAY_OPTIONS = [1, 3, 7, 14, 30] as const;
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const MODEL_CALL_FETCH_LIMIT = 500;
const MODEL_CALLS_PAGE_STATE_KEY = 'cpm-model-calls-page-state';
const numberFormatter = new Intl.NumberFormat('en-US');
const DAY_LABEL_KEYS = {
  1: 'modelCalls.days.1',
  3: 'modelCalls.days.3',
  7: 'modelCalls.days.7',
  14: 'modelCalls.days.14',
  30: 'modelCalls.days.30',
} as const;

function formatNumber(value: number) {
  return numberFormatter.format(value || 0);
}

function translateReason(t: ReturnType<typeof useI18n>['t'], reason: string | null) {
  switch (reason) {
    case 'sessions_dir_not_found':
      return t('modelCalls.reason.sessions_dir_not_found');
    case 'no_model_calls_found':
      return t('modelCalls.reason.no_model_calls_found');
    default:
      return t('modelCalls.empty');
  }
}

interface PersistedModelCallsPageState {
  days: string;
  pageSize: string;
  searchQuery: string;
  cwdFilter: string;
  providerFilter: string;
}

function readPersistedModelCallsPageState(): PersistedModelCallsPageState | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(MODEL_CALLS_PAGE_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedModelCallsPageState>;
    return {
      days: typeof parsed.days === 'string' ? parsed.days : '7',
      pageSize: typeof parsed.pageSize === 'string' ? parsed.pageSize : '50',
      searchQuery: typeof parsed.searchQuery === 'string' ? parsed.searchQuery : '',
      cwdFilter: typeof parsed.cwdFilter === 'string' ? parsed.cwdFilter : 'all',
      providerFilter: typeof parsed.providerFilter === 'string' ? parsed.providerFilter : 'all',
    };
  } catch {
    return null;
  }
}

function summarizeItems(items: ModelCallLog[]) {
  return items.reduce((summary, item) => ({
    total_calls: summary.total_calls + 1,
    input_tokens: summary.input_tokens + item.input_tokens,
    cached_input_tokens: summary.cached_input_tokens + item.cached_input_tokens,
    output_tokens: summary.output_tokens + item.output_tokens,
    total_tokens: summary.total_tokens + item.total_tokens,
  }), {
    total_calls: 0,
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  });
}

const ModelCallsPage = () => {
  const [persistedState] = useState<PersistedModelCallsPageState | null>(() => readPersistedModelCallsPageState());
  const [days, setDays] = useState<string>(persistedState?.days ?? '7');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<string>(persistedState?.pageSize ?? '50');
  const [searchQuery, setSearchQuery] = useState(persistedState?.searchQuery ?? '');
  const [cwdFilter, setCwdFilter] = useState(persistedState?.cwdFilter ?? 'all');
  const [providerFilter, setProviderFilter] = useState(persistedState?.providerFilter ?? 'all');
  const navigate = useNavigate();
  const { t } = useI18n();
  const modelCallsQuery = useQuery({
    queryKey: ['model-calls', Number(days), MODEL_CALL_FETCH_LIMIT],
    queryFn: () => api.listModelCalls({
      days: Number(days),
      limit: MODEL_CALL_FETCH_LIMIT,
    }),
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });
  const modelCalls = modelCallsQuery.data || null;
  const filteredItems = (modelCalls?.items || []).filter((item) => {
    if (cwdFilter !== 'all' && (item.cwd || '') !== cwdFilter) return false;
    if (providerFilter !== 'all' && (item.model_provider || 'unknown') !== providerFilter) return false;
    if (!searchQuery.trim()) return true;
    const search = searchQuery.toLowerCase();
    return [
      item.display_account_name || '',
      item.model || '',
      item.model_provider || '',
      item.phase || '',
      item.summary || '',
      item.session_id,
      item.cwd || '',
    ].some((value) => value.toLowerCase().includes(search));
  });
  const providerOptions = Array.from(new Set(
    (modelCalls?.items || [])
      .map((item) => item.model_provider || 'unknown')
      .filter(Boolean),
  )).sort((a, b) => a.localeCompare(b, 'en'));
  const visibleSummary = summarizeItems(filteredItems);
  const hasActiveFilters = Boolean(searchQuery.trim()) || cwdFilter !== 'all' || providerFilter !== 'all';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MODEL_CALLS_PAGE_STATE_KEY, JSON.stringify({
      days,
      pageSize,
      searchQuery,
      cwdFilter,
      providerFilter,
    }));
  }, [cwdFilter, days, pageSize, providerFilter, searchQuery]);

  useEffect(() => {
    if (cwdFilter !== 'all' && !modelCalls?.available_cwds.includes(cwdFilter)) {
      setCwdFilter('all');
    }
  }, [cwdFilter, modelCalls?.available_cwds]);

  useEffect(() => {
    if (providerFilter !== 'all' && !providerOptions.includes(providerFilter)) {
      setProviderFilter('all');
    }
  }, [providerFilter, providerOptions]);

  if (modelCallsQuery.isLoading || !modelCalls) {
    return <div className="flex-1 grid place-items-center text-sm text-muted-foreground">{t('loading.modelCalls')}</div>;
  }

  const numericPageSize = Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / numericPageSize));
  const safePage = Math.min(page, totalPages);
  const pagedItems = filteredItems.slice((safePage - 1) * numericPageSize, safePage * numericPageSize);
  const handleExport = () => {
    const payload = {
      exported_at: new Date().toISOString(),
      days: Number(days),
      cwd: cwdFilter === 'all' ? null : cwdFilter,
      provider: providerFilter === 'all' ? null : providerFilter,
      search: searchQuery.trim() || null,
      total: filteredItems.length,
      items: filteredItems,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'model-calls-export.json';
    link.click();
    URL.revokeObjectURL(url);
    toast.success(t('modelCalls.toast.exported', { count: formatNumber(filteredItems.length) }));
  };

  const summaryCards = [
    { key: 'calls', label: t('modelCalls.totalCalls'), value: formatNumber(visibleSummary.total_calls) },
    { key: 'input', label: t('modelCalls.inputTokens'), value: formatNumber(visibleSummary.input_tokens) },
    { key: 'cached', label: t('modelCalls.cachedTokens'), value: formatNumber(visibleSummary.cached_input_tokens) },
    { key: 'output', label: t('modelCalls.outputTokens'), value: formatNumber(visibleSummary.output_tokens) },
    { key: 'total', label: t('modelCalls.totalTokens'), value: formatNumber(visibleSummary.total_tokens) },
  ];

  return (
    <div className="flex-1 min-w-0 overflow-hidden bg-background/40">
      <div className="flex h-full flex-col">
        <div className="border-b border-border/50 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{t('modelCalls.title')}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t('modelCalls.subtitle')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setPage(1);
                }}
                placeholder={t('modelCalls.search')}
                className="mt-5 h-8 w-56 text-xs bg-input border-border/50"
              />
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">{t('modelCalls.cwd')}</Label>
                <Select value={cwdFilter} onValueChange={(value) => {
                  setCwdFilter(value);
                  setPage(1);
                }}>
                  <SelectTrigger className="h-8 w-48 text-xs bg-input border-border/50">
                    <SelectValue placeholder={t('modelCalls.cwd')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('modelCalls.cwd.all')}</SelectItem>
                    {modelCalls.available_cwds.map((cwd) => (
                      <SelectItem key={cwd} value={cwd}>
                        {cwd}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">{t('modelCalls.provider')}</Label>
                <Select value={providerFilter} onValueChange={(value) => {
                  setProviderFilter(value);
                  setPage(1);
                }}>
                  <SelectTrigger className="h-8 w-36 text-xs bg-input border-border/50">
                    <SelectValue placeholder={t('modelCalls.provider')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('modelCalls.provider.all')}</SelectItem>
                    {providerOptions.map((provider) => (
                      <SelectItem key={provider} value={provider}>
                        {provider}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">{t('modelCalls.days')}</Label>
                <Select value={days} onValueChange={(value) => {
                  setDays(value);
                  setPage(1);
                }}>
                  <SelectTrigger className="h-8 w-32 text-xs bg-input border-border/50">
                    <SelectValue />
                  </SelectTrigger>
                    <SelectContent>
                      {DAY_OPTIONS.map((option) => (
                        <SelectItem key={option} value={String(option)}>
                          {t(DAY_LABEL_KEYS[option])}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-5 h-8 text-xs"
                onClick={handleExport}
                disabled={filteredItems.length === 0}
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                {t('modelCalls.export')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="mt-5 h-8 text-xs"
                onClick={() => modelCallsQuery.refetch().catch((error: Error) => toast.error(formatAppError(error, t('modelCalls.error.refreshFailed'))))}
                disabled={modelCallsQuery.isFetching}
              >
                <RefreshCw className={`mr-1 h-3.5 w-3.5 ${modelCallsQuery.isFetching ? 'animate-spin' : ''}`} />
                {t('modelCalls.refresh')}
              </Button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-5 gap-3">
            {summaryCards.map((card) => (
              <div key={card.key} className="rounded-xl border border-border/60 bg-card/70 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{card.label}</p>
                <p className="mt-2 text-xl font-semibold tabular-nums text-foreground">{card.value}</p>
              </div>
            ))}
          </div>
          {hasActiveFilters ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px] font-normal">
                {t('modelCalls.filteredSummary')}
              </Badge>
              {cwdFilter !== 'all' ? (
                <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px] font-normal">
                  {t('modelCalls.cwd')} · {cwdFilter}
                </Badge>
              ) : null}
              {providerFilter !== 'all' ? (
                <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px] font-normal">
                  {t('modelCalls.provider')} · {providerFilter}
                </Badge>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex-1 min-h-0 px-5 py-4">
          {modelCalls.items.length === 0 ? (
            <div className="grid h-full place-items-center rounded-2xl border border-dashed border-border/60 bg-card/30">
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">{t('modelCalls.empty')}</p>
                <p className="mt-1 text-xs text-muted-foreground">{translateReason(t, modelCalls.reason)}</p>
              </div>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="grid h-full place-items-center rounded-2xl border border-dashed border-border/60 bg-card/30">
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">{t('modelCalls.emptyFiltered')}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('modelCalls.searchHint')}</p>
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/60">
              <div className="shrink-0 flex items-center justify-between border-b border-border/50 px-4 py-2 text-[11px] text-muted-foreground">
                <span>
                  {t('modelCalls.pageSummary', {
                    page: safePage,
                    total: totalPages,
                    count: formatNumber(filteredItems.length),
                  })}
                </span>
                {filteredItems.length !== modelCalls.items.length ? (
                  <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px] font-normal">
                    {t('modelCalls.filteredCount', {
                      count: formatNumber(filteredItems.length),
                      total: formatNumber(modelCalls.items.length),
                    })}
                  </Badge>
                ) : null}
              </div>
              <div className="flex-1 min-h-0 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50 hover:bg-transparent">
                      <TableHead className="text-xs text-muted-foreground">{t('modelCalls.time')}</TableHead>
                      <TableHead className="text-xs text-muted-foreground">{t('modelCalls.project')}</TableHead>
                      <TableHead className="text-xs text-muted-foreground">{t('modelCalls.model')}</TableHead>
                      <TableHead className="text-right text-xs text-muted-foreground">{t('modelCalls.inputTokens')}</TableHead>
                      <TableHead className="text-right text-xs text-muted-foreground">{t('modelCalls.cachedTokens')}</TableHead>
                      <TableHead className="text-right text-xs text-muted-foreground">{t('modelCalls.outputTokens')}</TableHead>
                      <TableHead className="text-right text-xs text-muted-foreground">{t('modelCalls.totalTokens')}</TableHead>
                      <TableHead className="text-xs text-muted-foreground">{t('modelCalls.summary')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedItems.map((item) => (
                      <TableRow key={item.id} className="border-border/50 text-xs">
                        <TableCell className="align-top">
                          <div className="space-y-1">
                            <p className="tabular-nums text-foreground">
                              {item.timestamp ? new Date(item.timestamp).toLocaleString('zh-CN', { hour12: false }) : '—'}
                            </p>
                            <p className="text-[10px] text-muted-foreground">{item.turn_index ? `T${item.turn_index}` : '—'}</p>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="space-y-1">
                            {item.display_account_name ? (
                              <button
                                type="button"
                                onClick={() => navigate(`/?account=${encodeURIComponent(item.display_account_name || '')}`)}
                                className="text-left text-foreground hover:underline"
                                title={t('common.openInDashboard')}
                              >
                                {item.display_account_name}
                              </button>
                            ) : (
                              <p className="text-foreground">—</p>
                            )}
                            <p className="text-[10px] text-muted-foreground">{item.cwd || item.phase || '—'}</p>
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="space-y-1">
                            <Badge variant="outline" className="text-[10px] font-medium">
                              {item.model || item.model_provider || 'unknown'}
                            </Badge>
                            <p className="text-[10px] text-muted-foreground">{item.model_provider || '—'}</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums align-top">{formatNumber(item.input_tokens)}</TableCell>
                        <TableCell className="text-right tabular-nums align-top">{formatNumber(item.cached_input_tokens)}</TableCell>
                        <TableCell className="text-right tabular-nums align-top">{formatNumber(item.output_tokens)}</TableCell>
                        <TableCell className="text-right tabular-nums align-top">
                          <div>
                            <p>{formatNumber(item.total_tokens)}</p>
                            {item.reasoning_output_tokens > 0 && (
                              <p className="text-[10px] text-muted-foreground">R {formatNumber(item.reasoning_output_tokens)}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[360px] align-top">
                          <div className="space-y-1">
                            <p className="break-words text-foreground/85">{item.summary || '—'}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {t('modelCalls.source')} · {item.session_id.slice(0, 8)}
                              {item.model_context_window ? ` · ${t('modelCalls.contextWindow')} ${formatNumber(item.model_context_window)}` : ''}
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="shrink-0 flex items-center justify-between border-t border-border/50 px-4 py-3 text-xs text-muted-foreground">
                <span>
                  {t('modelCalls.pageSummary', {
                    page: safePage,
                    total: totalPages,
                    count: formatNumber(filteredItems.length),
                  })}
                </span>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2">
                    <span>{t('common.perPage')}</span>
                    <Select value={pageSize} onValueChange={(value) => {
                      setPageSize(value);
                      setPage(1);
                    }}>
                      <SelectTrigger className="h-7 w-24 text-xs bg-input border-border/50">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PAGE_SIZE_OPTIONS.map((option) => (
                          <SelectItem key={option} value={String(option)}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setPage(1)}
                    disabled={safePage <= 1}
                  >
                    {t('common.firstPage')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={safePage <= 1}
                  >
                    {t('common.prevPage')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    disabled={safePage >= totalPages}
                  >
                    {t('common.nextPage')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ModelCallsPage;

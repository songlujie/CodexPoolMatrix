import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Task, TaskStatus, Priority } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckCheck, Plus, RefreshCw, RotateCcw, RotateCw, XCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatAppError } from '@/lib/errors';
import { useI18n } from '@/lib/i18n';
import { useAppShell } from '@/components/app-shell-context';

const statusBadge: Record<TaskStatus, { labelKey: 'tasks.status.queued' | 'tasks.status.running' | 'tasks.status.completed' | 'tasks.status.failed' | 'tasks.status.retrying'; className: string }> = {
  queued: { labelKey: 'tasks.status.queued', className: 'bg-muted/30 text-muted-foreground border-muted/50' },
  running: { labelKey: 'tasks.status.running', className: 'bg-info/15 text-info border-info/30 animate-pulse' },
  completed: { labelKey: 'tasks.status.completed', className: 'bg-primary/15 text-primary border-primary/30' },
  failed: { labelKey: 'tasks.status.failed', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  retrying: { labelKey: 'tasks.status.retrying', className: 'bg-warning/15 text-warning border-warning/30 animate-pulse' },
};

const EMPTY_TASKS: Task[] = [];
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const TASKS_PAGE_STATE_KEY = 'cpm-tasks-page-state';
const DEFAULT_STATUS_FILTER = 'all';
const DEFAULT_PRIORITY_FILTER = 'all';
const DEFAULT_ACCOUNT_FILTER = 'all';
const DEFAULT_PAGE_SIZE = '25';

interface PersistedTasksPageState {
  statusFilter: TaskStatus | 'all';
  priorityFilter: Priority | 'all';
  accountFilter: string;
  searchQuery: string;
  pageSize: string;
}

function readPersistedTasksPageState(): PersistedTasksPageState | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(TASKS_PAGE_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedTasksPageState>;
    return {
      statusFilter: parsed.statusFilter === 'queued' || parsed.statusFilter === 'running' || parsed.statusFilter === 'completed' || parsed.statusFilter === 'failed' || parsed.statusFilter === 'retrying'
        ? parsed.statusFilter
        : 'all',
      priorityFilter: parsed.priorityFilter === 'low' || parsed.priorityFilter === 'medium' || parsed.priorityFilter === 'high'
        ? parsed.priorityFilter
        : 'all',
      accountFilter: typeof parsed.accountFilter === 'string' ? parsed.accountFilter : 'all',
      searchQuery: typeof parsed.searchQuery === 'string' ? parsed.searchQuery : '',
      pageSize: typeof parsed.pageSize === 'string' ? parsed.pageSize : '25',
    };
  } catch {
    return null;
  }
}

const Tasks = () => {
  const [persistedState] = useState<PersistedTasksPageState | null>(() => readPersistedTasksPageState());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newTask, setNewTask] = useState({ description: '', priority: 'medium' as Priority, account: 'auto' });
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>(persistedState?.statusFilter ?? 'all');
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'all'>(persistedState?.priorityFilter ?? 'all');
  const [accountFilter, setAccountFilter] = useState<string>(persistedState?.accountFilter ?? 'all');
  const [searchQuery, setSearchQuery] = useState(persistedState?.searchQuery ?? '');
  const [pageSize, setPageSize] = useState(persistedState?.pageSize ?? '25');
  const [page, setPage] = useState(1);
  const navigate = useNavigate();
  const { t, dateLocale } = useI18n();
  const shell = useAppShell();
  const accounts = shell.accounts;
  const tasksQuery = useQuery({
    queryKey: ['tasks'],
    queryFn: api.listTasks,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });
  const tasks = tasksQuery.data ?? EMPTY_TASKS;
  const statusCounts = {
    all: tasks.length,
    queued: tasks.filter((task) => task.status === 'queued').length,
    running: tasks.filter((task) => task.status === 'running').length,
    completed: tasks.filter((task) => task.status === 'completed').length,
    failed: tasks.filter((task) => task.status === 'failed').length,
    retrying: tasks.filter((task) => task.status === 'retrying').length,
  };
  const filteredTasks = tasks.filter((task) => {
    if (statusFilter !== 'all' && task.status !== statusFilter) return false;
    if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;
    if (accountFilter !== 'all' && task.assigned_account_id !== accountFilter) return false;
    if (!searchQuery.trim()) return true;

    const search = searchQuery.toLowerCase();
    return [
      task.id,
      task.description,
      task.assigned_account_name || '',
      task.status,
      task.priority,
      task.result || '',
      task.error_message || '',
    ].some((value) => value.toLowerCase().includes(search));
  });
  const numericPageSize = Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / numericPageSize));
  const safePage = Math.min(page, totalPages);
  const pagedTasks = filteredTasks.slice((safePage - 1) * numericPageSize, safePage * numericPageSize);
  const filteredTaskIds = filteredTasks.map((task) => task.id);
  const visibleTaskIds = pagedTasks.map((task) => task.id);
  const allVisibleSelected = visibleTaskIds.length > 0 && visibleTaskIds.every((id) => selected.has(id));
  const allFilteredSelected = filteredTaskIds.length > 0 && filteredTaskIds.every((id) => selected.has(id));
  const selectedFilteredCount = filteredTaskIds.filter((id) => selected.has(id)).length;
  const hasActiveFilters = statusFilter !== DEFAULT_STATUS_FILTER
    || priorityFilter !== DEFAULT_PRIORITY_FILTER
    || accountFilter !== DEFAULT_ACCOUNT_FILTER
    || searchQuery.trim().length > 0
    || pageSize !== DEFAULT_PAGE_SIZE;
  const statusCards: Array<{ key: TaskStatus | 'all'; label: string; value: number }> = [
    { key: 'all', label: t('tasks.status.all'), value: statusCounts.all },
    { key: 'queued', label: t('tasks.status.queued'), value: statusCounts.queued },
    { key: 'running', label: t('tasks.status.running'), value: statusCounts.running },
    { key: 'failed', label: t('tasks.status.failed'), value: statusCounts.failed },
    { key: 'completed', label: t('tasks.status.completed'), value: statusCounts.completed },
  ];

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TASKS_PAGE_STATE_KEY, JSON.stringify({
      statusFilter,
      priorityFilter,
      accountFilter,
      searchQuery,
      pageSize,
    }));
  }, [statusFilter, priorityFilter, accountFilter, searchQuery, pageSize]);

  useEffect(() => {
    if (accountFilter !== 'all' && !accounts.some((account) => account.id === accountFilter)) {
      setAccountFilter('all');
    }
  }, [accountFilter, accounts]);

  useEffect(() => {
    setSelected((current) => new Set([...current].filter((id) => tasks.some((task) => task.id === id))));
  }, [tasks]);

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  };

  const toggleSelectVisible = () => {
    const next = new Set(selected);
    if (allVisibleSelected) {
      visibleTaskIds.forEach((id) => next.delete(id));
    } else {
      visibleTaskIds.forEach((id) => next.add(id));
    }
    setSelected(next);
  };

  const toggleSelectFiltered = () => {
    const next = new Set(selected);
    if (allFilteredSelected) {
      filteredTaskIds.forEach((id) => next.delete(id));
    } else {
      filteredTaskIds.forEach((id) => next.add(id));
    }
    setSelected(next);
  };

  const resetFilters = () => {
    setStatusFilter(DEFAULT_STATUS_FILTER);
    setPriorityFilter(DEFAULT_PRIORITY_FILTER);
    setAccountFilter(DEFAULT_ACCOUNT_FILTER);
    setSearchQuery('');
    setPageSize(DEFAULT_PAGE_SIZE);
    setPage(1);
  };

  const clearSelection = () => {
    setSelected(new Set());
  };

  const addTask = async () => {
    if (!newTask.description.trim()) return;
    try {
      await api.createTask(newTask);
      await Promise.all([
        tasksQuery.refetch(),
        shell.invalidateShell(),
      ]);
      setDialogOpen(false);
      setNewTask({ description: '', priority: 'medium', account: 'auto' });
      toast.success(t('tasks.toast.created'));
    } catch (error) {
      toast.error(formatAppError(error, t('tasks.error.createFailed')));
    }
  };

  const batchCancel = async () => {
    try {
      await api.batchCancelTasks([...selected]);
      await Promise.all([
        tasksQuery.refetch(),
        shell.invalidateShell(),
      ]);
      setSelected(new Set());
      toast.success(t('tasks.toast.cancelled'));
    } catch (error) {
      toast.error(formatAppError(error, t('tasks.error.cancelFailed')));
    }
  };

  const batchRetry = async () => {
    try {
      await api.batchRetryTasks([...selected]);
      await Promise.all([
        tasksQuery.refetch(),
        shell.invalidateShell(),
      ]);
      setSelected(new Set());
      toast.success(t('tasks.toast.retried'));
    } catch (error) {
      toast.error(formatAppError(error, t('tasks.error.retryFailed')));
    }
  };

  if (tasksQuery.isLoading) {
    return <div className="flex-1 grid place-items-center text-sm text-muted-foreground">{t('loading.tasks')}</div>;
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <div className="border-b border-border/50 bg-gradient-to-b from-background via-background to-secondary/10 px-4 py-2">
        <div className="flex flex-wrap gap-2.5">
          {statusCards.map((card) => (
            <button
              key={card.key}
              type="button"
              onClick={() => {
                setStatusFilter(card.key);
                setPage(1);
              }}
              className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-left transition-all duration-200 ${
                statusFilter === card.key
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/60 bg-background/70 text-muted-foreground hover:border-border hover:bg-card hover:text-foreground'
              }`}
            >
              <span className="text-[11px] font-medium">{card.label}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                statusFilter === card.key
                  ? 'bg-primary/15 text-primary'
                  : 'bg-secondary/70 text-foreground/80'
              }`}>
                {card.value}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between p-4 border-b border-border/50 gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">{t('tasks.title')}</h2>
            <Badge variant="outline" className="h-5 rounded-full px-1.5 text-[9px] font-normal">
              {t('tasks.experimental')}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t('tasks.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => tasksQuery.refetch().catch((error: Error) => toast.error(formatAppError(error, t('tasks.error.refreshFailed'))))}
            disabled={tasksQuery.isFetching}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${tasksQuery.isFetching ? 'animate-spin' : ''}`} />
            {t('tasks.refresh')}
          </Button>
          {selected.size > 0 && (
            <>
              <Button variant="outline" size="sm" className="h-7 text-xs border-destructive/30 text-destructive" onClick={batchCancel}>
                <XCircle className="h-3 w-3 mr-1" />{t('tasks.cancel')} ({selected.size})
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs border-warning/30 text-warning" onClick={batchRetry}>
                <RotateCw className="h-3 w-3 mr-1" />{t('tasks.retry')} ({selected.size})
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={clearSelection}>
                {t('tasks.clearSelection')}
              </Button>
            </>
          )}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-7 text-xs bg-primary text-primary-foreground">
                <Plus className="h-3 w-3 mr-1" />{t('tasks.addTask')}
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle className="text-sm">{t('tasks.addTask')}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">{t('tasks.description')}</Label>
                  <Textarea value={newTask.description} onChange={(e) => setNewTask((prev) => ({ ...prev, description: e.target.value }))} className="text-xs bg-input border-border/50 mt-1" rows={3} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">{t('tasks.priority')}</Label>
                    <Select value={newTask.priority} onValueChange={(value) => setNewTask((prev) => ({ ...prev, priority: value as Priority }))}>
                      <SelectTrigger className="h-8 text-xs bg-input border-border/50 mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">{t('tasks.priority.low')}</SelectItem>
                        <SelectItem value="medium">{t('tasks.priority.medium')}</SelectItem>
                        <SelectItem value="high">{t('tasks.priority.high')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">{t('tasks.account')}</Label>
                    <Select value={newTask.account} onValueChange={(value) => setNewTask((prev) => ({ ...prev, account: value }))}>
                      <SelectTrigger className="h-8 text-xs bg-input border-border/50 mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">{t('tasks.autoAssign')}</SelectItem>
                        {accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.account_id}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button className="w-full h-8 text-xs bg-primary text-primary-foreground" onClick={addTask}>{t('tasks.create')}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3 text-xs text-muted-foreground flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setPage(1);
            }}
            placeholder={t('tasks.search')}
            className="h-8 w-60 text-xs bg-input border-border/50"
          />
          <Select value={statusFilter} onValueChange={(value) => {
            setStatusFilter(value as TaskStatus | 'all');
            setPage(1);
          }}>
            <SelectTrigger className="h-8 w-32 text-xs bg-input border-border/50"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('tasks.status.all')}</SelectItem>
              <SelectItem value="queued">{t('tasks.status.queued')}</SelectItem>
              <SelectItem value="running">{t('tasks.status.running')}</SelectItem>
              <SelectItem value="completed">{t('tasks.status.completed')}</SelectItem>
              <SelectItem value="failed">{t('tasks.status.failed')}</SelectItem>
              <SelectItem value="retrying">{t('tasks.status.retrying')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={(value) => {
            setPriorityFilter(value as Priority | 'all');
            setPage(1);
          }}>
            <SelectTrigger className="h-8 w-32 text-xs bg-input border-border/50"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('tasks.priority.all')}</SelectItem>
              <SelectItem value="low">{t('tasks.priority.low')}</SelectItem>
              <SelectItem value="medium">{t('tasks.priority.medium')}</SelectItem>
              <SelectItem value="high">{t('tasks.priority.high')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={accountFilter} onValueChange={(value) => {
            setAccountFilter(value);
            setPage(1);
          }}>
            <SelectTrigger className="h-8 w-40 text-xs bg-input border-border/50"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('tasks.allAccounts')}</SelectItem>
              {accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.account_id}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="h-6 rounded-full px-2 text-[10px] font-normal">
            {t('tasks.filteredCount', { count: filteredTasks.length, total: tasks.length })}
          </Badge>
          {selected.size > 0 ? (
            <Badge variant="outline" className="h-6 rounded-full px-2 text-[10px] font-normal">
              {t('tasks.selectedCount', { count: selected.size, filtered: selectedFilteredCount })}
            </Badge>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={toggleSelectFiltered}
            disabled={filteredTaskIds.length === 0}
          >
            <CheckCheck className="h-3 w-3 mr-1" />
            {allFilteredSelected ? t('tasks.unselectFiltered') : t('tasks.selectFiltered')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={toggleSelectVisible}
            disabled={visibleTaskIds.length === 0}
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            {allVisibleSelected ? t('tasks.unselectVisible') : t('tasks.selectVisible')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={resetFilters}
            disabled={!hasActiveFilters}
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            {t('tasks.resetFilters')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {tasks.length === 0 ? (
          <div className="grid h-full place-items-center px-6">
            <div className="max-w-md rounded-2xl border border-dashed border-border/60 bg-card/40 p-6 text-center">
              <p className="text-sm font-medium text-foreground">{t('tasks.emptyTitle')}</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{t('tasks.emptyHint')}</p>
              <Button
                size="sm"
                className="mt-4 h-8 text-xs bg-primary text-primary-foreground"
                onClick={() => setDialogOpen(true)}
              >
                <Plus className="h-3 w-3 mr-1" />{t('tasks.addTask')}
              </Button>
            </div>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="grid h-full place-items-center px-6">
            <div className="max-w-md rounded-2xl border border-dashed border-border/60 bg-card/40 p-6 text-center">
              <p className="text-sm font-medium text-foreground">{t('tasks.emptyFilteredTitle')}</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{t('tasks.emptyFilteredHint')}</p>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="w-8">
                  <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectVisible} />
                </TableHead>
                <TableHead className="text-xs text-muted-foreground">{t('tasks.taskId')}</TableHead>
                <TableHead className="text-xs text-muted-foreground">{t('tasks.description')}</TableHead>
                <TableHead className="text-xs text-muted-foreground">{t('tasks.account')}</TableHead>
                <TableHead className="text-xs text-muted-foreground">{t('tasks.status')}</TableHead>
                <TableHead className="text-xs text-muted-foreground">{t('tasks.priority')}</TableHead>
                <TableHead className="text-xs text-muted-foreground">{t('tasks.created')}</TableHead>
                <TableHead className="text-xs text-muted-foreground">{t('tasks.result')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedTasks.map((task) => {
                const sb = statusBadge[task.status];
                return (
                  <TableRow key={task.id} className="border-border/50 text-xs">
                    <TableCell>
                      <Checkbox checked={selected.has(task.id)} onCheckedChange={() => toggleSelect(task.id)} />
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">{task.id.slice(0, 8)}</TableCell>
                    <TableCell className="text-foreground max-w-[200px] truncate">{task.description}</TableCell>
                    <TableCell className="text-foreground">
                      {task.assigned_account_name ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/?account=${encodeURIComponent(task.assigned_account_name || '')}`)}
                          className="text-left hover:underline"
                          title={t('common.openInDashboard')}
                        >
                          {task.assigned_account_name}
                        </button>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] h-5 ${sb.className}`}>{t(sb.labelKey)}</Badge>
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">{t(`tasks.priority.${task.priority}` as 'tasks.priority.low' | 'tasks.priority.medium' | 'tasks.priority.high')}</TableCell>
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger className="text-muted-foreground">{formatDistanceToNow(new Date(task.created_at), { addSuffix: true, locale: dateLocale })}</TooltipTrigger>
                        <TooltipContent className="text-xs">{new Date(task.created_at).toLocaleString()}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className={task.error_message ? 'text-destructive' : 'text-muted-foreground'}>{task.result || task.error_message || '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {filteredTasks.length > 0 ? (
        <div className="shrink-0 flex items-center justify-between border-t border-border/50 px-4 py-3 text-xs text-muted-foreground">
          <span>{t('tasks.pageSummary', { page: safePage, total: totalPages, count: filteredTasks.length })}</span>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <span>{t('common.perPage')}</span>
              <Select value={pageSize} onValueChange={(value) => {
                setPageSize(value);
                setPage(1);
              }}>
                <SelectTrigger className="h-7 w-24 text-xs bg-input border-border/50"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPage(1)} disabled={safePage <= 1}>
              {t('common.firstPage')}
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={safePage <= 1}>
              {t('common.prevPage')}
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={safePage >= totalPages}>
              {t('common.nextPage')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Tasks;

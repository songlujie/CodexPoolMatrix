import { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { LeftSidebar } from '@/components/LeftSidebar';
import { DouyinPromo } from '@/components/DouyinPromo';
import { Task, TaskStatus, Priority, Account, LogEntry, PoolSettings } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Plus, RotateCw, XCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const statusBadge: Record<TaskStatus, { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'bg-muted/30 text-muted-foreground border-muted/50' },
  running: { label: 'Running', className: 'bg-info/15 text-info border-info/30 animate-pulse' },
  completed: { label: 'Completed', className: 'bg-primary/15 text-primary border-primary/30' },
  failed: { label: 'Failed', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  retrying: { label: 'Retrying', className: 'bg-warning/15 text-warning border-warning/30 animate-pulse' },
};

const Tasks = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [settings, setSettings] = useState<PoolSettings | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newTask, setNewTask] = useState({ description: '', priority: 'medium' as Priority, account: 'auto' });
  const { t, dateLocale } = useI18n();

  const loadPage = async () => {
    const [nextTasks, nextAccounts, nextLogs, nextSettings] = await Promise.all([
      api.listTasks(),
      api.listAccounts(),
      api.listLogs(),
      api.getSettings(),
    ]);
    setTasks(nextTasks);
    setAccounts(nextAccounts);
    setLogs(nextLogs);
    setSettings(nextSettings);
  };

  useEffect(() => {
    loadPage().catch((error: Error) => toast.error(error.message));
  }, []);

  const currentAccount = accounts.find((account) => account.is_current);

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const addTask = async () => {
    if (!newTask.description.trim()) return;
    try {
      const task = await api.createTask(newTask);
      setTasks((prev) => [task, ...prev]);
      setDialogOpen(false);
      setNewTask({ description: '', priority: 'medium', account: 'auto' });
      toast.success('Task added');
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const batchCancel = async () => {
    try {
      await api.batchCancelTasks([...selected]);
      setTasks((prev) => prev.filter((task) => !selected.has(task.id)));
      setSelected(new Set());
      toast.success('Selected tasks cancelled');
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const batchRetry = async () => {
    try {
      await api.batchRetryTasks([...selected]);
      const nextTasks = await api.listTasks();
      setTasks(nextTasks);
      setSelected(new Set());
      toast.success('Selected tasks queued for retry');
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  if (!settings) {
    return <div className="h-screen grid place-items-center text-sm text-muted-foreground">{t('loading.tasks')}</div>;
  }

  return (
    <div className="h-screen flex flex-col">
      <DouyinPromo />
      <Header activeAccount={currentAccount?.account_id || 'None'} mode={settings.mode} onModeChange={(mode) => setSettings((prev) => prev ? { ...prev, mode } : prev)} />
      <div className="flex-1 flex min-h-0">
        <LeftSidebar currentAccount={currentAccount} accounts={accounts} recentLogs={logs} />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border/50">
            <h2 className="text-sm font-semibold text-foreground">{t('tasks.title')}</h2>
            <div className="flex gap-2">
              {selected.size > 0 && (
                <>
                  <Button variant="outline" size="sm" className="h-7 text-xs border-destructive/30 text-destructive" onClick={batchCancel}>
                    <XCircle className="h-3 w-3 mr-1" />{t('tasks.cancel')} ({selected.size})
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs border-warning/30 text-warning" onClick={batchRetry}>
                    <RotateCw className="h-3 w-3 mr-1" />{t('tasks.retry')} ({selected.size})
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
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
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

          <div className="flex-1 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 hover:bg-transparent">
                  <TableHead className="w-8" />
                  <TableHead className="text-xs text-muted-foreground">Task ID</TableHead>
                  <TableHead className="text-xs text-muted-foreground">{t('tasks.description')}</TableHead>
                  <TableHead className="text-xs text-muted-foreground">{t('tasks.account')}</TableHead>
                  <TableHead className="text-xs text-muted-foreground">{t('tasks.status')}</TableHead>
                  <TableHead className="text-xs text-muted-foreground">{t('tasks.priority')}</TableHead>
                  <TableHead className="text-xs text-muted-foreground">{t('tasks.created')}</TableHead>
                  <TableHead className="text-xs text-muted-foreground">{t('tasks.result')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => {
                  const sb = statusBadge[task.status];
                  return (
                    <TableRow key={task.id} className="border-border/50 text-xs">
                      <TableCell>
                        <Checkbox checked={selected.has(task.id)} onCheckedChange={() => toggleSelect(task.id)} />
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground">{task.id.slice(0, 8)}</TableCell>
                      <TableCell className="text-foreground max-w-[200px] truncate">{task.description}</TableCell>
                      <TableCell className="text-foreground">{task.assigned_account_name || '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] h-5 ${sb.className}`}>{sb.label}</Badge>
                      </TableCell>
                      <TableCell className="capitalize text-muted-foreground">{task.priority}</TableCell>
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
          </div>
        </div>
      </div>
    </div>
  );
};

export default Tasks;

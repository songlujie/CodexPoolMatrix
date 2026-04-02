import { useState, useEffect, useRef } from 'react';
import { Plus, Search, RefreshCw, CheckSquare, Square, AlertCircle, LogIn, CheckCircle2, XCircle, Loader2, ChevronLeft } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Account, AccountType } from '@/types';
import { api } from '@/lib/api';
import { formatAppError } from '@/lib/errors';
import { toast } from 'sonner';
import { useI18n } from '@/lib/i18n';

const PLATFORM_LABELS: Record<string, string> = {
  gpt: 'GPT',
  gemini: 'Gemini',
  claude: 'Claude',
};

interface AddAccountDialogProps {
  onAccountAdded: (account?: Account) => void;
  platforms?: string[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}

type ScannedFile = {
  file: string;
  full_path: string;
  til_path: string;
  email?: string;
  auth_type?: string;
  suggested_name?: string;
  already_added?: boolean;
  duplicate_reason?: string | null;
  error?: string;
};

const TYPE_BADGE: Record<string, string> = {
  team: 'bg-info/15 text-info border-info/30',
  plus: 'bg-primary/15 text-primary border-primary/30',
  free: 'bg-muted/30 text-muted-foreground border-muted/50',
};

// ─── Login step component ───────────────────────────────────────────────────

interface LoginStepProps {
  onBack: () => void;
  onSuccess: () => void;
}

function LoginStep({ onBack, onSuccess }: LoginStepProps) {
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [output, setOutput] = useState('');
  const outputRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startPolling = () => {
    pollRef.current = setInterval(async () => {
      try {
        const s = await api.getCodexLoginStatus();
        setStatus(s.status);
        setMessage(s.message);
        setOutput(s.output);
        if (s.status === 'success' || s.status === 'error') {
          stopPolling();
          if (s.status === 'success') {
            // Wait a beat then trigger scan refresh
            setTimeout(() => onSuccess(), 1200);
          }
        }
      } catch { /* ignore poll errors */ }
    }, 1500);
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopPolling();
  }, []);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const handleStart = async () => {
    try {
      setStatus('running');
      setMessage('正在启动 codex login…');
      setOutput('');
      await api.startCodexLogin();
      startPolling();
    } catch (e) {
      setStatus('error');
      setMessage((e as Error).message);
    }
  };

  const handleCancel = async () => {
    stopPolling();
    try { await api.cancelCodexLogin(); } catch { /* ignore */ }
    setStatus('idle');
    setMessage('');
    setOutput('');
  };

  return (
    <div className="space-y-4">
      {/* Back button */}
      <button
        onClick={() => { handleCancel(); onBack(); }}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        返回
      </button>

      {/* Status area */}
      <div className={`rounded-xl border-2 p-5 flex flex-col items-center gap-3 text-center transition-colors ${
        status === 'success' ? 'border-primary/40 bg-primary/5' :
        status === 'error'   ? 'border-destructive/40 bg-destructive/5' :
        status === 'running' ? 'border-primary/20 bg-primary/3' :
        'border-border/50'
      }`}>
        {status === 'idle' && (
          <>
            <LogIn className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="text-sm font-semibold">一键登录 OpenAI</p>
              <p className="text-xs text-muted-foreground mt-1">
                点击后浏览器会自动打开 OpenAI 授权页面<br />
                完成授权后 auth 文件会自动保存到项目中
              </p>
            </div>
            <Button onClick={handleStart} className="gap-2">
              <LogIn className="h-4 w-4" />
              打开浏览器登录
            </Button>
          </>
        )}

        {status === 'running' && (
          <>
            <Loader2 className="h-10 w-10 text-primary animate-spin" />
            <div>
              <p className="text-sm font-semibold text-primary">等待浏览器授权…</p>
              <p className="text-xs text-muted-foreground mt-1">
                请在浏览器中完成 OpenAI 账号授权<br />
                授权完成后这里会自动更新
              </p>
            </div>
            <p className="text-[11px] font-mono text-muted-foreground max-w-full truncate px-2">{message}</p>
            <Button variant="outline" size="sm" onClick={handleCancel} className="text-xs">
              取消
            </Button>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle2 className="h-10 w-10 text-primary" />
            <div>
              <p className="text-sm font-semibold text-primary">登录成功！</p>
              <p className="text-xs text-muted-foreground mt-1">{message}</p>
            </div>
            <p className="text-xs text-muted-foreground">正在刷新账号列表…</p>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="h-10 w-10 text-destructive" />
            <div>
              <p className="text-sm font-semibold text-destructive">登录失败</p>
              <p className="text-xs text-muted-foreground mt-1">{message}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleStart} className="text-xs gap-1.5">
                <RefreshCw className="h-3 w-3" /> 重试
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Raw output log */}
      {output && (
        <div
          ref={outputRef}
          className="max-h-32 overflow-y-auto overflow-x-hidden rounded-lg bg-muted/20 border border-border/40 px-3 py-2 font-mono text-[10px] text-muted-foreground whitespace-pre-wrap break-all"
        >
          {output}
        </div>
      )}
    </div>
  );
}

// ─── Main dialog ────────────────────────────────────────────────────────────

export function AddAccountDialog({
  onAccountAdded,
  platforms = ['gpt', 'gemini', 'claude'],
  open,
  onOpenChange,
  hideTrigger = false,
}: AddAccountDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [view, setView] = useState<'scan' | 'login' | 'api'>('scan');
  const [scanDir, setScanDir] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<ScannedFile[]>([]);
  const [scannedDirLabel, setScannedDirLabel] = useState('');
  const [scanError, setScanError] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('gpt');
  const [apiForm, setApiForm] = useState({
    account_id: '',
    email: '',
    auth_type: 'plus' as AccountType,
    api_base_url: '',
    api_key: '',
    api_model: '',
    api_cli_config: '',
  });
  const { t } = useI18n();
  const isOpen = open ?? internalOpen;
  const setIsOpen = onOpenChange ?? setInternalOpen;

  const handleOpen = () => {
    setView('scan');
    setIsOpen(true);
    handleScan();
  };

  const handleAddApiAccount = async () => {
    if (!apiForm.account_id.trim() || !apiForm.api_base_url.trim() || !apiForm.api_key.trim()) {
      toast.error('请填写账号名、中转站地址和 API Key');
      return;
    }

    setAdding(true);
    try {
      const account = await api.createAccount({
        account_id: apiForm.account_id.trim(),
        email: apiForm.email.trim(),
        auth_type: apiForm.auth_type,
        auth_file_path: '',
        provider_mode: 'api',
        api_base_url: apiForm.api_base_url.trim(),
        api_key: apiForm.api_key.trim(),
        api_model: apiForm.api_model.trim(),
        api_cli_config: apiForm.api_cli_config,
        platform: selectedPlatform,
      });
      toast.success(`成功添加 API 账号 ${account.account_id}`);
      onAccountAdded(account);
      setIsOpen(false);
      setApiForm({
        account_id: '',
        email: '',
        auth_type: 'plus',
        api_base_url: '',
        api_key: '',
        api_model: '',
        api_cli_config: '',
      });
    } catch (e) {
      toast.error(formatAppError(e, '添加 API 账号失败'));
    } finally {
      setAdding(false);
    }
  };

  const handleScan = async (dir?: string) => {
    const target = dir ?? scanDir;
    setScanning(true);
    setScanError('');
    setScanned([]);
    setSelected(new Set());
    try {
      const result = await api.scanDir(target);
      if (result.error) {
        setScanError(result.error);
      } else {
        const fresh = result.files.filter(f => !f.already_added && !f.error);
        setScanned(result.files);
        setScannedDirLabel(result.dir);
        const nameMap: Record<string, string> = {};
        result.files.forEach(f => {
          nameMap[f.file] = f.suggested_name || f.file.replace(/\.json$/, '');
        });
        setNames(nameMap);
        setSelected(new Set(fresh.map(f => f.file)));
      }
    } catch (e) {
      setScanError(formatAppError(e, '扫描账号目录失败'));
    } finally {
      setScanning(false);
    }
  };

  const toggleSelect = (file: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  const toggleAll = () => {
    const addable = scanned.filter(f => !f.already_added && !f.error);
    if (selected.size === addable.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(addable.map(f => f.file)));
    }
  };

  const handleAdd = async () => {
    const toAdd = scanned.filter(f => selected.has(f.file) && !f.already_added && !f.error);
    if (toAdd.length === 0) return;
    setAdding(true);
    let success = 0;
    let lastAccount: Account | undefined;
    for (const f of toAdd) {
      try {
        const account = await api.createAccount({
          account_id: names[f.file] || f.suggested_name || f.file,
          email: f.email || '',
          auth_type: (f.auth_type || 'plus') as AccountType,
          auth_file_path: f.til_path,
          platform: selectedPlatform,
        });
        lastAccount = account;
        success++;
      } catch (e) {
        toast.error(`${f.file}: ${formatAppError(e, '添加账号失败')}`);
      }
    }
    setAdding(false);
    if (success > 0) {
      toast.success(`成功添加 ${success} 个账号`);
      onAccountAdded(lastAccount);
      setIsOpen(false);
      setScanned([]);
      setSelected(new Set());
    }
  };

  const addable = scanned.filter(f => !f.already_added && !f.error);

  return (
    <>
      {!hideTrigger && (
        <button
          onClick={handleOpen}
          className="min-h-[220px] rounded-xl border-2 border-dashed border-border/50 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all"
        >
          <Plus className="h-8 w-8" />
          <span className="text-xs font-medium">{t('card.addAccount')}</span>
        </button>
      )}

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[520px] max-w-[95vw] overflow-hidden">
          <DialogHeader>
          <DialogTitle>{view === 'api' ? '添加 API 中转站账号' : '添加账号'}</DialogTitle>
        </DialogHeader>

          {/* ── Login view ── */}
          {view === 'login' && (
            <LoginStep
              onBack={() => setView('scan')}
              onSuccess={() => {
                setView('scan');
                handleScan();
              }}
            />
          )}

          {/* ── Scan view ── */}
          {view === 'scan' && (
            <>
              {/* 一键登录入口 */}
              <div className="grid gap-2">
                <button
                  onClick={() => setView('login')}
                  className="w-full flex items-center justify-between rounded-lg border border-border/50 bg-secondary/30 hover:bg-secondary/60 px-4 py-3 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                      <LogIn className="h-4 w-4 text-primary" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium">一键登录新账号</p>
                      <p className="text-[11px] text-muted-foreground">浏览器授权，auth 文件自动保存</p>
                    </div>
                  </div>
                  <span className="text-[11px] text-muted-foreground group-hover:text-foreground transition-colors">→</span>
                </button>

                <button
                  onClick={() => setView('api')}
                  className="w-full flex items-center justify-between rounded-lg border border-border/50 bg-secondary/30 hover:bg-secondary/60 px-4 py-3 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-info/10 flex items-center justify-center group-hover:bg-info/20 transition-colors">
                      <Plus className="h-4 w-4 text-info" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium">添加 API 中转站账号</p>
                      <p className="text-[11px] text-muted-foreground">填写 Base URL、API Key、模型名</p>
                    </div>
                  </div>
                  <span className="text-[11px] text-muted-foreground group-hover:text-foreground transition-colors">→</span>
                </button>
              </div>

              <div className="relative flex items-center gap-3">
                <div className="flex-1 border-t border-border/40" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">或手动导入</span>
                <div className="flex-1 border-t border-border/40" />
              </div>

              {/* 扫描目录输入 */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Auth 目录</Label>
                <div className="flex gap-2">
                  <Input
                    value={scanDir}
                    onChange={e => setScanDir(e.target.value)}
                    className="flex-1 text-xs font-mono"
                    placeholder="留空使用项目内 accounts/ 目录"
                    onKeyDown={e => e.key === 'Enter' && handleScan()}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleScan()}
                    disabled={scanning}
                    className="gap-1.5"
                  >
                    {scanning
                      ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      : <Search className="h-3.5 w-3.5" />}
                    {scanning ? '扫描中' : '扫描'}
                  </Button>
                </div>
              </div>

              {/* 错误提示 */}
              {scanError && (
                <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {scanError}
                </div>
              )}

              {/* 扫描结果 */}
              {scanned.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      发现 {scanned.length} 个文件，{addable.length} 个可添加
                    </span>
                    {addable.length > 0 && (
                      <button
                        onClick={toggleAll}
                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        {selected.size === addable.length
                          ? <><CheckSquare className="h-3.5 w-3.5" /> 取消全选</>
                          : <><Square className="h-3.5 w-3.5" /> 全选</>}
                      </button>
                    )}
                  </div>

                  <div className="max-h-[220px] overflow-y-auto space-y-1.5 pr-1">
                    {scanned.map(f => {
                      const isSelected = selected.has(f.file);
                      const disabled = !!f.already_added || !!f.error;

                      return (
                        <div
                          key={f.file}
                          onClick={() => !disabled && toggleSelect(f.file)}
                          className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-all
                            ${disabled ? 'opacity-40 cursor-not-allowed border-border/30 bg-muted/10' :
                              isSelected ? 'border-primary/40 bg-primary/5 cursor-pointer' :
                              'border-border/40 hover:border-border cursor-pointer'}`}
                        >
                          <div className="shrink-0 text-primary">
                            {disabled
                              ? <Square className="h-4 w-4 text-muted-foreground/40" />
                              : isSelected
                                ? <CheckSquare className="h-4 w-4" />
                                : <Square className="h-4 w-4 text-muted-foreground" />}
                          </div>

                          <div className="flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                            <Input
                              value={names[f.file] || ''}
                              onChange={e => setNames(prev => ({ ...prev, [f.file]: e.target.value }))}
                              disabled={disabled}
                              className="h-6 text-xs border-0 bg-transparent p-0 focus-visible:ring-0 font-medium"
                              placeholder="账号名"
                            />
                            <p className="text-[10px] text-muted-foreground truncate">
                              {f.email || f.file}
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {f.auth_type && (
                              <Badge variant="outline" className={`text-[9px] h-4 px-1.5 ${TYPE_BADGE[f.auth_type] || ''}`}>
                                {f.auth_type.toUpperCase()}
                              </Badge>
                            )}
                            {f.already_added && (
                              <span className={`text-[9px] ${f.duplicate_reason === '邮箱重复' ? 'text-warning' : 'text-muted-foreground'}`}>
                                {f.duplicate_reason || '已添加'}
                              </span>
                            )}
                            {f.error && (
                              <span className="text-[9px] text-destructive">读取失败</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 平台选择 */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">平台</Label>
                <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
                  <SelectTrigger className="h-8 text-xs bg-input border-border/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {platforms.map(p => (
                      <SelectItem key={p} value={p}>
                        {PLATFORM_LABELS[p] || (p.charAt(0).toUpperCase() + p.slice(1))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsOpen(false)} disabled={adding}>
                  取消
                </Button>
                <Button onClick={handleAdd} disabled={adding || selected.size === 0}>
                  {adding ? `添加中...` : `添加 ${selected.size} 个账号`}
                </Button>
              </DialogFooter>
            </>
          )}

          {view === 'api' && (
            <div className="space-y-4">
              <button
                onClick={() => setView('scan')}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                返回
              </button>

              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">账号名</Label>
                  <Input value={apiForm.account_id} onChange={e => setApiForm(prev => ({ ...prev, account_id: e.target.value }))} className="text-xs" placeholder="例如：relay-main" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">邮箱备注</Label>
                  <Input value={apiForm.email} onChange={e => setApiForm(prev => ({ ...prev, email: e.target.value }))} className="text-xs" placeholder="可选，仅用于标识" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Base URL</Label>
                  <Input value={apiForm.api_base_url} onChange={e => setApiForm(prev => ({ ...prev, api_base_url: e.target.value }))} className="text-xs font-mono" placeholder="例如：https://your-relay.example.com/v1" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">API Key</Label>
                  <Input type="password" value={apiForm.api_key} onChange={e => setApiForm(prev => ({ ...prev, api_key: e.target.value }))} className="text-xs font-mono" placeholder="sk-..." />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">模型名</Label>
                  <Input value={apiForm.api_model} onChange={e => setApiForm(prev => ({ ...prev, api_model: e.target.value }))} className="text-xs font-mono" placeholder="可选，例如：gpt-4.1-mini" />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs text-muted-foreground">{t('addAccount.apiCliConfig')}</Label>
                    <span className="text-[10px] text-muted-foreground">{t('addAccount.apiCliConfigHint')}</span>
                  </div>
                  <Textarea
                    value={apiForm.api_cli_config}
                    onChange={e => setApiForm(prev => ({ ...prev, api_cli_config: e.target.value }))}
                    className="min-h-[104px] text-xs font-mono bg-input border-border/50"
                    placeholder={`wire_api = "chat"\nquery_params = { api-version = "2025-01-01-preview" }`}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-xs text-muted-foreground">{t('addAccount.apiGroup')}</Label>
                      <span className="text-[10px] text-muted-foreground">{t('addAccount.apiGroupHint')}</span>
                    </div>
                    <Select value={apiForm.auth_type} onValueChange={value => setApiForm(prev => ({ ...prev, auth_type: value as AccountType }))}>
                      <SelectTrigger className="h-8 text-xs bg-input border-border/50">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="team">TEAM</SelectItem>
                        <SelectItem value="plus">PLUS</SelectItem>
                        <SelectItem value="free">FREE</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">{t('addAccount.apiCategory')}</Label>
                    <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
                      <SelectTrigger className="h-8 text-xs bg-input border-border/50">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {platforms.map(p => (
                          <SelectItem key={p} value={p}>
                            {PLATFORM_LABELS[p] || (p.charAt(0).toUpperCase() + p.slice(1))}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsOpen(false)} disabled={adding}>
                  取消
                </Button>
                <Button onClick={handleAddApiAccount} disabled={adding}>
                  {adding ? '添加中...' : '添加 API 账号'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

import { useState } from 'react';
import { Plus, FolderOpen, Info } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Account, AccountType } from '@/types';
import { api } from '@/lib/api';
import { toast } from 'sonner';

interface AddAccountDialogProps {
  onAccountAdded: (account: Account) => void;
}

const AUTH_TYPE_LABELS: Record<AccountType, string> = {
  team: 'Team（企业版）',
  plus: 'Plus（付费版）',
  free: 'Free（免费版）',
};

const DEFAULT_AUTH_PATH = '~/.codex/auth/';

export function AddAccountDialog({ onAccountAdded }: AddAccountDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    account_id: '',
    email: '',
    auth_type: 'plus' as AccountType,
    auth_file_path: '',
  });
  const [errors, setErrors] = useState<Partial<typeof form>>({});

  const validate = () => {
    const next: Partial<typeof form> = {};
    if (!form.account_id.trim()) next.account_id = '请输入账号名称';
    if (!form.email.trim()) next.email = '请输入邮箱';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = '邮箱格式不正确';
    if (!form.auth_file_path.trim()) next.auth_file_path = '请输入 auth 文件路径';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const account = await api.createAccount(form);
      onAccountAdded(account);
      toast.success(`账号 ${form.account_id} 添加成功`);
      setOpen(false);
      setForm({ account_id: '', email: '', auth_type: 'plus', auth_file_path: '' });
      setErrors({});
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleAuthPathSuggest = () => {
    if (form.account_id) {
      setForm(f => ({
        ...f,
        auth_file_path: `${DEFAULT_AUTH_PATH}${f.account_id.toLowerCase().replace(/[^a-z0-9]/g, '_')}.json`,
      }));
    } else {
      toast.info('请先填写账号名称，再自动生成路径');
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="min-h-[220px] rounded-xl border-2 border-dashed border-border/50 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all"
      >
        <Plus className="h-8 w-8" />
        <span className="text-xs font-medium">添加账号</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>添加 OpenAI 账号</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Account ID */}
            <div className="space-y-1.5">
              <Label htmlFor="account_id">账号名称 <span className="text-destructive">*</span></Label>
              <Input
                id="account_id"
                placeholder="例如：myaccount1"
                value={form.account_id}
                onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}
              />
              {errors.account_id && <p className="text-xs text-destructive">{errors.account_id}</p>}
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email">OpenAI 邮箱 <span className="text-destructive">*</span></Label>
              <Input
                id="email"
                type="email"
                placeholder="example@gmail.com"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>

            {/* Auth Type */}
            <div className="space-y-1.5">
              <Label>账号类型 <span className="text-destructive">*</span></Label>
              <Select
                value={form.auth_type}
                onValueChange={val => setForm(f => ({ ...f, auth_type: val as AccountType }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(AUTH_TYPE_LABELS) as AccountType[]).map(t => (
                    <SelectItem key={t} value={t}>{AUTH_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Auth File Path */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="auth_file_path">Auth 文件路径 <span className="text-destructive">*</span></Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[260px] text-xs">
                    通过 OAuth 登录 OpenAI Codex 后，auth token 会被保存为 JSON 文件。
                    默认路径在 ~/.codex/auth/ 目录下。
                    每个账号需要有独立的 auth 文件。
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex gap-2">
                <Input
                  id="auth_file_path"
                  placeholder="~/.codex/auth/myaccount1.json"
                  value={form.auth_file_path}
                  onChange={e => setForm(f => ({ ...f, auth_file_path: e.target.value }))}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleAuthPathSuggest}
                  title="根据账号名自动生成路径"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              {errors.auth_file_path && <p className="text-xs text-destructive">{errors.auth_file_path}</p>}
              <p className="text-xs text-muted-foreground">
                先用 <code className="bg-muted px-1 rounded">codex login</code> 登录各账号，auth 文件会自动生成
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? '添加中...' : '添加账号'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

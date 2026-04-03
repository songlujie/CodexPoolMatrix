import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

interface AccountCardCliConfigDialogProps {
  accountId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onValueChange: (value: string) => void;
  preview: string;
  previewLoading: boolean;
  saving: boolean;
  onSave: () => void;
  title: string;
  previewLabel: string;
  emptyLabel: string;
}

export function AccountCardCliConfigDialog({
  accountId,
  open,
  onOpenChange,
  value,
  onValueChange,
  preview,
  previewLoading,
  saving,
  onSave,
  title,
  previewLabel,
  emptyLabel,
}: AccountCardCliConfigDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">{accountId} · {title}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
          <p className="text-[11px] text-muted-foreground">
            `base_url` 仍由账号的 Base URL 单独控制，这里只写 provider 内其余 TOML 配置；不要写 table，也不要重复 key。
          </p>
          <Textarea
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            className="min-h-[180px] text-xs font-mono bg-input border-border/50"
            placeholder={`wire_api = "chat"\nquery_params = { api-version = "2025-01-01-preview" }`}
          />
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">{previewLabel}</p>
            <div className="max-h-40 overflow-y-auto rounded-md border border-border/50 bg-muted/20 px-3 py-2 font-mono text-[11px] whitespace-pre-wrap break-all text-foreground/85">
              {previewLoading ? '预览生成中...' : (preview || emptyLabel)}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? '保存中...' : '保存配置'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

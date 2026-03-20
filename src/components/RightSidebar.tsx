import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { PoolSettings } from '@/types';
import { RotateCw, Pause } from 'lucide-react';

interface RightSidebarProps {
  settings: PoolSettings;
  onSettingsChange: (settings: PoolSettings) => void;
  onRotateNow: () => void;
  onPauseAll: () => void;
  onHealthCheck: () => void;
}

export function RightSidebar({ settings, onSettingsChange, onRotateNow, onPauseAll }: RightSidebarProps) {
  const update = (partial: Partial<PoolSettings>) => {
    onSettingsChange({ ...settings, ...partial });
  };

  return (
    <aside className="w-[280px] shrink-0 border-l border-border/50 bg-background/50 backdrop-blur-md overflow-y-auto">

      {/* 快捷操作 */}
      <div className="p-4 border-b border-border/50 space-y-2">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider mb-3">快捷操作</h3>
        <Button onClick={onRotateNow} className="w-full h-8 text-xs bg-primary hover:bg-primary/90 text-primary-foreground">
          <RotateCw className="h-3.5 w-3.5 mr-1.5" />
          立即切换下一个账号
        </Button>
        <Button onClick={onPauseAll} variant="outline" className="w-full h-8 text-xs border-warning/30 text-warning hover:bg-warning/10">
          <Pause className="h-3.5 w-3.5 mr-1.5" />
          暂停所有账号
        </Button>
      </div>

      {/* 轮换策略 */}
      <div className="p-4 border-b border-border/50 space-y-4">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">轮换设置</h3>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">切换策略</Label>
          <Select value={settings.strategy} onValueChange={(v) => update({ strategy: v as PoolSettings['strategy'] })}>
            <SelectTrigger className="h-8 text-xs bg-input border-border/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="round_robin">Round Robin（轮流）</SelectItem>
              <SelectItem value="least_used">Least Used（最少使用）</SelectItem>
              <SelectItem value="random">Random（随机）</SelectItem>
              <SelectItem value="priority_based">Priority Based（优先级）</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">自动轮换</Label>
          <Switch checked={settings.auto_rotation} onCheckedChange={(v) => update({ auto_rotation: v })} />
        </div>
      </div>

      {/* Codex 路径 */}
      <div className="p-4 border-b border-border/50 space-y-3">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Codex 配置</h3>

        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Codex 可执行文件路径</Label>
          <Input
            value={settings.codex_path}
            onChange={(e) => update({ codex_path: e.target.value })}
            className="h-7 text-xs bg-input border-border/50 font-mono"
            placeholder="/usr/local/bin/codex"
          />
        </div>
      </div>

      {/* Openclaw 集成 */}
      <div className="p-4 space-y-3">
        <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">Openclaw 集成</h3>

        <div className="flex items-center gap-2 text-xs">
          <span className="h-2 w-2 rounded-full bg-primary" />
          <span className="text-muted-foreground">Connected</span>
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Endpoint</Label>
          <Input
            value={settings.openclaw_endpoint}
            onChange={(e) => update({ openclaw_endpoint: e.target.value })}
            className="h-7 text-xs bg-input border-border/50 font-mono"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">API Key</Label>
          <Input
            type="password"
            value={settings.openclaw_api_key}
            onChange={(e) => update({ openclaw_api_key: e.target.value })}
            className="h-7 text-xs bg-input border-border/50"
            placeholder="••••••••"
          />
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">自动分发任务</Label>
          <Switch checked={settings.auto_dispatch} onCheckedChange={(v) => update({ auto_dispatch: v })} />
        </div>
      </div>
    </aside>
  );
}

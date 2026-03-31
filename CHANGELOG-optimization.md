# Codex Pool Manager 优化更新说明

## 后端 (server/)

### 1. Async 错误处理 — `asyncHandler` 包装器
所有 Express 路由用 `asyncHandler` 统一包装，async 函数抛出的异常会自动走到 error handler，不再导致进程崩溃。

### 2. 合并重复端点
`/api/accounts/:id/check-usage` 和 `/api/accounts/:id/refresh-codex-usage` 共用 `handleUsageCheck()` 函数，消除了约 40 行重复代码。

### 3. 同步文件 I/O → 异步
全部 `fs.existsSync`、`fs.readFileSync`、`fs.writeFileSync`、`fs.copyFileSync` 替换为 `fs.promises` 异步版本（`fs.access`、`fs.readFile`、`fs.writeFile`、`fs.copyFile`），不再阻塞事件循环。`/api/codex-usage` 的 JSONL 扫描也改为异步读取。

### 4. 轮换策略完整实现
新增 `pickNextAccount()` 函数，支持全部 4 种策略：
- **round_robin**: 顺序轮流（原有逻辑）
- **least_used**: 选 `tokens_used_percent` 最低的账号
- **random**: 随机选一个可用账号
- **priority_based**: 按 team > plus > free 优先级排序，同类型取用量最低

手动轮换 (`/api/actions/rotate`) 和自动轮换 (`runAutoCheck`) 都会读取 settings 中配置的策略。

### 5. Logs 支持 `limit` 参数
`GET /api/logs` 新增 `?limit=N` 查询参数，Dashboard 只请求最近 20 条日志，大幅减少数据传输量。

### 6. 数据库索引
`init-db.js` 新增 `createIndexes()` 函数，在以下列上创建索引：
- `accounts.is_current`, `accounts.status`
- `logs.created_at`, `logs.level`, `logs.account_id`
- `tasks.created_at`, `tasks.status`, `tasks.assigned_account_id`

### 7. 优雅关闭
监听 `SIGTERM` / `SIGINT` 信号，关闭时会清理自动轮换定时器、关闭 HTTP 服务器、关闭数据库连接池。

### 8. Seed 数据环境保护
仅在 `NODE_ENV !== 'production'` 时插入示例账号数据，避免生产环境被假数据污染。

### 9. db.js 清理
移除未使用的 `query()` 导出函数和 `namedPlaceholders: true` 配置项。

---

## 前端 (src/)

### 10. Settings 防抖保存
`handleSettingsChange` 加入 300ms debounce，输入路径时不再每个字符触发一次 PUT 请求。

### 11. 简化 AccountGrid 通信模式
原来 `AccountGrid` 通过构造新数组让父组件"猜"操作类型，现改为直接传递 `onAction(action, id)` 回调：
- `onAction('setActive', id)` / `onAction('pause', id)` / `onAction('reset', id)`
- `onRemove(id)` / `onAccountAdded()` / `onClearAll()`

父组件直接调 API，不再做状态逆推。

### 12. AccountCard 清理死代码
移除未使用的 `codexUsage`、`loadingCodexUsage` 状态和 `CodexUsage` 类型别名，修复 `fetchCodexUsage` 未定义引用。

### 13. React Error Boundary
新增 `ErrorBoundary` 组件包裹整个 App，渲染异常时显示友好的错误提示 + 刷新按钮，防止白屏。

### 14. Dashboard 日志请求优化
`loadDashboard` 调用 `api.listLogs({ limit: 20 })` 只拉最近 20 条，侧边栏展示足够的同时避免传输大量历史日志。

---

## 涉及文件

| 文件 | 改动 |
|------|------|
| `server/index.js` | asyncHandler、async I/O、合并端点、轮换策略、优雅关闭 |
| `server/db.js` | 移除 namedPlaceholders 和未用导出 |
| `server/init-db.js` | 数据库索引、seed 环境保护 |
| `src/App.tsx` | 添加 ErrorBoundary |
| `src/components/ErrorBoundary.tsx` | 新增文件 |
| `src/components/AccountCard.tsx` | 清理死代码 |
| `src/components/AccountGrid.tsx` | 简化 props 通信 |
| `src/pages/Index.tsx` | debounce settings、简化回调、limit logs |
| `src/lib/api.ts` | listLogs 支持 limit 参数 |
| `src/components/AddAccountDialog.tsx` | onAccountAdded 类型兼容 |

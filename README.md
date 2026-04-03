# CodexPoolMatrix

[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/songlujie/CodexPoolMatrix?style=flat-square)](https://github.com/songlujie/CodexPoolMatrix/stargazers)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square)](https://nodejs.org)

多账号 Codex 管理仪表板，支持 OAuth 账号和 API 中转站账号，提供实时用量检测、自动轮换、批量 Token 刷新，以及可选的 OpenClaw 同步。

---

## ✨ Features

- **平台分类** — 支持 GPT、Gemini、Claude 等多平台账号，可自定义添加新平台
- **OAuth 一键登录 / 扫描导入** — 在界面内直接完成 `codex login` 授权，或批量扫描 auth 文件导入
- **API 中转站账号** — 支持添加 `Base URL + API Key + 模型名` 的 API 账号，并在切换时接管 Codex CLI 配置
- **CLI 配置片段自动清洗** — API 中转站的自定义 TOML 片段会自动去掉重复 key、`table` 段和多余 `base_url`
- **批量用量检测** — 一键检测所有账号状态，OAuth 账号显示 5h / 周用量，API 账号检测中转站与模型可用性
- **自动轮换** — 按策略选择下一个账号；当当前 OAuth 账号 5h 用量达到 90% 时自动切换
- **自动 Token 刷新** — 支持按 24h / 48h / 72h / 120h / 168h 周期批量刷新 OAuth 账号 Token
- **OpenClaw 可选集成** — 切换 OAuth 账号时可同步 `auth-profiles.json` 并触发 OpenClaw 重载
- **当前账号保护** — 正在使用中的账号不能直接删除，避免误删当前运行时配置
- **亮暗主题** — 支持深色 / 浅色模式随时切换
- **紧凑列表视图** — 网格视图和紧凑列表视图自由切换
- **实时日志** — 完整记录轮换事件、Token 刷新、用量检测

## 📸 Screenshots

| Dashboard | Add Account |
| --- | --- |
| ![Dashboard](assets/screenshot-dashboard.png) | ![Add Account](assets/screenshot-add.png) |

| Settings | Logs |
| --- | --- |
| ![Settings](assets/screenshot-settings.png) | ![Logs](assets/screenshot-logs.png) |

---

## 🛠 Tech Stack

- **Frontend**: React 18 + TypeScript + Vite 5 + Tailwind CSS + shadcn/ui
- **State / UX**: TanStack Query + Framer Motion + Sonner
- **Desktop Shell**: Electron + IPC bridge
- **Backend**: Node.js + Express 4 + dotenv
- **Database**: SQLite by default, optional MySQL compatibility
- **Runtime**: Node.js 18+ and npm

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the team workflow and branch strategy.

---

## 🚀 Quick Start

### 1. Clone

```bash
git clone https://github.com/songlujie/CodexPoolMatrix.git
cd CodexPoolMatrix
```

### 2. Install

```bash
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=3001
FRONTEND_ORIGIN=http://localhost:8080
NODE_USE_ENV_PROXY=1
HTTP_PROXY=
HTTPS_PROXY=
ALL_PROXY=
NO_PROXY=127.0.0.1,localhost,::1
DB_DRIVER=sqlite
DB_SQLITE_PATH=
VITE_API_BASE_URL=http://localhost:3001
```

Notes:

- `DB_DRIVER=sqlite` 时，Electron 桌面版默认把数据库放到系统应用数据目录
- macOS 默认路径通常是 `~/Library/Application Support/CodexPoolMatrix/codexpoolmatrix.sqlite`
- Windows 默认路径通常是 `%APPDATA%\CodexPoolMatrix\codexpoolmatrix.sqlite`
- 桌面版 OAuth 账号目录默认是系统应用数据目录下的 `accounts/`
- Windows 下通常是 `%APPDATA%\CodexPoolMatrix\accounts\`
- Codex CLI 配置在 Windows 下默认写入 `%USERPROFILE%\.codex\config.toml` 和 `%USERPROFILE%\.codex\auth.json`
- 桌面版默认不会注入示例账号；如需开发期假数据，可设置 `DB_SEED_SAMPLE_DATA=1`
- 如果你仍然想复用 MySQL，把 `DB_DRIVER` 改成 `mysql`，再补齐 `DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME`
- 如果网络依赖本地代理，填写 `HTTP_PROXY / HTTPS_PROXY`

### 4. Run Desktop App

```bash
# Development
npm run electron:dev

# Rebuild desktop icons
npm run icons:build

# Production-like desktop run
npm run build
npm run electron

# Build unpacked desktop app
npm run desktop:pack

# Build unpacked macOS + Windows apps together
npm run desktop:pack:all

# Build unpacked Windows app
npm run desktop:pack:win

# Build release artifacts
npm run desktop:dist

# Build macOS + Windows release artifacts together
npm run desktop:dist:all

# Build Windows installer artifacts
npm run desktop:dist:win

# Desktop runtime smoke test
npm run desktop:smoke

# Desktop functional verification
npm run desktop:verify
```

开发模式会启动：

- Vite renderer: `http://localhost:8080`
- Embedded local API: `http://127.0.0.1:3001`

Electron 渲染层在桌面模式下通过 IPC 调用本地服务，默认不再依赖额外监听的本地 API 端口。
`desktop:smoke` 会在不监听 HTTP 端口的情况下直接验证桌面运行时的核心接口。
`desktop:verify` 会额外覆盖账号、任务、平台、设置等关键增删改查，并在结束后恢复现场。
`desktop:pack` 会输出当前目标的 unpacked 桌面应用到 `release/`，适合先做本机实机验证。
`desktop:pack:all` 会在一次流程里同时输出 macOS 和 Windows 的 unpacked 产物到 `release/`。
`desktop:dist:all` 会额外输出 macOS zip 和 Windows zip；如果环境允许，也会继续生成 Windows `.exe` 安装包。
`desktop:dist:win` 和 `desktop:pack:win` 现在会优先复用仓库内的 `.electron-dist/win32-x64` 运行时缓存；在 macOS 上也可以直接生成 Windows `x64 zip / exe`。

桌面图标源文件位于 `build/icon.svg`，可通过 `npm run icons:build` 重新生成 `build/icon.png` 和 `build/icon.ico`。

桌面版首次启动会自动初始化本地数据库。
Windows 下 OAuth 与 API 中转站依旧会自动写入 `%USERPROFILE%\.codex\config.toml`、`%USERPROFILE%\.codex\auth.json` 与桌面应用数据目录；OpenClaw 自动重载目前只对类 Unix 环境完整支持，Windows 需手动重启 OpenClaw。

### 5. macOS Signing / Notarization

当前仓库已经预留了 Hardened Runtime、entitlements 和 `afterSign` notarization 钩子。

可选配置方式：

- `APPLE_KEYCHAIN_PROFILE`
- 或同时设置 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`

如果这些环境变量不存在，打包会自动跳过 notarization，不影响本机验证。

---

## ➕ Adding Accounts

### 方式一：添加 OAuth 账号（推荐）

1. 点击右上角 **+ 添加账号**
2. 点击 **一键登录新账号**
3. 在弹出的终端中完成浏览器 OAuth 授权
4. 授权成功后账号自动保存 ✅

### 方式二：扫描导入已有 auth 文件

1. 在终端执行 `codex login`，完成授权
2. 复制 auth 文件：`cp ~/.codex/auth.json ~/Desktop/openai-accounts/acc1.json`
3. 点击 **+ 添加账号 → 扫描**，选择文件路径

### 方式三：添加 API 中转站账号

1. 点击右上角 **+ 添加账号**
2. 进入 **API 账号** 视图
3. 填写 `账号名`、`Base URL`、`API Key`
4. 可选填写 `模型名` 和 `CLI Config Snippet`
5. 保存后，这个账号会以 `provider_mode=api` 加入池中

说明：

- API 账号不依赖 `auth.json`
- API 账号不会参与 OAuth Token 刷新
- 切换到 API 账号时，后端会改写 Codex CLI 的 provider / model / base_url / api key 配置
- `CLI Config Snippet` 只写 provider 内的 `key = value`
- 如果填了重复 key、`[model_providers.custom]` 这类 table，或额外写了 `base_url`，保存时会自动静默清洗
- 弹窗里的“最终写入预览”显示的是清洗后的结果

### 账号卡片菜单

- **Set Active**：立刻把这个账号切成当前活跃账号，并同步本地运行时
- **Pause**：取消这个账号的当前活跃状态，并把数据库状态改回 `idle`
- **Reset**：只重置数据库里的本地状态和计数，不会刷新 Token，也不会重置平台侧真实额度
- **Remove**：删除账号记录；如果该账号当前正在使用，会被前后端同时拦截，不能直接删

---

## 🎛 Right Sidebar

右侧栏会自动保存设置，前端有 300ms 防抖，后端保存到 `settings` 表。

### 快捷操作

- **立即切换下一个账号**：立刻执行一次轮换
- **检测所有账号用量**：批量刷新账号卡片状态
- **批量刷新 Token**：对所有 OAuth 账号执行一次手动刷新

### 轮换设置

- **Strategy**
  - `Round Robin`：按顺序轮换
  - `Least Used`：优先选择当前用量最低的账号，推荐
  - `Random`：随机选择
  - `Priority Based`：优先 `team > plus > free`，同组再比用量
- **Auto Rotation**
  - 开启后，后端会定期检查当前活跃账号
  - 当前逻辑只会基于 OAuth 账号的 5h 用量自动切换
  - 达到 90% 时，按当前策略切到下一个可用账号
- **Auto Token Refresh**
  - 开启后，后端会按设定周期批量刷新 OAuth 账号 Token
  - API 中转站账号不会参与这里的刷新
- **Refresh Interval**
  - 当前可选：24h、48h、72h、120h、168h

### Codex 配置

- **Codex Path**
  - 留空时会自动从 PATH、Homebrew、fnm、nvm、Volta 和常见 npm 全局目录探测 `codex`
  - 如果 `which codex` 指向的是 Node 包装脚本，桌面端会自动补齐运行所需 PATH
  - 只有在系统里找不到 `codex` 命令时才需要手动填写

### OpenClaw 集成

- 这是可选功能，不用 OpenClaw 可以直接忽略
- **Reload OpenClaw** 会先同步当前 OAuth 账号到 `~/.openclaw/agents/main/agent/auth-profiles.json`，再尝试重载 OpenClaw
- 当前右侧栏里的 `OpenClaw Endpoint`、`API Key`、`Auto Dispatch` 主要还是预留字段，会保存到数据库，但对当前运行逻辑没有明显直接影响

---

## 🔄 Auto-Rotation

自动轮换会根据当前活跃账号的 5h 用量动态调整检测频率：

| 5h 用量 | 检查间隔 |
|--------|---------|
| < 50%  | 每 30 分钟 |
| 50%–79% | 每 10 分钟 |
| 80%–89% | 每 5 分钟 |
| >= 90% | 本次检查直接切换 |

自动轮换使用右侧栏配置的 `Strategy` 选择目标账号。

---

## ⚠️ Notes

- Auth 文件包含 OAuth Token，请勿提交到版本控制
- OAuth 用量检测调用零 Token 接口，不消耗 Codex 配额
- 自动轮换仅在开启 **自动轮换** 开关时生效
- 自动 Token 刷新仅对 OAuth 账号生效
- 未启用 OpenClaw 时，后端会静默跳过相关同步和监控逻辑
- 当前 UI 主要围绕 Codex 运行时；Claude 相关写入仍属于预留能力，默认不会在主流程里暴露

---

## Repository
https://github.com/songlujie/CodexPoolMatrix

---

## License

MIT

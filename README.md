# AskAll — Web 端多 AI 聚合代理工具

在网页输入问题（可附带多张图片），从约 70 个 AI（复用 ChatALL bot 体系）中勾选 1–5 个，一键并行提问，再由指定"汇总 AI"自动生成最佳答案（上下文超限时自动分多次汇总）。支持注册/登录、凭据管理（Cookie / API Key）、按日期分组的历史记录、中英双语。

## 技术栈

- **后端**：Node.js (≥18) + Express 4 + better-sqlite3 + jsonwebtoken + bcryptjs + axios
- **前端**：Vue3 + Vite + Element Plus + Vuex + vue-router + vue-i18n
- **架构**：单服务器——Express 同时提供 API 与托管前端构建产物（`server/public`）

## 快速开始

```bash
# 1. 安装依赖
cd server && npm install
cd ../web && npm install

# 2. 配置（可选）
cp ../server/.env.example ../server/.env   # 修改 JWT_SECRET 等

# 3. 开发模式（两个进程）
cd server && npm run dev    # Express: http://localhost:3000
cd web && npm run dev       # Vite:    http://localhost:5173 (/api 代理到 3000)

# 4. 生产模式（单进程）
cd web && npm run build     # 构建产物输出到 server/public
cd ../server && npm start   # 访问 http://localhost:3000
```

## 演示模式（无真实凭据）

设置环境变量 `ASKALL_MOCK=1` 后，所有 bot 返回模拟流式回答，可端到端演示完整流程（并行提问 → SSE 进度 → 汇总 → 历史落库）：

```bash
cd server && ASKALL_MOCK=1 npm start
```

## 使用流程

1. 注册/登录。
2. 在「凭据管理」页为所需 bot 配置凭据：网页版 bot 粘贴 Cookie，API 型 bot 填 API Key（推荐先配置 DeepSeek/通义千问/智谱等有免费额度的 API）。
3. 在「提问」页输入问题、勾选 1–5 个 AI、选择汇总 AI，发送。
4. 实时查看各 AI 进度与回答，顶部为汇总结果（分多次时标注轮次）。
5. 「历史记录」页按日期分组查看/删除。

## 目录结构

```
server/
  src/
    index.js        # Express 入口：API + 静态托管
    config.js       # 配置（端口/DB/JWT/汇总预算）
    db.js           # SQLite 连接 + 建表
    auth.js         # 注册/登录 + JWT 中间件
    routes/         # auth / bots / credentials / ask / history
    bots/           # Bot 基类、registry（约70个bot元信息）、凭据仓库、实现
      implementations/
        OpenAICompatibleBot.js  # 覆盖所有 OpenAI 兼容 API（DeepSeek/通义/智谱/Kimi/Groq/xAI/Mistral/OpenRouter/豆包/Yi/ChatGPT…）
        WebBot.js               # 网页版(Cookie)通用适配器（逐站点逆向实现按需补充）
        <botId>.js              # 逐站点逆向实现（集中维护）
    services/       # orchestrator（并行+SSE）/ summarizer（单次+分层分多次）
    credentials/    # 各 bot 凭据 JSON（gitignore，不入库）
web/                # Vue3 前端（views/components/i18n/store/router）
docs/               # 实施计划 / PRD / 开发计划
```

## 关键设计

- **并行**：`Promise.allSettled` 并发调用各 bot；单 bot 失败降级不阻塞整体。
- **实时进度**：`POST /api/ask` 创建任务 → `GET /api/ask/stream/:taskId` SSE 推送状态/增量/汇总。
- **汇总分多次**：按汇总 bot 的 `contextWindow × 0.8` 估算预算，超限先分块出要点再合并，轮次自适应。
- **图片**：仅发送给 `supportsImage` 的 bot，base64 编码，10MB/张、最多 9 张。
- **安全**：bcrypt 密码、JWT(7天)、凭据仅存本地 JSON 文件。

## 扩展新 bot

1. 在 `server/src/bots/registry.js` 添加元信息（id/name/tags/credentialType/supportsImage/contextWindow/baseURL/model）。
2. OpenAI 兼容 API 无需新代码（自动走 `OpenAICompatibleBot`）；网页版逆向在 `bots/implementations/<botId>.js` 继承 `Bot` 实现 `ask()` / `checkAvailability()`。

## 环境变量

见 `server/.env.example`。

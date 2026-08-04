# AskAll — 开发计划 (Development Plan)

- 版本：1.0
- 依据：`askall-web-ai-aggregator-plan.md`（v5）、`PRD.md`

## 1. 技术栈
- **后端**：Node.js(≥18) + Express(4) + better-sqlite3 + jsonwebtoken + bcryptjs + axios + sse.js。
- **前端**：Vue3 + Vite + Element Plus + Vuex + vue-i18n + axios + EventSource(SSE)。
- **架构**：单服务器。Express 同时提供 API 与托管前端构建产物（`server/public`）。

## 2. 目录结构
```
AskAll/
├── docs/                       # 文档（plan / PRD / 开发计划）
├── server/
│   ├── src/
│   │   ├── index.js            # Express 入口：API + 静态托管
│   │   ├── config.js           # 配置（DB、JWT、默认 bot、汇总预算）
│   │   ├── db.js               # better-sqlite3 连接 + 建表
│   │   ├── auth.js             # 注册/登录 + JWT 中间件
│   │   ├── routes/             # auth / bots / credentials / ask / history
│   │   ├── bots/               # 复用 ChatALL src/bots/（约 66 个）
│   │   ├── services/           # orchestrator / summarizer
│   │   └── credentials/        # 各 bot 凭据 JSON（Cookie / API Key，gitignore）
│   ├── package.json
│   └── .env.example
├── web/                        # Vue3 前端
│   ├── src/                    # main.js App.vue api.js store i18n views components styles
│   ├── package.json
│   └── vite.config.js          # dev proxy /api → Express；build → server/public
└── README.md
```

## 3. 关键设计
- **并行**：`Promise.allSettled` 并发调用各 bot 逆向 API。
- **实时进度**：Express `res.write` 走 SSE 推送各 bot 状态与最终回答。
- **汇总**（含分多次）：单次 / 分层分多次，预算 = contextWindow×0.8。
- **凭据**：`credentials/{botId}.json`，网页版存 Cookie、API 型存 API Key。

## 4. 分阶段实施

### 阶段 0：脚手架
- [ ] 初始化 `server`（Express + better-sqlite3 + JWT + dotenv）。
- [ ] 初始化 `web`（Vite + Vue3 + Element Plus + Vuex + vue-i18n）。
- [ ] 配置 vite proxy（`/api` → Express）、`server/public` 静态托管、中英双语 locale。
- [ ] 验证：server 启动、web dev 启动、静态托管。

### 阶段 1：认证与历史
- [ ] 用户表、注册/登录、JWT 中间件。
- [ ] `GET /bots` 元信息接口（含标签/凭据类型）。
- [ ] 历史记录 CRUD（`history_records` / `answer_items`）。
- [ ] 验证：注册/登录、接口鉴权、历史读写。

### 阶段 2：Bot 层适配 + 2 个演示 bot
- [ ] 获取 ChatALL 源码（用户提供路径），拷贝 `src/bots/` 全部文件。
- [ ] 改 `Bot.js`：Electron session 凭据 → 凭据仓库（Cookie/API Key 注入 axios 头）。
- [ ] 去掉 Electron 依赖，改为纯 Node/HTTP 调用。
- [ ] 会话上下文改为单轮新建（去掉全局 store 依赖）。
- [ ] 打通 1 个 Cookie 型 + 1 个 API 型 bot 端到端；实现凭据管理接口。
- [ ] 实现 registry（标签 free/paid/api/madeInChina）。

### 阶段 3：并行编排 + SSE + 汇总
- [ ] `orchestrator` 并行执行、状态回调。
- [ ] `GET /ask/stream/:taskId` SSE 进度流。
- [ ] `summarizer` 单次 + 分层分多次汇总（Token 估算、分块、合并）。
- [ ] 验证：多 bot 并行、进度流、超限分多次路径。

### 阶段 4：前端完整页面
- [ ] 登录/注册、Ask 主页面、凭据管理页、History 页面。
- [ ] 中英双语、路由守卫、图片上传、进度/结果组件。

### 阶段 5：补齐全部 bot
- [ ] 逐个验证约 66 个 bot 逆向 API 可用性，失败归类降级/不可用。

### 阶段 6：收尾
- [ ] 图片支持编码、错误处理（未登录/接口失败降级）、历史详情展示。
- [ ] README、`.env.example`、最终联调。

## 5. 验证方式
- 后端启动后 `GET /api/bots` 返回约 66 项；注册/登录可用。
- 凭据粘贴/校验后 `GET /api/credentials/:botId` 可用。
- 选 2 个已配置 bot 提交，观察 SSE 进度与汇总。
- 调小预算验证"分多次"路径。
- `npm run build` 后访问根路径见前端。
- 历史落库、展开/删除。

## 6. 风险
- 逆向接口随站点改版失效，集中维护；Cloudflare/风控/签名校验。
- 部分 bot 无中国大陆访问，降级处理。
- 多轮汇总消耗配额，前端标注轮次。
- 预算按 bot 动态设置，非全局固定。
# AskAll — Web 端多 AI 聚合代理工具 实施计划（v5：Node + Express + Vue3，全部 ChatALL bot）

## 1. 概述 (Summary)
构建一个 Web 端工具：用户在网页输入问题（可附带多张图片），从 **ChatALL 全部约 66 个 bot** 中勾选 1–5 个，一键并行提问。后端**直接复用 ChatALL 的逆向原理与源码**（Node.js 纯 JS）——调用各 AI 网页版内部 API（网页版用 Cookie、API 型用 API Key，SSE 流式解析），拿回各 AI 回答，再由指定"汇总 AI"自动生成最佳答案。**汇总上下文超限时自动智能分多次**。结果实时展示并存入历史记录，支持用户注册/登录与按日期分组的历史。

关键决策：
- **完全复用 ChatALL bot 逆向代码**：Node.js + 纯 JS，直接拷贝 `src/bots/` 全部 bot 文件，仅做最小改动适配。
- **前端与 ChatALL 一致**：Vue3 + Vite + Element Plus + Vuex + vue-i18n + 中英双语。
- **单服务器架构**：Express 后端同时提供 API + 托管构建后的前端静态资源，开发只需两个进程（Express + Vite dev），生产单进程。
- **数据库**：SQLite（better-sqlite3）。
- **凭据双类型**：网页版 bot 存手动粘贴 Cookie，API 型 bot 存手动输入 API Key，每个 bot 单独 JSON 文件。

## 2. 现状分析 (Current State Analysis)
- 工作目录 `c:\Users\PC\Desktop\AskAll` 为空，全新项目（greenfield）。
- 已确认技术栈：**Node.js + Express + 纯 JS** 后端 + **Vue3 + Vite + Element Plus + Vuex + vue-i18n** 前端，**Express 托管前端**（单服务器）。
- 已确认范围：**ChatALL 全部约 66 个 bot**。凭据分两类：网页版类型用**手动粘贴 Cookie**，API 类型用**填 API Key**，统一在"凭据管理"页配置。
- 已确认分组：按 **ChatALL 标签**（免费 / 付费 / API / 国产）。
- 已确认最多可选 **5 个** AI。
- ChatALL 参考：每个 bot 是"逆向 API 客户端"，用 axios + `sse.js` 流式调用各站点内部接口，用 Electron session Cookie。本项目把 Electron Cookie 换成"用户粘贴的 Cookie / API Key"，其余逻辑几乎原样复用。**直接拷贝 ChatALL `src/bots/` 全部 bot 文件**。

## 3. 技术方案 (Tech Design)
**后端**：Node.js + Express + better-sqlite3 + jsonwebtoken + bcryptjs + axios + sse.js。
**前端**：Vue3 + Vite + Element Plus + Vuex + vue-i18n + axios + EventSource(SSE)。构建产物由 Express 托管。
**并行**：`Promise.allSettled` 并发调用各 bot 逆向 API。
**实时进度**：Express `res.write` 走 SSE 流式推送每个 bot 状态（等待中→回答中→已完成）与最终回答。
**汇总**：汇总 AI 收到【问题 + 各 AI 原始回答】，生成最佳答案；上下文超限时分层分多次。
**凭据**：`credentials/` 目录每 bot 一个 JSON 文件，网页版存 Cookie、API 型存 API Key；管理界面可粘贴/校验/清空。分类标签复用 ChatALL 的 free/paid/api/madeInChina。
**历史**：SQLite 按用户存储 问题、图片、各 AI 回答(JSON)、汇总结果、时间。

### 3.1 目录结构
```
AskAll/
├── server/
│   ├── src/
│   │   ├── index.js            # Express 入口：API 路由 + 托管前端静态资源
│   │   ├── config.js           # 配置（DB 路径、JWT 密钥、默认 bot 列表、汇总预算）
│   │   ├── db.js               # better-sqlite3 连接 + 建表
│   │   ├── auth.js             # 注册/登录 + JWT 中间件
│   │   ├── routes/
│   │   │   ├── auth.js         # POST /register  /login  GET /me
│   │   │   ├── bots.js         # GET /bots 返回全部 bot 元信息（含标签/凭据类型）
│   │   │   ├── credentials.js  # GET/PUT/DELETE /credentials/:botId（Cookie 或 API Key）
│   │   │   ├── ask.js          # POST /ask 创建任务；GET /ask/stream/:taskId SSE
│   │   │   └── history.js      # GET/POST/DELETE 历史记录
│   │   ├── bots/               # 直接复用 ChatALL src/bots/ 全部文件（约 66 个）
│   │   │   ├── Bot.js          # 基类（ChatALL 原样；仅把 Electron session 换成凭据仓库）
│   │   │   ├── index.js        # 注册表（ChatALL 原样；含 free/paid/api/madeInChina 标签）
│   │   │   ├── openai/ anthropic/ google/ microsoft/ baidu/ moonshot/
│   │   │   ├── zhipu/ xai/ cohere/ groq/ huggingface/ poe/ lmsys/
│   │   │   └── ChatGPT4Bot.js  ClaudeAIBot.js  KimiBot.js  ... (其余单文件)
│   │   ├── services/
│   │   │   ├── orchestrator.js # 并行发起、收集各 bot 回答、状态回调
│   │   │   └── summarizer.js   # 汇总（含上下文超限智能分多次）
│   │   └── credentials/        # 各 bot 凭据 JSON（Cookie 或 API Key，gitignore）
│   ├── package.json
│   └── .env.example
├── web/                        # Vue3 前端（与 ChatALL 结构对齐）
│   ├── src/
│   │   ├── main.js  App.vue  api.js  store/index.js  i18n/
│   │   ├── views/  Login.vue  History.vue  Ask.vue  CredentialManage.vue
│   │   ├── components/  BotSelector.vue  ImageUpload.vue  ProgressPanel.vue  ResultPanel.vue
│   │   └── styles/
│   ├── package.json
│   └── vite.config.js          # dev: proxy /api 到 Express；build: 输出到 server/public
└── README.md
```

### 3.2 数据模型（SQLite）
- `users`: id, username(unique), password_hash, created_at。
- `history_records`: id, user_id, question, images(JSON), summary, created_at。
- `answer_items`: id, record_id, bot_id, bot_name, status, answer, error, duration_ms。

### 3.3 Bot 层（复用 ChatALL，仅最小改动）
- **直接复用 ChatALL `src/bots/` 全部文件**（Bot.js 基类 + openai/anthropic/google/microsoft/baidu/moonshot/zhipu/xai/cohere/groq/huggingface/poe/lmsys 等目录 + 各单文件 bot，约 66 个）。
- 每个 bot 用 `axios + sse.js` 流式调用各站点内部接口，累加 SSE 文本，按各 bot 的结束事件判定完成。
- 每 bot 声明 `contextWindow`（供汇总预算）、`supportsImage`、标签归属（free/paid/api/madeInChina）。

**复用 ChatALL 源码需改动的点（最小清单，其余原样）：**
1. **凭据来源**：ChatALL `Bot.js` 从 Electron session 自动带 Cookie（`withCredentials`）。→ 改为从**凭据仓库**读取：网页版 bot 读 `credentials/{botId}.json` 的 Cookie，API 型 bot 读其 API Key。给 axios 统一注入 `Cookie` 头 / Authorization 头。
2. **去掉 Electron 依赖**：不引入 `electron`；`Bot.js` 与各 bot 中用到 `window`/Electron 能力的地方改为纯 Node/HTTP。
3. **会话上下文**：ChatALL 用 Vuex 全局对话（`Chats.getCurrentChat()`、`store.commit("setChatContext")`）支持多轮。→ 本项目为**单轮提问**，每次提问新建上下文，去掉对全局 store 的依赖，改为每个 `ask` 任务内就地管理 context。
4. **i18n 路径**：ChatALL 用 `@/i18n` 别名。→ 保留同结构，后端 bot 层改为直接读统一 copy（或注入 message 对象），不依赖 Vue 组件。
5. **启动/渲染**：ChatALL 是 Electron+Vue 渲染器。→ 由 Express 后端进程调用 bot 层，前端 Vue 通过 API 与 SSE 交互。

其余（并发锁 `AsyncLock`、`_sendPrompt`/`_checkAvailability`/`createChatContext` 结构、各 bot 的 payload/SSE 解析、标签分组）**全部原样复用**。

### 3.4 并行编排与汇总
- `POST /ask`：校验 token、校验 1–5 个 bot、对应 bot 有凭据、接收问题与图片(multipart)，生成 `taskId`，后台启动。
- `orchestrator`：`Promise.allSettled` 并行调各 bot `ask()`，通过事件回调推送状态到 SSE 队列。
- **汇总（含智能分多次）**：
  1. 所有回答就绪后，按汇总 bot 的 `contextWindow` 估算总 Token（中文约 0.5~0.6 token/字，启发式估算器）。
  2. 若总估 Token ≤ 预算（contextWindow×0.8），**单次**汇总：提示词 = 问题 + 各 bot 回答，输出最佳答案。
  3. 若总估 Token > 预算，**分层分多次**：
     - 把回答按"每块≤预算"切分成 K 块（单条过长回答也按字符/Token 再切分）。
     - 第 1 轮：对每块单独请求汇总 bot，产出"该块要点/精简总结"。
     - 第 2 轮：问题 + 各块要点（总量已大幅缩小）→ 最终最佳答案。
     - 轮次数自适应（1 + ceil(块数/每批)）。
- `GET /ask/stream/:taskId`：SSE 推送 `{botId, status, answer?}` 与最终 `{summary, splitRounds, done}`。

### 3.5 前端页面（Vue3 + Element Plus，中英双语）
- **登录/注册**：JWT 存 localStorage，路由守卫，语言切换。
- **主页面 Ask**：输入区（文本框 + 图片上传缩略图）、AI 选择区（按 ChatALL 标签分 免费/付费/API/国产 四组折叠面板，复选框，显示"已选 x/5"，超 5 个提示）、汇总 AI 下拉（默认 ChatGPT）、发送按钮（防重复点击）。
- **凭据管理页 CredentialManage**：66 个 bot 各一个折叠面板，网页版 bot 粘贴/校验/清空 Cookie，API 型 bot 填/校验/清空 API Key，展示可用状态。
- **进度区**：每 bot 一行，状态 等待中→回答中→已完成，先完成先显示。
- **结果区**：顶部汇总结果（默认展开，分多次则标注轮次），下方各 AI 原始回答可折叠，长文本滚动。
- **历史页 History**：按日期分组列表，每条显示时间+问题摘要，点击展开详情（完整问题、图片、各 AI 回答、汇总），删除按钮二次确认。
- **i18n**：`web/src/i18n/` 中英双语，复用 ChatALL 的 locale 结构（zh-CN/en-US）。

### 3.6 静态托管与运行
- 开发：`web` 下 `npm run dev`（Vite，`/api` 代理到 Express）＋ `server` 下 `npm run dev`。
- 生产：`web` 下 `npm run build` 输出到 `server/public`，`node src/index.js` 单服务器同时提供 API 与前端。

## 4. 分阶段实施步骤 (Implementation Steps)
**阶段 0：脚手架**
- 初始化 `server`（Express + better-sqlite3 + JWT）与 `web`（Vite + Vue3 + Element Plus + Vuex + vue-i18n）工程。
- 配置 vite proxy、`server/public` 静态托管、中英双语 locale。

**阶段 1：认证与历史**
- 用户表、注册/登录、JWT 中间件；`/bots` 元信息接口；历史记录 CRUD。

**阶段 2：Bot 层适配 + 2 个演示 bot（逆向 API）**
- 拷贝 ChatALL `src/bots/` 全部文件；把 `Bot.js` 的 Electron session 读取改为"凭据仓库"读取。
- 先打通 `deepseek/kimi` 类、`chatgpt` 类端到端（一个 Cookie 型 + 一个 API 型）；实现凭据管理接口。
- 实现 `registry`（标签 free/paid/api/madeInChina 来自 ChatALL `index.js`）。

**阶段 3：并行编排 + SSE + 汇总（含智能分多次）**
- `orchestrator` 并行执行、SSE 进度流、`summarizer` 单次 + 分层分多次汇总。

**阶段 4：前端完整页面**
- 登录/注册、Ask 主页面、凭据管理页、History 页面（Vue3 + Element Plus + 中英双语）。

**阶段 5：补齐全部 bot**
- 逐个验证 66 个 bot 的逆向 API 可用性（复用 ChatALL 对应文件），分类处理失败/降级。

**阶段 6：收尾**
- 图片支持编码、错误处理（未登录/接口失败降级）、历史详情展示、README、`.env.example`。

## 5. 假设与决策 (Assumptions & Decisions)
- 汇总 AI：默认取用户所选 AI 之一中最强（默认 ChatGPT），可下拉改为任意 66 个之一；汇总 bot 同样需已配置凭据。
- **上下文超限处理**：分层分多次——先分块各出要点，再合并要点出最终答案；每块预算按汇总 bot 的 `contextWindow` 动态计算，轮次自适应。
- 图片：仅发送给支持图片的 bot（`supportsImage` 标记），其余忽略并提示。
- 凭据：网页版存 Cookie、API 型存 API Key，存 `server/src/credentials/{botId}.json`，便于导出/备份。
- 数据库用 SQLite（better-sqlite3），单机工具，后续可迁移。
- 界面中英双语，复用 ChatALL 的 i18n（zh-CN/en-US）结构。
- 逆向接口可能随网站改版失效，需在 bot 文件内集中维护；部分 bot 因反爬/无中国大陆访问可能不可用，按失败降级处理。

## 6. 验证方式 (Verification)
- 后端：`node src/index.js` 启动，浏览器访问 `/api/bots` 返回全部 bot（约 66 项）；注册/登录可用。
- 凭据：粘贴某 Cookie / 填某 API Key 后，`GET /api/credentials/:botId` 校验状态。
- 端到端：选 2 个已配置 bot（一个 Cookie 型 + 一个 API 型），提交问题，观察 SSE 进度流与汇总结果生成。
- 汇总超限：构造超长回答（或临时调小预算）验证触发"分多次"路径，确认轮次与最终答案正确。
- 前端静态托管：`npm run build` 后访问根路径能看到前端页面。
- 历史：确认记录落库，历史页可展开/删除。
- 全量：逐个 bot 跑一次冒烟，失败的归类到降级/不可用。

## 7. 风险与注意事项 (Risks)
- 逆向 API 依赖各站点具体接口与请求头，改版会失效，需集中维护；部分站点有 Cloudflare/风控，可能需要额外请求头或 Cookie 更新。
- 部分站点会校验签名（如 Gemini 的 proto、Perplexity 的 token），需按 ChatALL 对应实现补齐。
- 汇总多轮会额外消耗请求次数与账号配额，需在前端标注轮次。
- 不同 bot 上下文窗口差异大，预算需按 bot 动态设置而非全局固定。
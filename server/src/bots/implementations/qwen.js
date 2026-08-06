const Bot = require("../Bot");

/**
 * 通义千问（QianWen）网页版适配器，移植自 ChatALL 的 QianWenBot.js。
 *
 * 适配要点：
 *  - 凭据：Cookie 形式，由 buildHeaders() 自动注入；x-xsrf-token 从 Cookie 中
 *    的 xsrf_token 字段提取（原 ChatALL 从 Vuex store 读取，这里改为正则解析）。
 *  - 单轮问答：每次 ask() 都新建会话（合并 createChatContext 到 ask()）。
 *  - SSE：原 sse.js 改用 Bot.post({stream:true}) + Bot.consumeSSE。
 *  - 累积内容：QianWen 每条 SSE 的 contents 是当前累积全文，需要计算 delta
 *    后再回调 onUpdate。
 */

function generateRandomId() {
  let s = "";
  for (let i = 0; i < 32; i++) {
    s += Math.floor(Math.random() * 16).toString(16);
  }
  return s;
}

class QianWenBot extends Bot {
  /** 从 Cookie 字符串中提取 xsrf_token，用作 x-xsrf-token 请求头。 */
  extractXsrfToken(cookieStr) {
    if (!cookieStr) return "";
    const m = String(cookieStr).match(/xsrf_token=([^;]+)/);
    return m ? m[1] : "";
  }

  /** 构造带 xsrf_token 的请求头。 */
  buildRequestHeaders() {
    const headers = this.buildHeaders();
    headers["x-xsrf-token"] = this.extractXsrfToken(headers.Cookie || "");
    return headers;
  }

  /** 新建会话，返回 { sessionId, userId, parentMsgId }。 */
  async createChatContext() {
    const res = await Bot.post(
      "https://qianwen.aliyun.com/addSession",
      { firstQuery: "AskAll", sessionType: "text_chat" },
      this.buildRequestHeaders(),
      { stream: false, timeout: 15000 }
    );
    if (res.data && res.data.success && res.data.data && res.data.data.sessionId) {
      return {
        sessionId: res.data.data.sessionId,
        userId: res.data.data.userId,
        parentMsgId: "0",
      };
    }
    throw new Error(
      `${this.name}: 创建会话失败 - ${res.data?.errorCode || ""} ${res.data?.errorMsg || ""}`
    );
  }

  async ask(prompt, images = [], onUpdate) {
    if (process.env.ASKALL_MOCK === "1") {
      const text = `[模拟回答 - ${this.name}] 针对问题「${prompt.slice(0, 60)}」的回答：这是 ${this.name}（网页版）在 ASKALL_MOCK 模式下生成的演示回答。`;
      if (onUpdate) {
        for (const ch of text) {
          await new Promise((r) => setTimeout(r, 8));
          onUpdate(ch);
        }
      }
      return text;
    }

    const cred = this.getCredential();
    if (!cred) throw new Error(`${this.name}: 未配置凭据`);

    // 单轮问答：每次新建会话
    const context = await this.createChatContext();

    const headers = {
      ...this.buildRequestHeaders(),
      accept: "text/event-stream",
      "content-type": "application/json",
    };

    const body = {
      action: "next",
      contents: [
        { contentType: "text", content: prompt, role: "user" },
      ],
      mode: "chat",
      model: "",
      parentMsgId: context.parentMsgId || "",
      requestId: generateRandomId(),
      sessionId: context.sessionId,
      sessionType: "text_chat",
      userAction: context.parentMsgId ? "chat" : "new_top",
    };

    const res = await Bot.post(
      "https://qianwen.biz.aliyun.com/dialog/conversation",
      body,
      headers,
      { stream: true }
    );

    if (res.status !== 200) {
      let detail = "";
      try {
        detail = typeof res.data === "string" ? res.data.slice(0, 200) : JSON.stringify(res.data).slice(0, 200);
      } catch (e) { /* ignore */ }
      throw new Error(`${this.name}: HTTP ${res.status} ${detail}`);
    }

    let answer = "";
    let lastContent = "";
    let streamError = null;

    await Bot.consumeSSE(res.data, (data, raw) => {
      if (streamError) return;
      // 空消息通常表示错误（原 ChatALL 行为）
      if (!data) return;
      if (data.failed) {
        streamError = new Error(
          `${this.name}: ${data.errorCode || ""} ${data.errorMsg || ""}`.trim()
        );
        return;
      }
      const contents = data.contents || [];
      if (contents.length === 0) return;

      const pieces = [];
      for (const item of contents) {
        switch (item.contentType) {
          case "plugin":
            pieces.push(`> Plugin: ${item.pluginName}\n`);
            break;
          case "text":
            pieces.push(`${item.content}\n`);
            break;
          case "referenceLink": {
            let links = [];
            try {
              const parsed = JSON.parse(item.content);
              links = (parsed && parsed.links) || [];
            } catch (e) {
              /* ignore parse error */
            }
            pieces.push(
              `> 相关链接 · ${links.length}\n` +
                links.map((l) => `> - [${l.title}](${l.url})`).join("\n") +
                "\n"
            );
            break;
          }
          default:
            pieces.push(`> *UNKNOWN CONTENT TYPE:* ${item.contentType}\n`);
        }
      }

      const content = pieces.join("\n").trim();
      if (!content) return;

      // QianWen 每条 SSE 是累积全文，计算增量后回调
      let delta = "";
      if (lastContent && content.startsWith(lastContent)) {
        delta = content.slice(lastContent.length);
      } else {
        delta = content;
      }
      lastContent = content;

      if (delta) {
        answer += delta;
        if (onUpdate) onUpdate(delta);
      }
    });

    if (streamError) throw streamError;
    if (!answer) throw new Error(`${this.name}: 空回答（流中断或未授权）`);
    return answer;
  }

  async checkAvailability() {
    if (process.env.ASKALL_MOCK === "1") return !!this.getCredential();
    if (!this.getCredential()) return false;
    try {
      const res = await Bot.post(
        "https://qianwen.aliyun.com/querySign",
        {},
        this.buildRequestHeaders(),
        { stream: false, timeout: 15000 }
      );
      return !!(res.data && res.data.success);
    } catch (e) {
      return false;
    }
  }
}

module.exports = QianWenBot;

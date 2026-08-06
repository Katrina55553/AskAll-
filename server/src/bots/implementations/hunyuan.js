const Bot = require("../Bot");

/**
 * 腾讯元宝（yuanbao.tencent.com）网页版适配器，参考 chenwr727/yuanbao-free-api
 * （Python）及公开抓包资料逆向实现。未经实测——接口字段可能随官方更新而失效。
 *
 * 请求流程：
 *   1. POST /api/user/agent/conversation/create  → 创建会话，返回 { id: chat_id }
 *   2. POST /api/chat/{chat_id}                   → SSE 流式对话
 *
 * 认证：Cookie（关键字段 hy_user、hy_token），由 buildHeaders() 自动注入。
 * agent_id：默认 naQivTmsDa（元宝默认智能体），可通过 HUNYUAN_AGENT_ID 覆盖。
 * 模型：默认 hunyuan，可通过 HUNYUAN_MODEL 覆盖（见 MODEL_MAP）。
 *
 * 已知限制：
 *   - 图片上传需 COS 签名（HmacSHA1 / SHA1，见公开逆向资料），暂未实现，
 *     忽略 images 参数（supportsImage 在 registry 中为 true 但实际仅文本可用）。
 *   - hy_token 有时效性，过期后需重新从浏览器获取 Cookie。
 *   - SSE 文本字段以 msg 为主（累积全文，需计算后缀增量），附 text/content 回退。
 */
class HunyuanBot extends Bot {
  static BASE = "https://yuanbao.tencent.com";
  static DEFAULT_AGENT_ID = "naQivTmsDa";
  static DEFAULT_MODEL = "hunyuan";

  // 模型名 → chatModelId 映射（参考 yuanbao-free-api/src/const.py）
  static MODEL_MAP = {
    hunyuan: "hunyuan_gpt_175B_0404",
    "hunyuan-t1": "hunyuan_t1",
    "hunyuan-search": "hunyuan_gpt_175B_0404",
    "hunyuan-t1-search": "hunyuan_t1",
    "deepseek-v3": "deep_seek_v3",
    "deepseek-r1": "deep_seek",
    "deepseek-v3-search": "deep_seek_v3",
    "deepseek-r1-search": "deep_seek",
  };

  // 带 search 后缀的模型需追加 supportFunctions: ["supportInternetSearch"]
  static SEARCH_MODELS = new Set([
    "hunyuan-search",
    "hunyuan-t1-search",
    "deepseek-v3-search",
    "deepseek-r1-search",
  ]);

  getAgentId() {
    return process.env.HUNYUAN_AGENT_ID || HunyuanBot.DEFAULT_AGENT_ID;
  }

  getModel() {
    return process.env.HUNYUAN_MODEL || HunyuanBot.DEFAULT_MODEL;
  }

  /** 构造带 Referer/Origin 的请求头（Tencent 接口通常校验 Referer）。 */
  buildAuthHeaders() {
    const headers = this.buildHeaders();
    const agentId = this.getAgentId();
    headers["Referer"] = `${HunyuanBot.BASE}/chat/${agentId}`;
    headers["Origin"] = HunyuanBot.BASE;
    headers["Accept"] = "application/json, text/plain, */*";
    return headers;
  }

  /** 创建会话，返回 chat_id。 */
  async createConversation() {
    const agentId = this.getAgentId();
    const res = await Bot.post(
      `${HunyuanBot.BASE}/api/user/agent/conversation/create`,
      { agentId },
      this.buildAuthHeaders(),
      { stream: false, timeout: 15000 }
    );
    if (res.status !== 200 || !res.data || !res.data.id) {
      let detail = "";
      try {
        detail =
          typeof res.data === "string"
            ? res.data.slice(0, 200)
            : JSON.stringify(res.data || {}).slice(0, 200);
      } catch (e) {
        /* ignore */
      }
      throw new Error(
        `${this.name}: 创建会话失败（HTTP ${res.status}）${detail}`
      );
    }
    return res.data.id;
  }

  /** 清理会话（best-effort，失败不影响主流程）。 */
  async clearConversation(chatId) {
    try {
      await Bot.post(
        `${HunyuanBot.BASE}/api/user/agent/conversation/v1/clear`,
        { conversationIds: [chatId], uiOptions: { noToast: true } },
        this.buildAuthHeaders(),
        { stream: false, timeout: 15000 }
      );
    } catch (e) {
      /* best-effort */
    }
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
    const chatId = await this.createConversation();

    const model = this.getModel();
    const chatModelId =
      HunyuanBot.MODEL_MAP[model] ||
      HunyuanBot.MODEL_MAP[HunyuanBot.DEFAULT_MODEL];
    const supportFunctions = HunyuanBot.SEARCH_MODELS.has(model)
      ? ["supportInternetSearch"]
      : null;

    const headers = {
      ...this.buildAuthHeaders(),
      accept: "text/event-stream",
    };

    // 请求体参考 yuanbao-free-api/src/services/chat/completion.py
    const body = {
      model: "gpt_175B_0404",
      prompt,
      plugin: "Adaptive",
      displayPrompt: prompt,
      displayPromptType: 1,
      options: {
        imageIntention: {
          needIntentionModel: true,
          backendUpdateFlag: 2,
          intentionStatus: true,
        },
      },
      multimedia: [],
      agentId: this.getAgentId(),
      supportHint: 1,
      version: "v2",
      chatModelId,
    };
    if (supportFunctions) body.supportFunctions = supportFunctions;

    const res = await Bot.post(
      `${HunyuanBot.BASE}/api/chat/${chatId}`,
      body,
      headers,
      { stream: true }
    );

    if (res.status !== 200) {
      throw new Error(`${this.name}: HTTP ${res.status}`);
    }

    let answer = "";
    let lastMsg = "";
    let finished = false;
    let streamError = null;

    await Bot.consumeSSE(res.data, (data) => {
      if (streamError) return;
      if (!data || typeof data !== "object") return;

      // 错误信号
      if (data.error || data.errorMsg || data.errorCode) {
        streamError = new Error(
          `${this.name}: ${data.error || ""} ${data.errorCode || ""} ${data.errorMsg || ""}`.trim()
        );
        return;
      }

      // 提取文本（msg 为主，回退到 text/content/message/answer/delta）
      let text =
        data.msg != null ? data.msg :
        data.text != null ? data.text :
        data.content != null ? data.content :
        data.message != null ? data.message :
        data.answer != null ? data.answer :
        data.delta != null ? data.delta : "";
      if (typeof text !== "string") {
        try {
          text = JSON.stringify(text);
        } catch (e) {
          text = "";
        }
      }

      if (text) {
        // hunyuan 的 msg 通常为累积全文，计算后缀增量
        let delta = "";
        if (lastMsg && text.startsWith(lastMsg)) {
          delta = text.slice(lastMsg.length);
        } else if (text !== lastMsg) {
          delta = text;
        }
        lastMsg = text;
        if (delta) {
          answer += delta;
          if (onUpdate) onUpdate(delta);
        }
      }

      // 完成信号
      if (data.stopReason || data.stop_reason || data.finished === true) {
        finished = true;
      }
    });

    if (streamError) throw streamError;
    if (!answer) {
      throw new Error(
        `${this.name}: 空回答（流中断或未授权）${finished ? "" : "（未收到完成信号）"}`
      );
    }
    return answer;
  }

  async checkAvailability() {
    if (process.env.ASKALL_MOCK === "1") return !!this.getCredential();
    if (!this.getCredential()) return false;
    try {
      // 创建临时会话验证 Cookie 有效性，随后清理
      const chatId = await this.createConversation();
      await this.clearConversation(chatId);
      return true;
    } catch (e) {
      return false;
    }
  }
}

module.exports = HunyuanBot;

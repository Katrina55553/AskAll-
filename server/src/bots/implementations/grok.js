const Bot = require("../Bot");
const axios = require("axios");
const crypto = require("crypto");

/**
 * Grok (grok.com) web adapter — reverse-engineered.
 *
 * ⚠️ 未经实测（UNVERIFIED）：本适配器基于公开逆向资料实现，未对 grok.com 线上服务
 * 进行端到端验证。xAI 持续加强风控，实际可用性以线上为准。
 *
 * 认证：Cookie。从已登录浏览器复制完整 Cookie（至少包含 sso / sso-rw；若被
 * Cloudflare 拦截还需 cf_clearance）。Cookie 由 Bot.buildHeaders 注入。
 *
 * 请求流程（REST/SSE 路径，参照 LLM-Red-Team grok-free-api 等公开实现）：
 *   POST https://grok.com/rest/app-chat/conversations/new
 *   一次性“建会话 + 流式回答”，响应为 text/event-stream。
 *
 * 风控说明：
 *   - grok.com 位于 Cloudflare 之后，纯 Node 无法解 JS 挑战，需在 Cookie 中携带
 *    有效的 cf_clearance；否则通常返回 403，此处给出明确提示。
 *   - xAI 近期引入 x-statsig-id 反爬头，真实值需由浏览器环境或第三方签名服务生成。
 *     此处仅生成占位值作为 best-effort；若被风控拒绝，请改用官方 Grok API（grok-api）。
 *   - 截至 2026 年中，官方网页端已部分迁移至 WebSocket 网关（wss://grok.com/ws/mgw/）
 *     与 Realtime 风格事件协议；该路径依赖 ws 库与外部签名，超出本单文件适配范围，
 *     故仍采用 REST/SSE 路径并在解析层兼容多种事件形态以提升鲁棒性。
 *
 * 单轮：每次 ask() 创建临时会话，结束即弃用（与 kimi.js/chatgpt.js 一致）。
 * SSE：流式 token 为增量（delta），直接拼接；reasoning 思考 token 不计入回答正文。
 */
class GrokBot extends Bot {
  static BASE = "https://grok.com";

  /** grok.com 的 modelSlug，可通过 ASKALL_GROK_MODEL_SLUG 覆盖。 */
  _modelSlug() {
    return process.env.ASKALL_GROK_MODEL_SLUG || "grok-3";
  }

  _looksLikeCloudflare(res) {
    const headers = res.headers || {};
    const server = String(headers["server"] || "").toLowerCase();
    const cfMitigated = String(headers["cf-mitigated"] || "").toLowerCase();
    if (
      server.includes("cloudflare") ||
      cfMitigated.includes("challenge") ||
      cfMitigated.includes("block")
    ) {
      return true;
    }
    const body =
      typeof res.data === "string" ? res.data : JSON.stringify(res.data || "");
    return (
      body.includes("cloudflare") ||
      body.includes("Just a moment") ||
      body.includes("cf-challenge")
    );
  }

  _readStream(stream) {
    return new Promise((resolve, reject) => {
      let data = "";
      stream.on("data", (c) => (data += c.toString("utf8")));
      stream.on("end", () => resolve(data));
      stream.on("error", reject);
    });
  }

  /**
   * 生成 best-effort x-statsig-id（占位）。
   * 真实值需由浏览器 Statsig SDK 或第三方签名服务产出；此处仅满足字段存在性，
   * 不能保证通过风控。结构参考公开实现：base64(JSON({uid,sid,st,...}))。
   */
  _statsigId() {
    const payload = {
      uid: crypto.randomUUID(),
      sid: crypto.randomUUID(),
      st: Date.now(),
    };
    return Buffer.from(JSON.stringify(payload)).toString("base64");
  }

  /** 同源 fetch 所需的稳定请求头（参照真实浏览器 fetch）。 */
  _appHeaders() {
    return {
      Origin: GrokBot.BASE,
      Referer: GrokBot.BASE + "/",
      Accept: "text/event-stream",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "x-xai-request-id": crypto.randomUUID(),
      "x-statsig-id": this._statsigId(),
    };
  }

  /**
   * 从一条 SSE 事件 JSON 中抽取增量文本。
   * 兼容多种形态：经典 grok-free-api（result.response.token）、
   * message/text 变体、以及 Realtime 网关风格（response.output_text.delta /
   * response.chunk）。返回 { text, reasoning } 或 null。
   */
  _extractDelta(json) {
    if (!json || typeof json !== "object") return null;

    // 服务端在流中直接抛错
    if (json.error && typeof json.error === "object") {
      const msg = json.error.message || json.error.code;
      if (msg) return { error: String(msg) };
    }

    const resp = json.result && json.result.response;
    if (resp && typeof resp === "object") {
      if (typeof resp.token === "string")
        return { text: resp.token, reasoning: !!resp.isReasoning };
      if (typeof resp.message === "string")
        return { text: resp.message, reasoning: !!resp.isReasoning };
      if (typeof resp.text === "string")
        return { text: resp.text, reasoning: !!resp.isReasoning };
      // 流错误有时内嵌在 response.streamError
      if (resp.streamError && typeof resp.streamError === "object") {
        const m = resp.streamError.message || resp.streamError.code;
        if (m) return { error: String(m) };
      }
      return null;
    }

    // Realtime / 网关风格事件（防御性兼容）
    const evt = json.event;
    if (evt && typeof evt === "object") {
      const t = evt.type;
      if (t === "error") {
        const m = (evt.error && (evt.error.message || evt.error.code)) || "未知错误";
        return { error: String(m) };
      }
      if (t === "response.output_text.delta" && typeof evt.delta === "string")
        return { text: evt.delta };
      if (t === "response.chunk" && evt.chunk && evt.chunk.text) {
        const txt = evt.chunk.text.text;
        if (typeof txt === "string") {
          const reasoning = /ANALYSIS|REASONING/i.test(
            evt.chunk.text.channel || ""
          );
          return { text: txt, reasoning };
        }
      }
    }

    if (typeof json.delta === "string") return { text: json.delta };
    if (typeof json.token === "string") return { text: json.token };
    return null;
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
    if (!cred) throw new Error(`${this.name}: 未配置 Cookie`);

    // 单轮：建会话即提问，结束即弃用。
    const payload = {
      temporary: false,
      modelSlug: this._modelSlug(),
      message: prompt,
      fileAttachments: [],
      imageAttachments: [],
      disableSearch: true,
      enableImageGeneration: false,
      returnImageBytes: false,
      returnRawGrokInXaiRequest: false,
      enableImageStreaming: false,
      imageGenerationCount: 2,
      forcePrivacyMode: false,
      toolOverrides: {},
      isReasoning: false,
      webpageUrls: [],
      disableTextFollowUps: false,
      enablePrivateMode: false,
      customInstructions: "",
      deepsearchPreset: "",
      isPreset: false,
      sendFinalMetadata: true,
      customPersonas: [],
    };

    const res = await Bot.post(
      `${GrokBot.BASE}/rest/app-chat/conversations/new`,
      payload,
      { ...this.buildHeaders(), ...this._appHeaders() },
      { stream: true }
    );

    if (res.status !== 200) {
      const bodyText = await this._readStream(res.data);
      if (
        (res.status === 403 || res.status === 503) &&
        this._looksLikeCloudflare({ headers: res.headers, data: bodyText })
      ) {
        throw new Error(
          `${this.name}: 请求被 Cloudflare 拦截，可能需要在 Cookie 中包含 cf_clearance（请从浏览器复制完整 Cookie）`
        );
      }
      throw new Error(
        `${this.name}: completion 请求失败（HTTP ${res.status}）${bodyText.slice(0, 200)}`
      );
    }

    let answer = "";
    let streamError = "";
    await Bot.consumeSSE(res.data, (json) => {
      const delta = this._extractDelta(json);
      if (!delta) return;
      if (delta.error) {
        streamError = delta.error;
        return;
      }
      if (!delta.text || delta.reasoning) return; // 跳过思考 token
      answer += delta.text;
      if (onUpdate) onUpdate(delta.text);
    });

    if (streamError && !answer) {
      throw new Error(`${this.name}: 服务端流错误：${streamError}`);
    }
    if (!answer) {
      throw new Error(
        `${this.name}: 空回答（流中断或被风控拦截；可能需要有效的 x-statsig-id / cf_clearance）`
      );
    }
    return answer;
  }

  async checkAvailability() {
    if (process.env.ASKALL_MOCK === "1") return !!this.getCredential();
    if (!this.getCredential()) return false;
    try {
      // 轻量探测：列出会话列表。200 视为可用；401/403（非 CF）视为凭据失效。
      const res = await axios.get(
        `${GrokBot.BASE}/rest/app-chat/conversations`,
        {
          headers: { ...this.buildHeaders(), ...this._appHeaders() },
          params: { order: "desc", limit: 1 },
          timeout: 15000,
          validateStatus: () => true,
        }
      );
      if ((res.status === 403 || res.status === 503) && this._looksLikeCloudflare(res)) {
        return false;
      }
      return res.status === 200;
    } catch (e) {
      return false;
    }
  }
}

module.exports = GrokBot;

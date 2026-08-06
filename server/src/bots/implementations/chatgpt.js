const Bot = require("../Bot");
const axios = require("axios");
const crypto = require("crypto");

/**
 * ChatGPT (chatgpt.com) web adapter, ported from ChatALL's ChatGPTBot.
 *
 * Auth: Cookie-based. The full Cookie string from a logged-in browser session
 * is sent as-is (Bot.buildHeaders injects it). ChatALL stored accessToken on
 * the bot instance and refreshed it via the Electron/Vuex session; here we
 * resolve it dynamically per call via GET /api/auth/session (mirrors claude.js's
 * dynamic org-uuid resolution).
 *
 * CSRF: backend-api endpoints expect an X-CSRF-Token header. We fetch it
 * dynamically via GET /api/auth/csrf (the value also matches the
 * __Host-next-auth.csrf-token cookie, but the API is simpler and authoritative).
 *
 * Sentinel: POST /backend-api/sentinel/chat-requirements returns a one-shot
 * token that must be sent as Openai-Sentinel-Chat-Requirements-Token on the
 * completion request. It may also flag arkose as required — that flow needs a
 * browser DOM (document.createElement / window.setupEnforcement) and is NOT
 * supported in pure Node; we surface a clear error.
 *
 * Cloudflare: chatgpt.com sits behind Cloudflare. Pure Node cannot solve CF's
 * JS challenge, so the user MUST include a valid cf_clearance cookie copied
 * from a real browser. Without it, requests typically return 403 — we detect
 * that and surface a clear error instead of a generic failure.
 *
 * Single-turn: a fresh conversation_id is created per ask() (sent as undefined
 * to backend-api/conversation) and abandoned after — no createChatContext().
 *
 * SSE: ChatGPT streams `event: <type>\ndata: {<json>}` blocks. Each data
 * line is a single JSON object whose data.message.content.parts[0] holds the
 * FULL accumulated answer text so far (not a delta). We diff against the last
 * seen text to compute the delta for onUpdate. Stream terminates with
 * `data: [DONE]`. The base consumeSSE skips [DONE] and ignores `event:` lines.
 */
class ChatGPTBot extends Bot {
  static BASE = "https://chatgpt.com";

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

  /** Exchange the session Cookie for a short-lived accessToken (cached). */
  async getAccessToken() {
    if (this._accessToken) return this._accessToken;
    const res = await axios.get(`${ChatGPTBot.BASE}/api/auth/session`, {
      headers: this.buildHeaders(),
      timeout: 15000,
      validateStatus: () => true,
    });
    if (res.status === 403 && this._looksLikeCloudflare(res)) {
      throw new Error(
        `${this.name}: 请求被 Cloudflare 拦截，可能需要在 Cookie 中包含 cf_clearance（请从浏览器复制完整 Cookie）`
      );
    }
    if (res.status !== 200 || !res.data?.accessToken) {
      throw new Error(
        `${this.name}: 获取 accessToken 失败（HTTP ${res.status}），Cookie 可能已过期或被 Cloudflare 拦截`
      );
    }
    this._accessToken = res.data.accessToken;
    return this._accessToken;
  }

  /** Fetch X-CSRF-Token from the NextAuth csrf endpoint. */
  async getCsrfToken(accessToken) {
    const res = await axios.get(`${ChatGPTBot.BASE}/api/auth/csrf`, {
      headers: {
        ...this.buildHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
      timeout: 15000,
      validateStatus: () => true,
    });
    if (res.status !== 200 || !res.data?.csrfToken) {
      throw new Error(`${this.name}: 获取 CSRF Token 失败（HTTP ${res.status}）`);
    }
    return res.data.csrfToken;
  }

  /** Fetch the sentinel chat-requirements token (one-shot). Returns null if the
   *  endpoint is unavailable (older flows); throws if arkose is required. */
  async getRequirementToken(accessToken) {
    const res = await axios.post(
      `${ChatGPTBot.BASE}/backend-api/sentinel/chat-requirements`,
      undefined,
      {
        headers: {
          ...this.buildHeaders(),
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        timeout: 15000,
        validateStatus: () => true,
      }
    );
    if (res.status === 403 && this._looksLikeCloudflare(res)) {
      throw new Error(
        `${this.name}: 请求被 Cloudflare 拦截，可能需要在 Cookie 中包含 cf_clearance（请从浏览器复制完整 Cookie）`
      );
    }
    if (res.status !== 200) return null; // non-fatal: older endpoints may not require it
    if (res.data?.arkose?.required) {
      throw new Error(
        `${this.name}: 触发 Arkose 验证，无法在 Node 环境中处理（请在浏览器完成验证后刷新 Cookie）`
      );
    }
    return res.data?.token || null;
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

    // images: not wired (web attachment upload flow via backend-api/files not implemented)
    const accessToken = await this.getAccessToken();
    const csrfToken = await this.getCsrfToken(accessToken);
    const requirementToken = await this.getRequirementToken(accessToken);

    const headers = {
      ...this.buildHeaders(),
      Authorization: `Bearer ${accessToken}`,
      "X-CSRF-Token": csrfToken,
      accept: "text/event-stream",
    };
    if (requirementToken) {
      headers["Openai-Sentinel-Chat-Requirements-Token"] = requirementToken;
    }

    // Single-turn: send conversation_id undefined so the server starts a fresh
    // conversation; matches ChatALL's createChatContext() initial state.
    const payload = {
      action: "next",
      conversation_mode: { kind: "primary_assistant" },
      messages: [
        {
          id: crypto.randomUUID(),
          author: { role: "user" },
          content: { content_type: "text", parts: [prompt] },
          metadata: {},
        },
      ],
      conversation_id: undefined,
      parent_message_id: crypto.randomUUID(),
      model: "",
      history_and_training_disabled: false,
    };

    const res = await Bot.post(
      `${ChatGPTBot.BASE}/backend-api/conversation`,
      payload,
      headers,
      { stream: true }
    );

    if (res.status !== 200) {
      const bodyText = await this._readStream(res.data);
      if (
        res.status === 403 &&
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

    // ChatGPT emits the FULL accumulated text on each event in
    // message.content.parts[0]; compute delta against last seen.
    let lastText = "";
    let answer = "";
    await Bot.consumeSSE(res.data, (json) => {
      if (!json || !json.message) return;
      // Skip the final duplicate "is_complete" message (repeats prior content).
      if (json.message?.metadata?.is_complete) return;
      const content = json.message.content;
      if (!content) return;
      if (
        content.content_type === "text" &&
        Array.isArray(content.parts) &&
        typeof content.parts[0] === "string"
      ) {
        const fullText = content.parts[0];
        if (fullText === lastText) return;
        if (fullText.startsWith(lastText)) {
          const delta = fullText.slice(lastText.length);
          answer = fullText;
          lastText = fullText;
          if (onUpdate) onUpdate(delta);
        } else {
          // Non-appendable update (rare; defensive): emit the full text once.
          answer = fullText;
          lastText = fullText;
          if (onUpdate) onUpdate(fullText);
        }
      }
      // content_type === "code" | "system_error" (Python tool preprocessing)
      // is intentionally ignored — only the final text answer is surfaced.
    });
    if (!answer) {
      throw new Error(`${this.name}: 空回答（流中断或被拦截）`);
    }
    return answer;
  }

  async checkAvailability() {
    if (process.env.ASKALL_MOCK === "1") return !!this.getCredential();
    if (!this.getCredential()) return false;
    try {
      await this.getAccessToken();
      return true;
    } catch (e) {
      return false;
    }
  }
}

module.exports = ChatGPTBot;

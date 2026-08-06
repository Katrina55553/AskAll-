const Bot = require("../Bot");
const axios = require("axios");
const crypto = require("crypto");

/**
 * Claude (claude.ai) web adapter, ported from ChatALL's ClaudeAIBot.
 *
 * Auth: Cookie-based. The full Cookie string from a logged-in browser session
 * is sent as-is (Bot.buildHeaders injects it). ChatALL stored organizationUuid
 * in Vuex; here we resolve it dynamically per call via GET /api/organizations.
 *
 * Cloudflare: claude.ai sits behind Cloudflare. Pure Node cannot solve CF's JS
 * challenge, so the user MUST include a valid cf_clearance cookie copied from a
 * real browser. Without it, requests typically return 403 — we detect that and
 * surface a clear error instead of a generic failure.
 *
 * Single-turn: a fresh conversation is created per ask() and abandoned after.
 *
 * SSE: Claude streams `event: completion\ndata: {<json>}` blocks. Each data
 * line is a single JSON object whose `completion` field is a delta token.
 * Bot.consumeSSE parses `data:` lines and ignores the `event:` prefix, so it
 * works directly — we accumulate json.completion.
 */
class ClaudeAIBot extends Bot {
  static BASE = "https://claude.ai";

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

  async getOrgUuid() {
    if (this._orgUuid) return this._orgUuid;
    const res = await axios.get(`${ClaudeAIBot.BASE}/api/organizations`, {
      headers: this.buildHeaders(),
      timeout: 15000,
      validateStatus: () => true,
    });
    if (res.status === 403 && this._looksLikeCloudflare(res)) {
      throw new Error(
        `${this.name}: 请求被 Cloudflare 拦截，可能需要在 Cookie 中包含 cf_clearance（请从浏览器复制完整 Cookie）`
      );
    }
    if (res.status !== 200) {
      throw new Error(
        `${this.name}: 获取 organization 失败（HTTP ${res.status}），Cookie 可能已过期或被 Cloudflare 拦截`
      );
    }
    const orgs = Array.isArray(res.data)
      ? res.data
      : res.data && res.data.organizations
      ? res.data.organizations
      : [];
    const org = orgs[0];
    const uuid = org && (org.uuid || org.id);
    if (!uuid) {
      throw new Error(`${this.name}: 响应中未找到 organization uuid`);
    }
    this._orgUuid = uuid;
    return uuid;
  }

  async createConversation(orgUuid) {
    const convUuid = crypto.randomUUID();
    const res = await axios.post(
      `${ClaudeAIBot.BASE}/api/organizations/${orgUuid}/chat_conversations`,
      { name: "", uuid: convUuid },
      {
        headers: this.buildHeaders(),
        timeout: 15000,
        validateStatus: () => true,
      }
    );
    if (res.status === 403 && this._looksLikeCloudflare(res)) {
      throw new Error(
        `${this.name}: 请求被 Cloudflare 拦截，可能需要在 Cookie 中包含 cf_clearance（请从浏览器复制完整 Cookie）`
      );
    }
    if (res.status !== 201) {
      throw new Error(`${this.name}: 创建会话失败（HTTP ${res.status}）`);
    }
    return convUuid;
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

    // images: not wired (web attachment upload flow not implemented)
    const orgUuid = await this.getOrgUuid();
    const convUuid = await this.createConversation(orgUuid);

    const res = await Bot.post(
      `${ClaudeAIBot.BASE}/api/organizations/${orgUuid}/chat_conversations/${convUuid}/completion`,
      {
        attachments: [],
        files: [],
        prompt,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      { ...this.buildHeaders(), accept: "text/event-stream" },
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

    let answer = "";
    await Bot.consumeSSE(res.data, (json) => {
      if (json && json.completion) {
        answer += json.completion;
        if (onUpdate) onUpdate(json.completion);
      }
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
      await this.getOrgUuid();
      return true;
    } catch (e) {
      return false;
    }
  }
}

module.exports = ClaudeAIBot;

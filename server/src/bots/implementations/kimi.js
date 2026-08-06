const Bot = require("../Bot");
const axios = require("axios");
const credentialStore = require("../credentialStore");

/**
 * Kimi (kimi.moonshot.cn) web adapter, ported from ChatALL's KimiBot.
 *
 * Auth note: Kimi's web API does NOT authenticate via Cookie. It uses a
 * refresh_token (stored by the site in localStorage) which is exchanged for
 * a short-lived access_token:
 *   GET /api/auth/token/refresh  (Authorization: Bearer <refresh_token>)
 *
 * The pasted credential may be:
 *   - the bare refresh_token (recommended), or
 *   - a full Cookie / localStorage dump containing "refresh_token=<value>"
 * The rotated refresh_token is persisted back to the credential store so
 * the credential stays valid across sessions.
 */
class KimiBot extends Bot {
  static BASE = "https://kimi.moonshot.cn";

  /** Extract the refresh_token from whatever the user pasted. */
  extractRefreshToken(raw) {
    const value = String(raw || "").trim();
    const m = value.match(/refresh_token=([^;\s"]+)/);
    return m ? m[1] : value;
  }

  async refreshTokens() {
    const cred = this.getCredential();
    if (!cred) throw new Error(`${this.name}: 未配置凭据`);
    const refreshToken = this.extractRefreshToken(cred.value);
    const res = await axios.get(`${KimiBot.BASE}/api/auth/token/refresh`, {
      headers: { Authorization: `Bearer ${refreshToken}` },
      timeout: 15000,
      validateStatus: () => true,
    });
    if (res.status !== 200 || !res.data?.access_token) {
      throw new Error(
        `${this.name}: refresh_token 无效或已过期（HTTP ${res.status}），请重新获取`
      );
    }
    // Persist the rotated refresh_token so it never goes stale
    if (res.data.refresh_token && res.data.refresh_token !== refreshToken) {
      try {
        credentialStore.set(this.id, res.data.refresh_token);
      } catch (e) {
        /* non-fatal */
      }
    }
    return res.data.access_token;
  }

  async createChat(accessToken) {
    const res = await axios.post(
      `${KimiBot.BASE}/api/chat`,
      { is_example: false, name: "AskAll" },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 15000,
        validateStatus: () => true,
      }
    );
    if (res.status !== 200 || !res.data?.id) {
      throw new Error(`${this.name}: 创建会话失败（HTTP ${res.status}）`);
    }
    return res.data.id;
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

    const accessToken = await this.refreshTokens();
    const chatId = await this.createChat(accessToken);

    const res = await Bot.post(
      `${KimiBot.BASE}/api/chat/${chatId}/completion/stream`,
      {
        messages: [{ role: "user", content: prompt }],
        refs: [],
        use_search: false,
      },
      { Authorization: `Bearer ${accessToken}` },
      { stream: true }
    );
    if (res.status !== 200) {
      throw new Error(
        `${this.name}: HTTP ${res.status} ${typeof res.data === "string" ? res.data.slice(0, 200) : ""}`
      );
    }

    let answer = "";
    let done = false;
    await Bot.consumeSSE(res.data, (json) => {
      if (json.event === "cmpl" && json.text) {
        answer += json.text;
        if (onUpdate) onUpdate(json.text);
      } else if (json.event === "all_done") {
        done = true;
      }
    });
    if (!answer) throw new Error(`${this.name}: 空回答${done ? "" : "（流中断）"}`);
    return answer;
  }

  async checkAvailability() {
    if (process.env.ASKALL_MOCK === "1") return !!this.getCredential();
    if (!this.getCredential()) return false;
    try {
      await this.refreshTokens();
      return true;
    } catch (e) {
      return false;
    }
  }
}

module.exports = KimiBot;

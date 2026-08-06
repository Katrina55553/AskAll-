const Bot = require("../Bot");
const axios = require("axios");
const credentialStore = require("../credentialStore");

/**
 * Kimi (kimi.moonshot.cn) web adapter, ported from ChatALL's KimiBot.
 *
 * ⚠️ 认证方式：Kimi 网页版不使用 Cookie 认证，而是使用 localStorage 中的
 * refresh_token。用户需按以下步骤获取：
 *   1. 打开 https://kimi.moonshot.cn 并登录
 *   2. F12 → Application（应用） → Local Storage（本地存储）
 *   3. 找到 key 为 "refresh_token" 的条目，复制其 value
 *   4. 将该 value 粘贴到凭据管理中
 *
 * 工作流程：refresh_token → /api/auth/token/refresh → access_token → API 调用
 * 轮换后的 refresh_token 会自动写回凭据存储，保持长期有效。
 */
class KimiBot extends Bot {
  static BASE = "https://kimi.moonshot.cn";

  /** Extract the refresh_token from whatever the user pasted. */
  extractRefreshToken(raw) {
    const value = String(raw || "").trim();
    const m = value.match(/refresh_token=([^;\s"]+)/);
    return m ? m[1] : value;
  }

  /** 检测用户是否误粘贴了 Cookie（Kimi 不支持 Cookie 认证）。 */
  isLikelyCookie(value) {
    const v = String(value || "").trim();
    // Cookie 通常包含分号和等号，且不含空格
    return v.includes(";") && v.includes("=") && !v.startsWith("eyJ");
  }

  async refreshTokens() {
    const cred = this.getCredential();
    if (!cred) throw new Error(`${this.name}: 未配置凭据`);

    // 检测用户是否误粘贴了 Cookie
    if (this.isLikelyCookie(cred.value)) {
      throw new Error(
        `${this.name}: 检测到 Cookie 格式，但 Kimi 不支持 Cookie 认证。` +
        `请获取 localStorage 中的 refresh_token：F12 → Application → Local Storage → refresh_token`
      );
    }

    const refreshToken = this.extractRefreshToken(cred.value);
    const res = await axios.get(`${KimiBot.BASE}/api/auth/token/refresh`, {
      headers: { Authorization: `Bearer ${refreshToken}` },
      timeout: 15000,
      validateStatus: () => true,
    });
    if (res.status !== 200 || !res.data?.access_token) {
      throw new Error(
        `${this.name}: refresh_token 无效或已过期（HTTP ${res.status}）。` +
        `请重新获取：F12 → Application → Local Storage → refresh_token`
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
    const cred = this.getCredential();
    if (!cred) return false;
    // Cookie 格式的凭据直接判定不可用（Kimi 需要 refresh_token）
    if (this.isLikelyCookie(cred.value)) return false;
    try {
      await this.refreshTokens();
      return true;
    } catch (e) {
      return false;
    }
  }
}

module.exports = KimiBot;

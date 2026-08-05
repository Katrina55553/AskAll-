const Bot = require("../Bot");

/**
 * Generic web (Cookie) type bot adapter.
 *
 * ChatALL's web bots reverse-engineer each site's internal API with axios + SSE.
 * Those per-site implementations live in ./<botId>.js and are maintained
 * centrally (site changes break them frequently). When a per-site
 * implementation file is absent, this fallback is used:
 * - ASKALL_MOCK=1: returns a mock streaming answer (for end-to-end demo/test)
 * - otherwise: throws a graceful "not integrated" error so the orchestrator
 *   can degrade this bot without blocking others.
 */
class WebBot extends Bot {
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
    if (!cred) {
      const credName =
        this.meta.credentialType === "cookie" ? "Cookie" : "API Key";
      throw new Error(`${this.name}: 未配置 ${credName}`);
    }
    throw new Error(
      `${this.name}: 该 bot 的接口适配尚未接入（需对应实现文件 bots/implementations/${this.id}.js）`
    );
  }

  async checkAvailability() {
    if (process.env.ASKALL_MOCK === "1") return !!this.getCredential();
    // Without a per-site implementation we cannot validate the cookie online.
    // Throw a descriptive error instead of returning false, so the user does
    // not mistake "not integrated" for "cookie is wrong / not saved".
    throw new Error(
      `${this.name}: 该 bot 尚未接入在线校验（缺少 bots/implementations/${this.id}.js），凭据已保存，可直接提问验证`
    );
  }
}

module.exports = WebBot;

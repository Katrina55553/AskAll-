const Bot = require("../Bot");

/**
 * OpenAI-compatible chat completions bot.
 * Covers all API-type bots exposing an OpenAI-style /chat/completions endpoint
 * (DeepSeek, Qwen/DashScope, Zhipu GLM, Moonshot, Groq, xAI, Mistral,
 * OpenRouter, Doubao/Ark, Yi, OpenAI itself, ...).
 */
class OpenAICompatibleBot extends Bot {
  constructor(meta) {
    super(meta);
    this.baseURL = meta.baseURL;
    this.model = meta.model;
  }

  buildMessages(prompt, images) {
    if (this.supportsImage && images && images.length) {
      const content = [{ type: "text", text: prompt }];
      for (const img of images) {
        content.push({
          type: "image_url",
          image_url: { url: `data:${img.mime};base64,${img.dataBase64}` },
        });
      }
      return [{ role: "user", content }];
    }
    return [{ role: "user", content: prompt }];
  }

  async ask(prompt, images = [], onUpdate) {
    if (process.env.ASKALL_MOCK === "1") return this.mockAnswer(prompt, onUpdate);
    const cred = this.getCredential();
    if (!cred) throw new Error(`${this.name}: 未配置 API Key`);

    const url = `${this.baseURL.replace(/\/$/, "")}/chat/completions`;
    const res = await Bot.post(
      url,
      {
        model: this.model,
        messages: this.buildMessages(prompt, images),
        stream: true,
      },
      this.buildHeaders(),
      { stream: true }
    );
    if (res.status !== 200) {
      throw new Error(
        `${this.name}: HTTP ${res.status} ${typeof res.data === "string" ? res.data.slice(0, 200) : ""}`
      );
    }

    let answer = "";
    await Bot.consumeSSE(res.data, (json) => {
      const delta = json.choices?.[0]?.delta?.content || "";
      if (delta) {
        answer += delta;
        if (onUpdate) onUpdate(delta);
      }
    });
    if (!answer) throw new Error(`${this.name}: 空回答`);
    return answer;
  }

  async checkAvailability() {
    if (process.env.ASKALL_MOCK === "1") return true;
    const cred = this.getCredential();
    if (!cred) return false;
    const url = `${this.baseURL.replace(/\/$/, "")}/models`;
    const res = await require("axios")
      .get(url, {
        headers: this.buildHeaders(),
        timeout: 15000,
        validateStatus: () => true,
      })
      .catch(() => null);
    return res?.status === 200;
  }

  async mockAnswer(prompt, onUpdate) {
    const text = `[模拟回答 - ${this.name}] 针对问题「${prompt.slice(0, 60)}」的回答：这是 ${this.name} 在 ASKALL_MOCK 模式下生成的演示回答，用于端到端流程验证。`;
    if (onUpdate) {
      for (const ch of text) {
        await new Promise((r) => setTimeout(r, 8));
        onUpdate(ch);
      }
    }
    return text;
  }
}

module.exports = OpenAICompatibleBot;

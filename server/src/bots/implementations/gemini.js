const Bot = require("../Bot");
const axios = require("axios");

/**
 * Google Gemini (web, formerly Bard) adapter.
 * Ported from ChatALL's BardBot.js (https://gemini.google.com).
 *
 * Auth: Google account Cookie (paste from gemini.google.com after sign-in).
 * The cookie must allow GET https://gemini.google.com/app to return the page
 * HTML containing the "SNlM0e" (at) and "cfb2h" (bl) tokens.
 *
 * Request flow (per ask(), single-turn):
 *   1. GET https://gemini.google.com/app with the Cookie
 *      -> regex-extract "SNlM0e" (atValue) and "cfb2h" (blValue) from HTML.
 *         These tokens are session-scoped and tied to the cookie, so they are
 *         re-fetched on every ask() (no caching, no Vuex/Electron store).
 *   2. POST https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate
 *      body: URLSearchParams { at: <atValue>, "f.req": <serialized inner JSON> }
 *      query: { bl: <blValue>, _reqid: <random 6-digit>, rt: "c" }
 *      The inner JSON is a deeply nested array (see buildReqBody) whose only
 *      meaningful fields are the prompt, locale ("en"), empty contextIds
 *      (single-turn), and modelNumber (1 = gemini-pro).
 *   3. Parse the batch JSON response (NOT standard SSE):
 *      The body is prefixed with the XSSI guard `)]}'` and blank/length lines.
 *      Line index 3 holds the outer JSON array:
 *        data = JSON.parse(resp.split("\n")[3])
 *      data[0][2] is a JSON-stringified inner payload:
 *        inner = JSON.parse(data[0][2])
 *      inner[4][0][1][0] is the answer text.
 *      (inner[1] / inner[4][0][0] are conversation IDs, unused in single-turn.)
 *
 * Image upload: NOT implemented. ChatALL's BardBot also does not send images
 * upstream (it only decodes generated images in responses). The `images`
 * parameter is silently ignored to avoid breaking the call signature.
 *
 * Known limitations:
 *   - Requires a valid Google account Cookie (user must be signed in).
 *   - Region-restricted: Gemini is unavailable in some regions; the page GET
 *     will not contain the tokens and ask() will throw a clear error.
 *   - The `at`/`bl` tokens are short-lived and re-fetched every call, so a
 *     slightly higher latency is expected vs. cached approaches.
 *   - Only single-turn (no conversation context carried across calls).
 */
class GeminiBot extends Bot {
  static BASE = "https://gemini.google.com";
  static STREAM_URL =
    `${GeminiBot.BASE}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate`;
  // Mac Chrome UA (mirrors ChatALL's BardBot; "Electron" must NOT appear or
  // Google serves a blank login page).
  static USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

  /**
   * Build the `f.req` body for StreamGenerate.
   * Replicates ChatALL BardBot.generateReq exactly (modelNumber=1 -> gemini-pro).
   * The array is padded to 100 null tail slots + trailing [] for parity with
   * the live site's payload shape.
   */
  buildReqBody(prompt, modelNumber = 1) {
    const innerJSON = [
      [prompt, 0, null, null, null, null, 0],
      ["en"],
      ["", "", ""], // contextIds: empty = single-turn
      "",
      "",
      null,
      [1],
      0,
      null,
      null,
      1,
      0,
      null,
      null,
      null,
      null,
      null,
      null,
      modelNumber, // index 18: 1 = gemini-pro, 2 = gemini-ultra
    ];
    while (innerJSON.length < 100) innerJSON.push(null);
    innerJSON.push([]);
    return JSON.stringify([null, JSON.stringify(innerJSON)]);
  }

  /**
   * GET the Gemini app page with the stored Cookie and extract the `at`
   * (SNlM0e) and `bl` (cfb2h) tokens from the inline HTML.
   * Throws on missing cookie, non-200, or missing tokens.
   */
  async fetchTokens() {
    const cred = this.getCredential();
    if (!cred) throw new Error(`${this.name}: 未配置 Cookie`);
    const headers = this.buildHeaders();
    headers["User-Agent"] = GeminiBot.USER_AGENT;

    const res = await axios.get(`${GeminiBot.BASE}/app`, {
      headers,
      timeout: 20000,
      validateStatus: () => true,
      responseType: "text",
      transformResponse: (x) => x,
    });
    if (res.status !== 200 || typeof res.data !== "string") {
      throw new Error(
        `${this.name}: 获取 Gemini 页面失败（HTTP ${res.status}）— Cookie 可能已过期或被地区限制`
      );
    }
    const html = res.data;
    const atValue = html.match(/"SNlM0e":"([^"]+)"/)?.[1];
    const blValue = html.match(/"cfb2h":"([^"]+)"/)?.[1];
    if (!atValue || !blValue) {
      throw new Error(
        `${this.name}: 无法从页面提取 at/bl 令牌 — Cookie 无效、未登录或被地区限制`
      );
    }
    return { atValue, blValue };
  }

  /**
   * Parse Gemini's batch JSON response (NOT SSE).
   * Format: `)]}'\n\n\n[[...]]\n...` — line index 3 holds the outer JSON array.
   * Falls back to scanning for the first `[[...]]` line for robustness.
   */
  parseResponse(resp) {
    if (typeof resp !== "string" || !resp) {
      throw new Error(`${this.name}: Gemini 响应为空`);
    }
    const lines = resp.split("\n");
    let data = null;
    // Primary path: ChatALL's documented line index 3.
    if (lines[3]) {
      try {
        data = JSON.parse(lines[3]);
      } catch (e) {
        data = null;
      }
    }
    // Fallback: first line that looks like the outer array.
    if (!data) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("[[") && line.endsWith("]]")) {
          try {
            data = JSON.parse(line);
            break;
          } catch (e2) {
            /* keep scanning */
          }
        }
      }
    }
    if (!data || !Array.isArray(data) || !data[0] || data[0][2] == null) {
      throw new Error(`${this.name}: 无法解析 Gemini 响应结构`);
    }
    let inner;
    try {
      inner = JSON.parse(data[0][2]);
    } catch (e) {
      throw new Error(`${this.name}: 无法解析 Gemini 内层响应`);
    }
    if (!inner || !inner[4] || !inner[4][0] || !inner[4][0][1]) {
      throw new Error(`${this.name}: Gemini 响应结构异常（无文本字段）`);
    }
    const text = inner[4][0][1][0];
    if (typeof text !== "string") {
      throw new Error(`${this.name}: Gemini 未返回文本`);
    }
    return text;
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

    // Image upload is not implemented (ChatALL BardBot does not send images
    // upstream either). The `images` parameter is intentionally ignored.

    const { atValue, blValue } = await this.fetchTokens();

    const headers = this.buildHeaders();
    headers["User-Agent"] = GeminiBot.USER_AGENT;
    headers["Content-Type"] = "application/x-www-form-urlencoded;charset=utf-8";

    const body = new URLSearchParams({
      at: atValue,
      "f.req": this.buildReqBody(prompt, 1),
    });

    const res = await axios.post(GeminiBot.STREAM_URL, body, {
      headers,
      params: {
        bl: blValue,
        _reqid: Math.floor(Math.random() * 900000) + 100000,
        rt: "c",
      },
      timeout: 120000,
      validateStatus: () => true,
      // Gemini returns a non-JSON batch format; keep it as raw text.
      responseType: "text",
      transformResponse: (x) => x,
    });

    if (res.status !== 200) {
      const snippet =
        typeof res.data === "string" ? res.data.slice(0, 200) : "";
      throw new Error(`${this.name}: HTTP ${res.status} ${snippet}`);
    }

    const text = this.parseResponse(res.data);

    if (onUpdate) {
      // The underlying API is batch (not streaming), so emit the parsed text
      // in modest chunks to give the UI a gentle typing effect.
      const chunkSize = 60;
      for (let i = 0; i < text.length; i += chunkSize) {
        onUpdate(text.slice(i, i + chunkSize));
        await new Promise((r) => setTimeout(r, 5));
      }
    }
    return text;
  }

  async checkAvailability() {
    if (process.env.ASKALL_MOCK === "1") return !!this.getCredential();
    if (!this.getCredential()) return false;
    try {
      await this.fetchTokens();
      return true;
    } catch (e) {
      return false;
    }
  }
}

module.exports = GeminiBot;

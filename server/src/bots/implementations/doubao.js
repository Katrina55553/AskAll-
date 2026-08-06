const Bot = require("../Bot");
const crypto = require("crypto");

/**
 * 豆包 (www.doubao.com) 网页版逆向适配器。
 *
 * 认证：用户粘贴完整 Cookie（必须包含 sessionid 和 msToken）。
 * 请求时直接使用原始 Cookie，并从 Cookie 中提取 msToken / web_id
 * 作为 URL 参数（不可随机生成，否则触发 710022002 block 风控）。
 * a_bogus 经测试可省略。
 *
 * 逆向依据：LLM-Red-Team/doubao-free-api + 2026-08 抓包验证。
 */
class DoubaoBot extends Bot {
  static BASE = "https://www.doubao.com";
  static DEFAULT_ASSISTANT_ID = "497858";
  static VERSION_CODE = "20800";

  static FAKE_HEADERS = {
    Accept: "*/*",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Last-Event-Id": "undefined",
    Origin: "https://www.doubao.com",
    Pragma: "no-cache",
    Priority: "u=1, i",
    Referer: "https://www.doubao.com/chat/",
    "Sec-Ch-Ua":
      '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  };

  /** 从 Cookie 字符串中提取指定字段值。 */
  static extractCookieField(cookieStr, name) {
    const m = String(cookieStr).match(new RegExp(`${name}=([^;\\s"]+)`));
    return m ? m[1] : null;
  }

  /** 从用户粘贴的凭据中提取 sessionid（仅用于 checkAvailability）。 */
  extractSessionId(raw) {
    const m = String(raw || "").match(/sessionid=([^;\s"]+)/);
    return m ? m[1] : null;
  }

  /** 构造请求 URL（使用 Cookie 中的真实 msToken / web_id）。 */
  buildUrl(uri, msToken, webId) {
    const params = new URLSearchParams({
      aid: DoubaoBot.DEFAULT_ASSISTANT_ID,
      device_id: webId || "",
      device_platform: "web",
      language: "zh",
      pkg_type: "release_version",
      real_aid: DoubaoBot.DEFAULT_ASSISTANT_ID,
      region: "CN",
      samantha_web: "1",
      sys_region: "CN",
      tea_uuid: webId || "",
      use_olympus_account: "1",
      version_code: DoubaoBot.VERSION_CODE,
      web_id: webId || "",
      msToken: msToken || "",
    });
    return `${DoubaoBot.BASE}${uri}?${params.toString()}`;
  }

  /** 构造完整请求头（直接使用原始 Cookie）。 */
  buildRequestHeaders(rawCookie, extra = {}) {
    return {
      ...DoubaoBot.FAKE_HEADERS,
      Cookie: rawCookie,
      "X-Flow-Trace": `04-${crypto.randomUUID()}-${crypto.randomUUID().substring(0, 16)}-01`,
      ...extra,
    };
  }

  /** 生成 14 位数字串（用于 local_conversation_id 尾部）。 */
  static randomNumeric14() {
    return String(Math.floor(Math.random() * 1e14)).padStart(14, "0");
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
    const rawCookie = cred.value;

    // 从 Cookie 中提取真实 msToken 和 web_id（不可随机生成，否则触发风控）
    const msToken = DoubaoBot.extractCookieField(rawCookie, "msToken");
    const webId = DoubaoBot.extractCookieField(rawCookie, "web_id");
    if (!msToken) {
      throw new Error(`${this.name}: Cookie 中缺少 msToken，请重新获取完整 Cookie`);
    }

    const url = this.buildUrl("/samantha/chat/completion", msToken, webId);
    const headers = this.buildRequestHeaders(rawCookie, { "Agw-js-conv": "str" });

    const body = {
      messages: [
        {
          content: JSON.stringify({ text: prompt }),
          content_type: 2001,
          attachments: [],
          references: [],
        },
      ],
      completion_option: {
        is_regen: false,
        with_suggest: true,
        need_create_conversation: true,
        launch_stage: 1,
        is_replace: false,
        is_delete: false,
        message_from: 0,
        event_id: "0",
      },
      conversation_id: "0",
      local_conversation_id: `local_16${DoubaoBot.randomNumeric14()}`,
      local_message_id: crypto.randomUUID(),
    };

    const res = await Bot.post(url, body, headers, {
      stream: true,
      timeout: 300000,
    });
    if (res.status !== 200) {
      throw new Error(
        `${this.name}: HTTP ${res.status} ${
          typeof res.data === "string" ? res.data.slice(0, 200) : ""
        }`
      );
    }

    let answer = "";
    let convId = "";
    let finished = false;
    let streamError = null;
    await Bot.consumeSSE(res.data, (raw) => {
      if (streamError) return;
      // 错误码事件
      if (raw.code) {
        streamError = new Error(
          `${this.name}: 请求豆包失败 ${raw.code}-${raw.message || ""}`
        );
        return;
      }
      // 结束事件
      if (raw.event_type === 2003) {
        finished = true;
        return;
      }
      if (raw.event_type !== 2001) return;
      // event_data 为 JSON 字符串，需二次解析
      let result;
      try {
        result = JSON.parse(raw.event_data);
      } catch (e) {
        return;
      }
      if (result.is_finish) {
        finished = true;
        return;
      }
      if (!convId && result.conversation_id) convId = result.conversation_id;
      const message = result.message;
      if (!message || ![2001, 2008].includes(message.content_type)) return;
      let content;
      try {
        content = JSON.parse(message.content);
      } catch (e) {
        return;
      }
      if (content.text) {
        answer += content.text;
        if (onUpdate) onUpdate(content.text);
      }
    });

    if (streamError) throw streamError;
    if (!answer) {
      throw new Error(`${this.name}: 空回答${finished ? "" : "（流中断）"}`);
    }

    // 异步清理会话
    if (convId) {
      this.removeConversation(convId, rawCookie, msToken, webId).catch(() => {});
    }
    return answer.replace(/\n$/, "");
  }

  /** 删除会话（异步清理，失败不抛错）。 */
  async removeConversation(convId, rawCookie, msToken, webId) {
    const url = this.buildUrl("/samantha/thread/delete", msToken, webId);
    const headers = this.buildRequestHeaders(rawCookie);
    await Bot.post(url, { conversation_id: convId }, headers, {
      timeout: 15000,
    });
  }

  async checkAvailability() {
    if (process.env.ASKALL_MOCK === "1") return !!this.getCredential();
    const cred = this.getCredential();
    if (!cred) return false;
    // 检查 Cookie 中是否包含 sessionid 和 msToken
    const sessionId = this.extractSessionId(cred.value);
    const msToken = DoubaoBot.extractCookieField(cred.value, "msToken");
    return !!(sessionId && msToken);
  }
}

module.exports = DoubaoBot;

const Bot = require("../Bot");
const crypto = require("crypto");

/**
 * 豆包 (www.doubao.com) 网页版逆向适配器。
 *
 * 逆向依据:LLM-Red-Team/doubao-free-api(基于 /samantha/chat/completion 端点)。
 *
 * 认证:豆包网页版用 Cookie 会话态,核心凭据是 sessionid。
 * 用户粘贴的凭据可以是:
 *   - 完整 Cookie 字符串(从中提取 sessionid),或
 *   - 裸 sessionid 值
 * 请求时由本类合成完整 Cookie(sessionid / sid_tt / msToken / uid_tt 等)。
 *
 * ⚠️ 本实现未经官方实测,端点/payload 可能随豆包前端更新而失效。
 * ⚠️ 图片上传未实现(豆包需先上传 OSS 再引用 file_url,逆向链路不完整),
 *    images 参数被静默忽略,仅处理文本(与 kimi.js 行为一致)。
 */
class DoubaoBot extends Bot {
  static BASE = "https://www.doubao.com";
  // 默认 AgentID(豆包原版助手)
  static DEFAULT_ASSISTANT_ID = "497858";
  static VERSION_CODE = "20800";
  // 进程级固定伪装标识(device_id / web_id 为 19 位量级数字)
  static DEVICE_ID = String(
    Math.random() * 999999999999999999 + 7000000000000000000
  );
  static WEB_ID = String(
    Math.random() * 999999999999999999 + 7000000000000000000
  );
  static USER_ID = crypto.randomUUID();

  static FAKE_HEADERS = {
    Accept: "*/*",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Last-Event-Id": "undefined",
    Origin: "https://www.doubao.com",
    Pragma: "no-cache",
    Priority: "u=1, i",
    Referer: "https://www.doubao.com",
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

  /** 从用户粘贴的凭据中提取 sessionid。 */
  extractSessionId(raw) {
    const value = String(raw || "").trim();
    const m = value.match(/sessionid=([^;\s"]+)/);
    return m ? m[1] : value;
  }

  /** 生成伪 msToken(128 个 base64url 字符)。 */
  static generateMsToken() {
    return crypto.randomBytes(96).toString("base64url");
  }

  /** 生成伪 a_bogus。 */
  static generateABogus() {
    const chars =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const rand = (n) =>
      Array.from({ length: n }, () =>
        chars.charAt(Math.floor(Math.random() * chars.length))
      ).join("");
    return `mf-${rand(34)}-${rand(6)}`;
  }

  /** 构造豆包会话 Cookie。 */
  buildCookie(sessionId, msToken) {
    const ts = Math.floor(Date.now() / 1000);
    return [
      "is_staff_user=false",
      "store-region=cn-gd",
      "store-region-src=uid",
      `sid_guard=${sessionId}%7C${ts}%7C5184000%7CSun%2C+02-Feb-2025+04%3A17%3A20+GMT`,
      `uid_tt=${DoubaoBot.USER_ID}`,
      `uid_tt_ss=${DoubaoBot.USER_ID}`,
      `sid_tt=${sessionId}`,
      `sessionid=${sessionId}`,
      `sessionid_ss=${sessionId}`,
      `msToken=${msToken}`,
    ].join("; ");
  }

  /** 构造请求 URL(含统一 query 参数 + 额外参数)。 */
  buildUrl(uri, msToken, extraParams = {}) {
    const params = new URLSearchParams({
      aid: DoubaoBot.DEFAULT_ASSISTANT_ID,
      device_id: DoubaoBot.DEVICE_ID,
      device_platform: "web",
      language: "zh",
      pkg_type: "release_version",
      real_aid: DoubaoBot.DEFAULT_ASSISTANT_ID,
      region: "CN",
      samantha_web: "1",
      sys_region: "CN",
      tea_uuid: DoubaoBot.WEB_ID,
      use_olympus_account: "1",
      version_code: DoubaoBot.VERSION_CODE,
      web_id: DoubaoBot.WEB_ID,
      msToken,
      a_bogus: DoubaoBot.generateABogus(),
      ...extraParams,
    });
    return `${DoubaoBot.BASE}${uri}?${params.toString()}`;
  }

  /** 构造完整请求头(含 Cookie 与 X-Flow-Trace)。 */
  buildRequestHeaders(sessionId, msToken, extra = {}) {
    return {
      ...DoubaoBot.FAKE_HEADERS,
      Cookie: this.buildCookie(sessionId, msToken),
      "X-Flow-Trace": `04-${crypto.randomUUID()}-${crypto.randomUUID().substring(0, 16)}-01`,
      Referer: "https://www.doubao.com/chat/",
      ...extra,
    };
  }

  /** 生成 14 位数字串(用于 local_conversation_id 尾部)。 */
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
    const sessionId = this.extractSessionId(cred.value);

    // 注:图片上传未实现(豆包需 OSS 上传链路),images 被忽略,仅处理文本。
    const msToken = DoubaoBot.generateMsToken();
    const url = this.buildUrl("/samantha/chat/completion", msToken);
    const headers = this.buildRequestHeaders(sessionId, msToken, {
      "Agw-js-conv": "str",
    });

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
    const ct = res.headers["content-type"] || "";
    if (ct.indexOf("text/event-stream") === -1) {
      throw new Error(`${this.name}: 响应非 SSE 流(Content-Type: ${ct})`);
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
      // event_data 为 JSON 字符串,需二次解析
      let result;
      try {
        result = JSON.parse(raw.event_data);
      } catch (e) {
        return; // 非 JSON event_data,跳过
      }
      if (result.is_finish) {
        finished = true;
        return;
      }
      if (!convId && result.conversation_id) convId = result.conversation_id;
      const message = result.message;
      if (!message || ![2001, 2008].includes(message.content_type)) return;
      // message.content 又是 JSON 字符串,内含 {text}
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

    // 异步清理会话,避免出现在用户豆包账号的会话列表中(失败忽略)
    if (convId) {
      this.removeConversation(convId, sessionId).catch(() => {});
    }
    return answer.replace(/\n$/, "");
  }

  /** 删除会话(异步清理,失败不抛错)。 */
  async removeConversation(convId, sessionId) {
    const msToken = DoubaoBot.generateMsToken();
    const url = this.buildUrl("/samantha/thread/delete", msToken);
    const headers = this.buildRequestHeaders(sessionId, msToken);
    await Bot.post(url, { conversation_id: convId }, headers, {
      timeout: 15000,
    });
  }

  async checkAvailability() {
    if (process.env.ASKALL_MOCK === "1") return !!this.getCredential();
    const cred = this.getCredential();
    if (!cred) return false;
    try {
      const sessionId = this.extractSessionId(cred.value);
      const msToken = DoubaoBot.generateMsToken();
      const url = this.buildUrl("/passport/account/info/v2", msToken, {
        account_sdk_source: "web",
      });
      const headers = this.buildRequestHeaders(sessionId, msToken);
      const res = await Bot.post(url, {}, headers, { timeout: 15000 });
      if (res.status !== 200) return false;
      const data = res.data || {};
      // 响应结构:{ code: 0, data: { user_id, ... } };code 非 0 视为失效
      if (data.code !== undefined && data.code !== 0) return false;
      const inner = data.data || data;
      return !!inner.user_id;
    } catch (e) {
      return false;
    }
  }
}

module.exports = DoubaoBot;

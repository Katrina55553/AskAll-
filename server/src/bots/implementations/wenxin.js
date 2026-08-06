const Bot = require("../Bot");
const axios = require("axios");

/**
 * 文心一言（ERNIE Bot）网页版适配器，参照 ChatALL 的 ERNIEBot.js（仅有
 * checkAvailability 的空壳）自行逆向实现。
 *
 * 逆向依据：
 *  1. checkAvailability —— 沿用 ChatALL ERNIEBot 的 GET /eb/user/info，
 *     判断 content.isLogin。
 *  2. 提问端点 —— https://yiyan.baidu.com/eb/chat/conversation/v2。
 *     来源：开源项目 zhuweiyou/yiyan-api 在 puppeteer 中捕获的响应 URL，
 *     以及 CSDN《百度文心一言测试版接口分析》中 self.base_url 的明确记录。
 *  3. 请求体 —— CSDN 文章给出 data = {"text": query, ...}（其余字段被截断）。
 *     这里补全 Baidu ERNIE 网页端常见的结构性字段（parentChatId/localId/
 *     sessionId/timestamp）。
 *  4. SSE 响应格式 —— 来自 zhuweiyou/yiyan-api 仓库的 chat_conversation.txt
 *     实样：每条事件为 `event:message\ndata:{json}`，json.data 含：
 *       - text / content：增量文本片段（isIncr=true 时）
 *       - tokens_all：累积全文（终止帧携带）
 *       - is_end：0 进行中 / 1 结束
 *       - isIncr：content 是否为增量
 *     Bot.consumeSSE 按 `data:` 前缀解析，自动忽略 `event:` 行，兼容此格式。
 *
 * 已知限制（未经端到端实测）：
 *  - 当前 yiyan.baidu.com 可能已改用 /bcs/conversation 等新端点，或对
 *    /eb/chat/conversation/v2 增加了 sign 签名校验。本适配器未实现签名算法；
 *    若服务端返回 4xx/签名错误，需用浏览器抓包补全 sign 生成逻辑。
 *  - 图片上传：网页版多模态上传协议未确认，images 参数当前被忽略（仅文本）。
 *  - 每次 ask() 新建会话（parentChatId/sessionId 留空），不做多轮上下文拼接。
 */

function randomId(len = 16) {
  let s = "";
  const chars = "0123456789abcdef";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * 16)];
  return s;
}

class WenxinBot extends Bot {
  static BASE = "https://yiyan.baidu.com";
  // 提问端点（2023 年公开逆向记录的路径）
  static CHAT_URL = `${WenxinBot.BASE}/eb/chat/conversation/v2`;
  // 登录态探测端点（来自 ChatALL ERNIEBot）
  static USER_INFO_URL = `${WenxinBot.BASE}/eb/user/info`;

  /** 构造带 Cookie + Referer 的请求头。 */
  buildRequestHeaders() {
    const headers = this.buildHeaders();
    headers.Referer = `${WenxinBot.BASE}/`;
    headers.Accept = "text/event-stream";
    return headers;
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

    // 请求体：text 为必填提问内容；其余为 Baidu ERNIE 网页端常见结构性字段。
    // 注意：若服务端要求 sign 签名，此 body 会被拒绝（见文件头“已知限制”）。
    const body = {
      text: prompt,
      parentChatId: "",
      localId: randomId(),
      sessionId: "",
      timestamp: Date.now(),
      // images 参数：网页版多模态上传协议未确认，当前忽略
    };

    const res = await Bot.post(
      WenxinBot.CHAT_URL,
      body,
      this.buildRequestHeaders(),
      { stream: true }
    );

    if (res.status !== 200) {
      let detail = "";
      try {
        detail =
          typeof res.data === "string"
            ? res.data.slice(0, 200)
            : JSON.stringify(res.data).slice(0, 200);
      } catch (e) {
        /* ignore */
      }
      throw new Error(`${this.name}: HTTP ${res.status} ${detail}`.trim());
    }

    let answer = "";
    let lastFull = ""; // tokens_all 累积全文，用于非增量回退时计算 delta
    let gotEnd = false;

    await Bot.consumeSSE(res.data, (data) => {
      if (!data || data.code !== 0) return;
      const payload = data.data || {};
      if (payload.is_end === 1 || payload.is_end === true) gotEnd = true;

      // 优先取 text，其次 content
      let chunk = payload.text != null ? payload.text : payload.content;
      if (chunk == null) return;

      let delta = "";
      const isIncr = payload.isIncr !== false; // 默认按增量处理
      if (isIncr) {
        // 增量帧：chunk 即为本帧新增文本
        delta = String(chunk);
      } else if (payload.tokens_all) {
        // 非增量帧：从累积全文 tokens_all 计算后缀增量
        const full = String(payload.tokens_all);
        if (full.startsWith(lastFull)) {
          delta = full.slice(lastFull.length);
        } else {
          delta = full;
        }
        lastFull = full;
      }

      if (delta) {
        answer += delta;
        if (onUpdate) onUpdate(delta);
      }
    });

    if (!answer) {
      throw new Error(
        `${this.name}: 空回答（流中断或未授权）${gotEnd ? "" : "（未收到 is_end）"}`
      );
    }
    return answer;
  }

  async checkAvailability() {
    if (process.env.ASKALL_MOCK === "1") return !!this.getCredential();
    if (!this.getCredential()) return false;
    try {
      // 沿用 ChatALL ERNIEBot 的登录态探测路径
      const res = await axios.get(WenxinBot.USER_INFO_URL, {
        headers: this.buildHeaders(),
        timeout: 15000,
        validateStatus: () => true,
      });
      return !!(res.data && res.data.content && res.data.content.isLogin);
    } catch (e) {
      return false;
    }
  }
}

module.exports = WenxinBot;

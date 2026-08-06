const Bot = require("../Bot");
const axios = require("axios");
const crypto = require("crypto");

/**
 * 文心一言（百度文心助手）网页版适配器
 *
 * 逆向依据（2026-08 抓包验证）：
 *  1. 提问端点 —— POST https://chat.baidu.com/aichat/api/conversation
 *     响应格式：SSE，event 行可为 basedata / message，文本增量位于
 *     data.message.content.generator.data.value。
 *  2. tk 参数 —— base64(userId|md5(query)|timestamp|sessionId)-sessionId-3
 *     其中 userId（8 位 hex）和 sessionId（20 位数字）必须由服务器签发，
 *     随机生成会被拒绝（服务器返回 "😩抱歉，出了点小问题"）。
 *  3. 获取 userId / sessionId —— GET https://wenxin.baidu.com/ 返回的 HTML 中
 *     包含 <script name="aiTabFrameBaseData" type="application/json">
 *     其 token 字段即 userId，lid 字段即 sessionId。
 *  4. 登录态探测 —— 沿用 ChatALL ERNIEBot 的 GET /eb/user/info，
 *     判断 content.isLogin。也可直接检查 aiTabFrameBaseData 中是否存在 userInfo。
 *
 * 已知限制：
 *  - 每次 ask() 前都会重新拉取首页 HTML 获取新的 userId/sessionId，
 *    以避免服务器端会话过期（实测同一组凭据可复用多次，但跨天会失效）。
 *  - images 参数当前被忽略（仅文本）。
 *  - 不做多轮上下文拼接，每次 ask() 开启新会话。
 */

class WenxinBot extends Bot {
  static BASE = "https://wenxin.baidu.com";
  static CHAT_URL = "https://chat.baidu.com/aichat/api/conversation";
  static USER_INFO_URL = `${WenxinBot.BASE}/eb/user/info`;
  static HOME_URL = `${WenxinBot.BASE}/`;

  /** 构造带 Cookie + Referer 的请求头。 */
  buildRequestHeaders() {
    const headers = this.buildHeaders();
    headers.Referer = WenxinBot.BASE + "/";
    headers.Origin = WenxinBot.BASE;
    return headers;
  }

  /**
   * 从文心一言首页 HTML 中解析服务器签发的 userId 和 sessionId。
   * @returns {Promise<{userId:string, sessionId:string, userInfo?:object}>}
   */
  async fetchServerToken() {
    const headers = this.buildRequestHeaders();
    headers.Accept =
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    const res = await axios.get(WenxinBot.HOME_URL, {
      headers,
      timeout: 15000,
      validateStatus: () => true,
      maxRedirects: 5,
    });
    if (res.status !== 200) {
      throw new Error(`${this.name}: 获取首页失败 HTTP ${res.status}`);
    }
    const html = typeof res.data === "string" ? res.data : "";
    const match = html.match(
      /<script[^>]*name="aiTabFrameBaseData"[^>]*>([\s\S]*?)<\/script>/
    );
    if (!match) {
      throw new Error(`${this.name}: 未找到 aiTabFrameBaseData（Cookie 可能已失效）`);
    }
    let data;
    try {
      data = JSON.parse(match[1]);
    } catch (e) {
      throw new Error(`${this.name}: aiTabFrameBaseData 解析失败`);
    }
    if (!data.token || !data.lid) {
      throw new Error(`${this.name}: aiTabFrameBaseData 缺少 token/lid`);
    }
    return {
      userId: data.token,
      sessionId: data.lid,
      userInfo: data.userInfo,
    };
  }

  /** 生成 tk 参数：base64(userId|md5(query)|ts|sessionId)-sessionId-3 */
  static genTk(userId, query, ts, sessionId) {
    const md5q = crypto.createHash("md5").update(query).digest("hex");
    return (
      Buffer.from(`${userId}|${md5q}|${ts}|${sessionId}`).toString("base64") +
      `-${sessionId}-3`
    );
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

    // Step 1: 从首页 HTML 获取服务器签发的 userId 和 sessionId
    const { userId, sessionId } = await this.fetchServerToken();

    // Step 2: 构造 tk 和请求体
    const ts = Date.now();
    const tk = WenxinBot.genTk(userId, prompt, ts, sessionId);
    const body = {
      message: {
        inputMethod: "chat_search",
        isRebuild: false,
        content: {
          query: "",
          agentInfo: {
            agent_id: [""],
            params: JSON.stringify({ agt_rk: 3, agt_sess_cnt: 1 }),
          },
          agentInfoList: [],
          qtype: 0,
          extData: {},
        },
        searchInfo: {
          srcid: "",
          order: "",
          tplname: "",
          dqaKey: "",
          re_rank: "3",
          ori_lid: sessionId,
          sa: "bkb",
          enter_type: "yiyan_site",
          chatParams: {
            setype: "csaitab",
            chat_samples: "WISE_NEW_CSAITAB",
            chat_token: tk,
            scene: "",
          },
          isPrivateChat: false,
          usedModel: {
            modelName: "smartMode",
            modelFunction: { deepSearch: "0", thinkMode: "0" },
          },
          landingPageSwitch: "",
          landingPage: "aitab",
          ecomFrom: "",
          hasLocPermission: "",
          isInnovate: 2,
          applid: "",
          a_lid: "",
          showMindMap: false,
          deepDecisionInfo: { isDeepDecision: 0 },
        },
        from: "",
        source: "pc_csaitab",
        query: [
          {
            type: "TEXT",
            data: { text: { query: prompt, extData: "{}", text_type: "" } },
          },
        ],
        anti_ext: { inputT: null },
      },
      setype: "csaitab",
      rank: 3,
    };

    // Step 3: 发送 conversation 请求
    const headers = this.buildRequestHeaders();
    headers.Accept = "text/event-stream";
    const res = await Bot.post(WenxinBot.CHAT_URL, body, headers, {
      stream: true,
    });

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

    // Step 4: 解析 SSE 响应，提取 generator.data.value 增量文本
    let answer = "";
    let gotEnd = false;
    let errMsg = "";

    await Bot.consumeSSE(res.data, (data) => {
      if (!data || typeof data !== "object") return;
      const msg = data.data && data.data.message;
      if (!msg) return;

      // 检查是否结束
      const meta = msg.metaData;
      if (meta && (meta.endTurn === true || meta.state === "generate-complete")) {
        if (meta.endTurn === true) gotEnd = true;
      }

      // 提取增量文本
      const gen = msg.content && msg.content.generator;
      if (gen && gen.data && gen.data.value != null && gen.data.value !== "") {
        const delta = String(gen.data.value);
        answer += delta;
        if (onUpdate) onUpdate(delta);
      }

      // 检查错误提示（如 "😩抱歉，出了点小问题"）
      const hints = msg.content && msg.content.hints;
      if (hints && hints.parts && hints.parts[0] && hints.parts[0].text) {
        errMsg = hints.parts[0].text;
      }
    });

    if (!answer) {
      if (errMsg) {
        throw new Error(`${this.name}: 服务器返回错误：${errMsg}`);
      }
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
      // 优先通过 aiTabFrameBaseData 判断（同时验证 Cookie 有效性）
      const { userInfo } = await this.fetchServerToken();
      return !!userInfo && !!userInfo.name;
    } catch (e) {
      // 回退到 ChatALL ERNIEBot 的登录态探测路径
      try {
        const res = await axios.get(WenxinBot.USER_INFO_URL, {
          headers: this.buildHeaders(),
          timeout: 15000,
          validateStatus: () => true,
        });
        return !!(res.data && res.data.content && res.data.content.isLogin);
      } catch (e2) {
        return false;
      }
    }
  }
}

module.exports = WenxinBot;

const Bot = require("../Bot");
const axios = require("axios");

/**
 * 智谱清言 ChatGLM 网页版适配器，移植自 ChatALL 的 ChatGLM4Bot.js（GLM-4）。
 *
 * 适配要点：
 *  - 凭据：Cookie 形式，由 buildHeaders() 自动注入；Bearer token 从 cookie 的
 *    token= 字段提取（原 ChatALL 从 Vuex store 读取，这里改为正则解析）。
 *  - 单轮问答：每次 ask() 用空 conversation_id 新建会话，用完即弃（合并
 *    createChatContext 到 ask()）。
 *  - SSE：原 sse.js 改用 Bot.post({stream:true}) + Bot.consumeSSE。
 *  - 累积内容：GLM-4 每条 SSE 的 content.text 是当前累积全文，需要计算 delta
 *    后再回调 onUpdate；同时处理 tool_calls（搜索）与 citations（引用）。
 *  - 图片：网页版逆向未确认图片上传协议，忽略 images 参数。
 */

class ChatGLMBot extends Bot {
  static BASE = "https://chatglm.cn";
  // GLM-4 助手 ID（原 ChatALL 硬编码值）
  static ASSISTANT_ID = "65940acff94777010aa6b796";

  /** 从凭据（Cookie 字符串或裸 token）中提取 Bearer token。 */
  extractToken(raw) {
    const value = String(raw || "").trim();
    const m = value.match(/(?:^|;\s*)token=([^;]+)/);
    if (m) return m[1];
    // 不含 = 和 ; 时视为裸 token
    if (!value.includes("=") && !value.includes(";")) return value;
    return "";
  }

  /** 构造带 Cookie + Authorization 的请求头。 */
  buildAuthHeaders() {
    const headers = this.buildHeaders();
    const cred = this.getCredential();
    const token = this.extractToken(cred ? cred.value : "");
    if (token) headers.Authorization = `Bearer ${token}`;
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

    const headers = {
      ...this.buildAuthHeaders(),
      accept: "text/event-stream",
    };

    // GLM-4 单端点流式接口；conversation_id 留空表示新建会话
    const body = {
      assistant_id: ChatGLMBot.ASSISTANT_ID,
      conversation_id: "",
      meta_data: {
        is_test: false,
        input_question_type: "xxxx",
        channel: "",
        draft_id: "",
      },
      messages: [
        { role: "user", content: [{ type: "text", text: prompt }] },
      ],
    };

    const res = await Bot.post(
      `${ChatGLMBot.BASE}/chatglm/backend-api/assistant/stream`,
      body,
      headers,
      { stream: true }
    );

    if (res.status !== 200) {
      throw new Error(`${this.name}: HTTP ${res.status}`);
    }

    let beginning = ""; // 累积的搜索信息（跨事件 +=）
    let emittedBeginning = "";
    let prevBody = "";
    let prevEnding = "";
    let answer = "";
    let finished = false;

    await Bot.consumeSSE(res.data, (data) => {
      if (!data) return;
      const response = data.parts && data.parts[0];
      if (!response || response.role !== "assistant") return;
      const content = response.content && response.content[0];
      if (!content) return;

      let bodyText = "";
      let ending = "";

      if (content.type === "tool_calls" && response.status === "init") {
        // 搜索等工具调用，累积到 beginning
        if (content.tool_calls && content.tool_calls.name === "browser") {
          const info = content.tool_calls.arguments;
          if (info && info.startsWith("search")) {
            beginning += `> ${info}\n`;
          }
        }
      } else if (content.type === "text") {
        bodyText = content.text || "";
        const citations =
          response.meta_data && response.meta_data.citations;
        if (citations) {
          citations.forEach((c) => {
            const title = (c.metadata && c.metadata.title) || "";
            const url = (c.metadata && c.metadata.url) || "";
            ending += `> - [${title}](${url})\n`;
          });
        }
      }

      if (data.status === "finish") finished = true;

      const deltas = [];

      // 1. 搜索信息增量
      if (
        beginning.length > emittedBeginning.length &&
        beginning.startsWith(emittedBeginning)
      ) {
        deltas.push(beginning.slice(emittedBeginning.length));
        emittedBeginning = beginning;
      }

      // 2. 正文增量（content.text 为累积全文，计算后缀增量）
      if (bodyText) {
        if (bodyText.startsWith(prevBody)) {
          const d = bodyText.slice(prevBody.length);
          if (d) deltas.push(d);
        } else {
          deltas.push(bodyText);
        }
        prevBody = bodyText;
      }

      // 3. 引用增量
      if (ending && ending !== prevEnding) {
        if (ending.startsWith(prevEnding)) {
          const d = ending.slice(prevEnding.length);
          if (d) deltas.push(d);
        } else {
          deltas.push(ending);
        }
        prevEnding = ending;
      }

      const delta = deltas.join("");
      if (delta) {
        answer += delta;
        if (onUpdate) onUpdate(delta);
      }
    });

    if (!answer) {
      throw new Error(
        `${this.name}: 空回答（流中断或未授权）${finished ? "" : "（未收到 finish）"}`
      );
    }
    return answer;
  }

  async checkAvailability() {
    if (process.env.ASKALL_MOCK === "1") return !!this.getCredential();
    if (!this.getCredential()) return false;
    try {
      const res = await axios.get(
        `${ChatGLMBot.BASE}/chatglm/backend-api/v3/user/info`,
        {
          headers: this.buildAuthHeaders(),
          timeout: 15000,
          validateStatus: () => true,
        }
      );
      return !!(res.data && res.data.message === "success");
    } catch (e) {
      return false;
    }
  }
}

module.exports = ChatGLMBot;

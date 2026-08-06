const Bot = require("../Bot");
const axios = require("axios");
const crypto = require("crypto");

/**
 * Perplexity (www.perplexity.ai) web adapter, ported from ChatALL's PerplexityBot.
 *
 * 协议说明: Perplexity 的网页问答走 Socket.IO v4 (EIO=4) 协议,不是普通 SSE。
 * ChatALL 原版用 websocket-as-promised 走 WebSocket 通道;AskAll 没有该依赖,
 * 这里改用纯 HTTP long-polling 传输实现同一套握手/收发逻辑:
 *   1. GET  polling            -> 0{"sid":"..."}            (engine.io open)
 *   2. POST polling 40{jwt}    -> namespace connect (匿名 jwt: anonymous-ask-user)
 *   3. GET  polling            -> 40 (namespace connected)
 *   4. POST polling 42<ack>["perplexity_ask", prompt, opts]  (EVENT with ACK)
 *   5. 循环 GET polling 收消息:
 *        2          -> ping,  回 POST "3" (pong)
 *        42[...]    -> EVENT, object[1].text 内含增量 answer
 *        43<ack>[...] -> ACK,  object[0].text 内含最终 answer,结束
 *        6          -> noop,  忽略继续 poll
 *
 * Cookie 由 Bot.buildHeaders() 注入(登录态可选,匿名提问本身不需要)。
 */
class PerplexityBot extends Bot {
  static BASE = "https://www.perplexity.ai";
  static POLLING = `${PerplexityBot.BASE}/socket.io/?EIO=4&transport=polling`;

  // base64 时间戳编码 (源码 Z 函数,用于 ?t= 参数)
  static V =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_".split("");

  constructor(meta) {
    super(meta);
    this.seq = 1;
  }

  Z(e) {
    let t = "";
    do {
      t = PerplexityBot.V[e % 64] + t;
      e = Math.floor(e / 64);
    } while (e > 0);
    return t;
  }

  get t() {
    return this.Z(Date.now());
  }

  /** 把 "42[...]" / "431[...]" 拆成 { number, object }。 */
  separateNumberAndObject(input) {
    const s = String(input);
    const m = s.match(/^(\d+)(.*)/);
    if (m) {
      const number = parseInt(m[1], 10);
      try {
        return { number, object: JSON.parse(m[2]) };
      } catch (e) {
        return { number, object: m[2] };
      }
    }
    return { object: s };
  }

  /** polling 响应可能是单条字符串,或 JSON 数组(多条消息打包)。统一返回数组。 */
  parsePollingData(data) {
    const s = String(data);
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr;
    } catch (e) {
      /* not a JSON array */
    }
    return [s];
  }

  async pollGet(sid) {
    const url = sid
      ? `${PerplexityBot.POLLING}&t=${this.t}&sid=${sid}`
      : `${PerplexityBot.POLLING}&t=${this.t}`;
    const res = await axios.get(url, {
      headers: this.buildHeaders(),
      timeout: 35000,
      validateStatus: () => true,
      responseType: "text",
      transformResponse: [(d) => d],
    });
    if (res.status !== 200) {
      throw new Error(`polling GET HTTP ${res.status}`);
    }
    return res.data;
  }

  async pollPost(sid, body) {
    const url = `${PerplexityBot.POLLING}&t=${this.t}&sid=${sid}`;
    const res = await axios.post(url, body, {
      headers: {
        ...this.buildHeaders(),
        "Content-Type": "text/plain;charset=UTF-8",
      },
      timeout: 35000,
      validateStatus: () => true,
      responseType: "text",
      transformResponse: [(d) => d],
    });
    if (res.status !== 200) {
      throw new Error(`polling POST HTTP ${res.status}`);
    }
    return res.data;
  }

  async ask(prompt, images = [], onUpdate) {
    if (process.env.ASKALL_MOCK === "1") {
      return this.mockAnswer(prompt, onUpdate);
    }

    // 1. 获取 Socket.IO sid (engine.io open)
    let sid;
    try {
      const openRaw = await this.pollGet();
      const parsed = this.separateNumberAndObject(openRaw);
      sid = parsed.object?.sid;
      if (!sid) throw new Error("未获取到 sid");
    } catch (e) {
      throw new Error(`${this.name}: 建立连接失败 - ${e.message}`);
    }

    // 2. namespace connect (匿名 jwt,源码逻辑)
    try {
      await this.pollPost(sid, `40${JSON.stringify({ jwt: "anonymous-ask-user" })}`);
      await this.pollGet(sid); // 确认 40
    } catch (e) {
      throw new Error(`${this.name}: 握手失败 - ${e.message}`);
    }

    // 3. 发送 perplexity_ask (EVENT with ACK, 42<ack_id>[event, ...args])
    const ackId = this.seq++;
    const askEvent = [
      "perplexity_ask",
      prompt,
      {
        version: "2.9",
        source: "default",
        last_backend_uuid: null, // 单轮,无上下文
        read_write_token: null,
        attachments: [],
        language: "en-US",
        timezone: "UTC",
        search_focus: "internet",
        frontend_uuid: crypto.randomUUID(),
        mode: "concise",
        is_related_query: false,
        is_default_related_query: false,
        frontend_context_uuid: crypto.randomUUID(),
        prompt_source: "user",
        query_source: "home", // 无 last_backend_uuid -> home
      },
    ];
    try {
      await this.pollPost(sid, `42${ackId}${JSON.stringify(askEvent)}`);
    } catch (e) {
      throw new Error(`${this.name}: 发送提问失败 - ${e.message}`);
    }

    // 4. 循环 polling 接收响应
    let answer = "";
    let lastLen = 0;
    let done = false;
    const deadline = Date.now() + 120000;
    let consecutiveErrors = 0;

    while (!done && Date.now() < deadline) {
      let raw;
      try {
        raw = await this.pollGet(sid);
        consecutiveErrors = 0;
      } catch (e) {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          throw new Error(`${this.name}: 接收响应失败 - ${e.message}`);
        }
        continue; // 瞬断重试
      }

      const messages = this.parsePollingData(raw);
      for (const msg of messages) {
        const { number, object } = this.separateNumberAndObject(msg);

        if (number === 2) {
          // ping -> pong
          try {
            await this.pollPost(sid, "3");
          } catch (e) {
            /* pong 失败非致命 */
          }
        } else if (number === 42) {
          // EVENT: ["perplexity_answer", {text: "..."}] (增量)
          if (Array.isArray(object) && object.length >= 2 && object[1]?.text) {
            try {
              const resp = JSON.parse(object[1].text);
              if (resp?.answer && resp.answer.length > lastLen) {
                const delta = resp.answer.slice(lastLen);
                answer = resp.answer;
                lastLen = resp.answer.length;
                if (onUpdate) onUpdate(delta);
              }
            } catch (e) {
              /* text 不是 JSON,跳过 */
            }
          }
        } else if (String(number).startsWith("43")) {
          // ACK: [{text: "..."}] (完成)
          if (Array.isArray(object) && object.length >= 1 && object[0]?.text) {
            try {
              const resp = JSON.parse(object[0].text);
              if (resp?.answer && resp.answer.length > lastLen) {
                const delta = resp.answer.slice(lastLen);
                answer = resp.answer;
                lastLen = resp.answer.length;
                if (onUpdate) onUpdate(delta);
              }
            } catch (e) {
              /* text 不是 JSON,跳过 */
            }
          }
          done = true;
        }
        // 6 = engine.io noop,忽略
      }
    }

    if (!answer) {
      throw new Error(
        `${this.name}: 空回答（可能被反爬拦截或 Socket.IO 协议变更）`,
      );
    }
    return answer;
  }

  async checkAvailability() {
    if (process.env.ASKALL_MOCK === "1") return !!this.getCredential();
    try {
      const res = await axios.get(`${PerplexityBot.BASE}/api/auth/session`, {
        headers: this.buildHeaders(),
        timeout: 15000,
        validateStatus: () => true,
      });
      // 网站可达即认为可用;匿名提问本身不要求登录。
      // 若用户配置了 Cookie,会随 buildHeaders() 一并发出以校验登录态。
      return res.status === 200;
    } catch (e) {
      return false;
    }
  }

  async mockAnswer(prompt, onUpdate) {
    const text = `[模拟回答 - ${this.name}] 针对问题「${prompt.slice(0, 60)}」的回答：这是 ${this.name}（网页版）在 ASKALL_MOCK 模式下生成的演示回答。`;
    if (onUpdate) {
      for (const ch of text) {
        await new Promise((r) => setTimeout(r, 8));
        onUpdate(ch);
      }
    }
    return text;
  }
}

module.exports = PerplexityBot;

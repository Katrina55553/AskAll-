const Bot = require("../Bot");
const axios = require("axios");
const crypto = require("crypto");

/**
 * DeepSeek (chat.deepseek.com) 网页版适配器，基于公开逆向资料实现。
 *
 * 逆向来源：
 *  - xtekky/deepseek4free（Python + WASM PoW，GitHub）
 *  - LLM-Red-Team/deepseek-free-api（Node.js/TS，Gitee/GitHub）
 *  - 社区 iOS 抓包逆向文章（掘金）
 *
 * 认证：Authorization: Bearer <userToken>，userToken 从 localStorage 的
 * userToken 项 JSON.value 中获取。凭据以 cookie 类型存储，可粘贴：
 *   - 裸 userToken（JWT，以 eyJ 开头）
 *   - localStorage 转储：userToken={"value":"eyJ..."}
 *   - 含 cf_clearance 的完整 cookie 串（同时提取 token + 保留 Cookie 头）
 *
 * 请求流程：
 *   1. POST /api/v0/chat_session/create      → 返回 session id
 *   2. POST /api/v0/chat/create_pow_challenge → 返回 PoW 挑战配置
 *   3. 本地求解 PoW（SHA3-512，未经实测）
 *   4. POST /api/v0/chat/completion（SSE 流）+ x-ds-pow-response 头
 *
 * SSE 格式（OpenAI 兼容）：
 *   data: {"choices":[{"delta":{"content":"...","type":"text"},"finish_reason":null}]}
 *   data: [DONE]
 */
class DeepSeekBot extends Bot {
  static BASE = "https://chat.deepseek.com";
  static API = `${DeepSeekBot.BASE}/api/v0`;

  /**
   * 从凭据值中提取 userToken（JWT）。
   * 支持：裸 JWT、localStorage 转储（{"value":"eyJ..."}）、cookie 串。
   */
  extractToken(raw) {
    const value = String(raw || "").trim();
    if (!value) return "";
    // 1. localStorage JSON: {"value":"eyJ..."} 或 userToken={"value":"eyJ..."}
    let m = value.match(/"value"\s*:\s*"(eyJ[^"]+)"/);
    if (m) return m[1];
    // 2. 裸 JWT（三段 base64url，以 eyJ 开头）
    m = value.match(/^(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
    if (m) return m[1];
    // 3. JWT 嵌在 cookie / query string 中
    m = value.match(/(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
    if (m) return m[1];
    // 4. userToken=... 在 cookie 串中
    m = value.match(/userToken=([^;\s&]+)/);
    if (m) return m[1];
    // 5. 回退：不含 = 或以 eyJ 开头时直接使用
    if (!value.includes("=") || value.startsWith("eyJ")) return value;
    return "";
  }

  /**
   * 构造请求头：Cookie（来自凭据，用于 cf_clearance 等）+ Authorization
   * + DeepSeek 专有头（x-app-version 等）。
   */
  buildAuthHeaders(token) {
    const headers = this.buildHeaders(); // 基类：UA + Cookie
    const cred = this.getCredential();
    const authToken = token || this.extractToken(cred ? cred.value : "");
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    headers.Origin = DeepSeekBot.BASE;
    headers.Referer = DeepSeekBot.BASE + "/";
    headers.Accept = "*/*";
    headers["x-app-version"] = "20241129.1";
    headers["x-client-locale"] = "en_US";
    headers["x-client-platform"] = "web";
    headers["x-client-version"] = "1.0.0-always";
    return headers;
  }

  /**
   * 获取 PoW 挑战配置。
   * POST /api/v0/chat/create_pow_challenge  body: { target_path: "/api/v0/chat/completion" }
   * 返回：{ algorithm, challenge, salt, difficulty, expire_at, signature, target_path }
   */
  async fetchPowChallenge(token) {
    const res = await axios.post(
      `${DeepSeekBot.API}/chat/create_pow_challenge`,
      { target_path: "/api/v0/chat/completion" },
      {
        headers: this.buildAuthHeaders(token),
        timeout: 15000,
        validateStatus: () => true,
      }
    );
    if (res.status !== 200 || !res.data || !res.data.data || !res.data.data.biz_data || !res.data.data.biz_data.challenge) {
      throw new Error(`${this.name}: 获取 PoW 挑战失败（HTTP ${res.status}）`);
    }
    return res.data.data.biz_data.challenge;
  }

  /**
   * 求解 PoW 挑战（SHA3-512）。
   *
   * 未经实测 — 官方客户端使用 WASM 模块（sha3_wasm_bg）求解。此纯 JS
   * 实现基于社区对算法的逆向分析：
   *   1. prefix = `${salt}_${expire_at}_`
   *   2. 从 answer=0 开始递增：
   *      hash = SHA3-512(prefix + answer + challenge)
   *      hashVal = hash 前 48 bit（12 hex 字符）作为整数
   *      若 hashVal < 2^48 / difficulty，则返回 answer
   *
   * 若此求解器算法有误，completion 请求将返回 401/403。届时需移植 WASM。
   */
  solvePow(challenge) {
    const prefix = `${challenge.salt}_${challenge.expire_at}_`;
    const challengeStr = challenge.challenge;
    const difficulty = parseFloat(challenge.difficulty);
    if (!difficulty || difficulty <= 0) return 0;
    // P(每次成功) = 1/difficulty → 期望迭代次数 = difficulty
    const threshold = Math.pow(2, 48) / difficulty;
    const MAX_ITER = 500000;
    for (let answer = 0; answer < MAX_ITER; answer++) {
      const text = `${prefix}${answer}${challengeStr}`;
      const hash = crypto.createHash("sha3-512").update(text, "utf8").digest("hex");
      const hashVal = parseInt(hash.substring(0, 12), 16);
      if (hashVal < threshold) return answer;
    }
    return null; // 求解失败
  }

  /**
   * 将求解结果编码为 x-ds-pow-response 头值。
   * 格式：base64(JSON({algorithm, challenge, salt, answer, signature, target_path}))
   */
  buildPowResponse(challenge, answer) {
    const result = {
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      salt: challenge.salt,
      answer: answer,
      signature: challenge.signature,
      target_path: challenge.target_path,
    };
    return Buffer.from(JSON.stringify(result)).toString("base64");
  }

  /**
   * 创建聊天会话。
   * POST /api/v0/chat_session/create  body: { character_id: null }
   * 返回：session id
   */
  async createSession(token) {
    const res = await axios.post(
      `${DeepSeekBot.API}/chat_session/create`,
      { character_id: null },
      {
        headers: this.buildAuthHeaders(token),
        timeout: 15000,
        validateStatus: () => true,
      }
    );
    if (res.status !== 200 || !res.data || !res.data.data || !res.data.data.biz_data || !res.data.data.biz_data.id) {
      throw new Error(`${this.name}: 创建会话失败（HTTP ${res.status}）`);
    }
    return res.data.data.biz_data.id;
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
    const token = this.extractToken(cred.value);
    if (!token) throw new Error(`${this.name}: 无法从凭据中提取 userToken`);

    // 1. 创建会话
    const sessionId = await this.createSession(token);

    // 2. 求解 PoW（尽力而为，失败则不带 x-ds-pow-response 头继续）
    let powHeader = null;
    try {
      const challenge = await this.fetchPowChallenge(token);
      const answer = this.solvePow(challenge);
      if (answer !== null) {
        powHeader = this.buildPowResponse(challenge, answer);
      }
    } catch (e) {
      // PoW 获取/求解失败 — 继续，completion 可能被拒
    }

    // 3. 发送 completion 请求
    const headers = this.buildAuthHeaders(token);
    if (powHeader) {
      headers["x-ds-pow-response"] = powHeader;
    }

    const res = await Bot.post(
      `${DeepSeekBot.API}/chat/completion`,
      {
        chat_session_id: sessionId,
        parent_message_id: null,
        prompt: prompt,
        ref_file_ids: [],
        thinking_enabled: false,
        search_enabled: false,
      },
      headers,
      { stream: true }
    );

    if (res.status !== 200) {
      throw new Error(
        `${this.name}: HTTP ${res.status} ${typeof res.data === "string" ? res.data.slice(0, 200) : ""}`
      );
    }

    let answer = "";
    let done = false;
    let streamError = null;

    await Bot.consumeSSE(res.data, (json) => {
      // OpenAI 兼容格式
      if (json.choices && json.choices[0]) {
        const choice = json.choices[0];
        if (choice.delta && choice.delta.content) {
          // thinking_enabled=false 时不应有 thinking 块，但做防御性过滤
          if (choice.delta.type !== "thinking") {
            answer += choice.delta.content;
            if (onUpdate) onUpdate(choice.delta.content);
          }
        }
        if (choice.finish_reason === "stop") {
          done = true;
        }
      }
      // 部分错误以 SSE 事件返回
      if (json.error) {
        streamError = typeof json.error === "string" ? json.error : json.error.message || JSON.stringify(json.error);
      }
    });

    if (streamError) {
      throw new Error(`${this.name}: ${streamError}`);
    }
    if (!answer) {
      throw new Error(`${this.name}: 空回答${done ? "" : "（流中断或被 Cloudflare 拦截）"}`);
    }
    return answer;
  }

  async checkAvailability() {
    if (process.env.ASKALL_MOCK === "1") return !!this.getCredential();
    if (!this.getCredential()) return false;
    try {
      const cred = this.getCredential();
      const token = this.extractToken(cred.value);
      if (!token) return false;
      // 轻量请求验证 token 有效性
      const res = await axios.get(`${DeepSeekBot.API}/users/current`, {
        headers: this.buildAuthHeaders(token),
        timeout: 15000,
        validateStatus: () => true,
      });
      if (res.status === 200) return true;
      // 401/403 → token 无效；其他错误（如 404 端点不存在）→ 回退到会话创建
      if (res.status === 401 || res.status === 403) return false;
      // 回退：尝试创建会话（已验证不需要 PoW）
      try {
        await this.createSession(token);
        return true;
      } catch (e) {
        return false;
      }
    } catch (e) {
      return false;
    }
  }
}

module.exports = DeepSeekBot;

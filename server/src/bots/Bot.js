const axios = require("axios");
const credentialStore = require("./credentialStore");

/**
 * Bot base class (adapted from ChatALL's Bot.js for pure Node.js):
 * - Electron session cookies -> credential store (Cookie / API Key injection)
 * - Vuex chat context -> per-call single-turn context
 * - Streaming via axios response stream with SSE line parsing
 */
class Bot {
  constructor(meta) {
    this.meta = meta;
    this.id = meta.id;
    this.name = meta.name;
    this.supportsImage = !!meta.supportsImage;
    this.contextWindow = meta.contextWindow || 8000;
  }

  getCredential() {
    const record = credentialStore.get(this.id);
    return record && record.value ? record : null;
  }

  isAvailable() {
    return !!this.getCredential();
  }

  buildHeaders() {
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    };
    const cred = this.getCredential();
    if (!cred) return headers;
    if (cred.type === "cookie") headers.Cookie = cred.value;
    if (cred.type === "apikey") headers.Authorization = `Bearer ${cred.value}`;
    return headers;
  }

  /**
   * Ask the bot a question.
   * @param {string} prompt
   * @param {Array<{mime:string, dataBase64:string}>} images
   * @param {(delta:string)=>void} [onUpdate] streaming callback
   * @returns {Promise<string>} full answer text
   */
  async ask(prompt, images = [], onUpdate) {
    throw new Error("ask() not implemented");
  }

  /** Validate credential by making a lightweight request. */
  async checkAvailability() {
    throw new Error("checkAvailability() not implemented");
  }

  /**
   * Parse an SSE (text/event-stream) HTTP response, invoking onData(parsedJson, rawData)
   * per event. Returns a promise resolving when the stream ends.
   */
  static consumeSSE(stream, onData) {
    return new Promise((resolve, reject) => {
      let buffer = "";
      stream.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            onData(JSON.parse(data), data);
          } catch (e) {
            /* non-JSON SSE line, skip */
          }
        }
      });
      stream.on("end", resolve);
      stream.on("error", reject);
    });
  }

  static post(url, body, headers, { stream = false, timeout = 120000 } = {}) {
    return axios.post(url, body, {
      headers: { "Content-Type": "application/json", ...headers },
      responseType: stream ? "stream" : "json",
      timeout,
      validateStatus: () => true,
    });
  }
}

module.exports = Bot;

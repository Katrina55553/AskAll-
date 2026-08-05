// Bot registry: metadata for all supported bots.
// tags: free (web/cookie) | api (official API key)
// credentialType: "cookie" (web reverse API) | "apikey" (official API)
// implementation: resolved lazily from ./implementations/<id>.js

const BOTS = [
  // ---- API type ----
  { id: "chatgpt-api", name: "ChatGPT (API)", tags: ["api"], credentialType: "apikey", supportsImage: true, contextWindow: 128000, model: "gpt-4o-mini", baseURL: "https://api.openai.com/v1" },
  { id: "claude-api", name: "Claude (API)", tags: ["api"], credentialType: "apikey", supportsImage: true, contextWindow: 200000 },
  { id: "gemini-api", name: "Gemini (API)", tags: ["api"], credentialType: "apikey", supportsImage: true, contextWindow: 1000000 },
  { id: "grok-api", name: "Grok (xAI API)", tags: ["api"], credentialType: "apikey", supportsImage: false, contextWindow: 131072, model: "grok-2-latest", baseURL: "https://api.x.ai/v1" },
  { id: "qwen-api", name: "通义千问 (API)", tags: ["api"], credentialType: "apikey", supportsImage: true, contextWindow: 131072, model: "qwen-flash", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { id: "wenxin-api", name: "文心一言 (API)", tags: ["api"], credentialType: "apikey", supportsImage: false, contextWindow: 128000, model: "ernie-speed-128k", baseURL: "https://qianfan.baidubce.com/v2" },
  { id: "zhipu-api", name: "智谱 ChatGLM (API)", tags: ["api"], credentialType: "apikey", supportsImage: true, contextWindow: 128000, model: "glm-4-flash", baseURL: "https://open.bigmodel.cn/api/paas/v4" },
  { id: "moonshot-api", name: "Kimi (Moonshot API)", tags: ["api"], credentialType: "apikey", supportsImage: false, contextWindow: 131072, model: "moonshot-v1-8k", baseURL: "https://api.moonshot.cn/v1" },
  { id: "deepseek-api", name: "DeepSeek (API)", tags: ["api"], credentialType: "apikey", supportsImage: false, contextWindow: 64000, model: "deepseek-chat", baseURL: "https://api.deepseek.com/v1" },
  { id: "doubao-api", name: "豆包 (API)", tags: ["api"], credentialType: "apikey", supportsImage: true, contextWindow: 128000, baseURL: "https://ark.cn-beijing.volces.com/api/v3" },
  { id: "hunyuan-api", name: "腾讯混元 (API)", tags: ["api"], credentialType: "apikey", supportsImage: false, contextWindow: 32000 },
  { id: "minimax-api", name: "MiniMax (API)", tags: ["api"], credentialType: "apikey", supportsImage: false, contextWindow: 245760 },

  // ---- Web (cookie) type: free ----
  { id: "chatgpt", name: "ChatGPT", tags: ["free"], credentialType: "cookie", supportsImage: true, contextWindow: 128000, homepage: "https://chat.openai.com" },
  { id: "gemini", name: "Google Gemini", tags: ["free"], credentialType: "cookie", supportsImage: true, contextWindow: 32000, homepage: "https://gemini.google.com" },
  { id: "claude", name: "Claude", tags: ["free"], credentialType: "cookie", supportsImage: true, contextWindow: 200000, homepage: "https://claude.ai" },
  { id: "perplexity", name: "Perplexity", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 32000, homepage: "https://www.perplexity.ai" },
  { id: "grok", name: "Grok (Web)", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 32000, homepage: "https://grok.x.ai" },
  { id: "kimi", name: "Kimi", tags: ["free"], credentialType: "cookie", supportsImage: true, contextWindow: 131072, homepage: "https://kimi.moonshot.cn" },
  { id: "deepseek", name: "DeepSeek", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 64000, homepage: "https://chat.deepseek.com" },
  { id: "qwen", name: "通义千问", tags: ["free"], credentialType: "cookie", supportsImage: true, contextWindow: 32000, homepage: "https://tongyi.aliyun.com" },
  { id: "wenxin", name: "文心一言", tags: ["free"], credentialType: "cookie", supportsImage: true, contextWindow: 32000, homepage: "https://yiyan.baidu.com" },
  { id: "chatglm", name: "智谱清言 ChatGLM", tags: ["free"], credentialType: "cookie", supportsImage: true, contextWindow: 32000, homepage: "https://chatglm.cn" },
  { id: "doubao", name: "豆包", tags: ["free"], credentialType: "cookie", supportsImage: true, contextWindow: 32000, homepage: "https://www.doubao.com" },
  { id: "hunyuan", name: "腾讯元宝", tags: ["free"], credentialType: "cookie", supportsImage: true, contextWindow: 32000, homepage: "https://yuanbao.tencent.com" },
];

const byId = new Map(BOTS.map((b) => [b.id, b]));

function listBots() {
  return BOTS.map((b) => ({ ...b, implemented: hasImplementation(b.id) }));
}

function getBotMeta(id) {
  return byId.get(id) || null;
}

function hasImplementation(id) {
  try {
    require.resolve(`./implementations/${id}`);
    return true;
  } catch (e) {
    // fall back to generic adapters by credential type
    if (byId.get(id)?.credentialType === "apikey" && byId.get(id)?.baseURL) {
      return true; // OpenAI-compatible adapter
    }
    return false;
  }
}

// Instantiate a bot implementation. Throws if not implemented.
function createBot(id) {
  const meta = byId.get(id);
  if (!meta) throw new Error(`Unknown bot: ${id}`);
  try {
    const Impl = require(`./implementations/${id}`);
    return new Impl(meta);
  } catch (e) {
    if (e.code !== "MODULE_NOT_FOUND" || !String(e.message).includes(id)) throw e;
  }
  if (meta.credentialType === "apikey" && meta.baseURL) {
    const OpenAICompatibleBot = require("./implementations/OpenAICompatibleBot");
    return new OpenAICompatibleBot(meta);
  }
  const WebBot = require("./implementations/WebBot");
  return new WebBot(meta);
}

module.exports = { listBots, getBotMeta, createBot, BOTS };

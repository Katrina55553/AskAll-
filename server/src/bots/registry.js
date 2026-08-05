// Bot registry: metadata for all ~66 ChatALL bots.
// tags: free / paid / api / madeInChina (ChatALL grouping)
// credentialType: "cookie" (web reverse API) | "apikey" (official API)
// implementation: resolved lazily from ./implementations/<id>.js

const BOTS = [
  // ---- API type ----
  { id: "chatgpt-api", name: "ChatGPT (API)", tags: ["api"], credentialType: "apikey", supportsImage: true, contextWindow: 128000, model: "gpt-4o-mini", baseURL: "https://api.openai.com/v1" },
  { id: "azure-openai-api", name: "Azure OpenAI (API)", tags: ["api"], credentialType: "apikey", supportsImage: false, contextWindow: 128000 },
  { id: "claude-api", name: "Claude (API)", tags: ["api"], credentialType: "apikey", supportsImage: true, contextWindow: 200000 },
  { id: "gemini-api", name: "Gemini (API)", tags: ["api"], credentialType: "apikey", supportsImage: true, contextWindow: 1000000 },
  { id: "palm2-api", name: "Google PaLM 2 (API)", tags: ["api"], credentialType: "apikey", supportsImage: false, contextWindow: 8000 },
  { id: "grok-api", name: "Grok (xAI API)", tags: ["api"], credentialType: "apikey", supportsImage: false, contextWindow: 131072, model: "grok-2-latest", baseURL: "https://api.x.ai/v1" },
  { id: "mistral-api", name: "Mistral (API)", tags: ["api"], credentialType: "apikey", supportsImage: false, contextWindow: 32000, model: "mistral-small-latest", baseURL: "https://api.mistral.ai/v1" },
  { id: "cohere-api", name: "Cohere (API)", tags: ["api"], credentialType: "apikey", supportsImage: false, contextWindow: 128000 },
  { id: "groq-api", name: "Groq (API)", tags: ["api"], credentialType: "apikey", supportsImage: false, contextWindow: 128000, model: "llama-3.3-70b-versatile", baseURL: "https://api.groq.com/openai/v1" },
  { id: "huggingface-api", name: "HuggingFace (API)", tags: ["api"], credentialType: "apikey", supportsImage: false, contextWindow: 32000 },
  { id: "openrouter-api", name: "OpenRouter (API)", tags: ["api"], credentialType: "apikey", supportsImage: false, contextWindow: 128000, baseURL: "https://openrouter.ai/api/v1" },
  // ---- 国产 API ----
  { id: "qwen-api", name: "通义千问 (API)", tags: ["api", "madeInChina"], credentialType: "apikey", supportsImage: true, contextWindow: 131072, model: "qwen-flash", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { id: "wenxin-api", name: "文心一言 (API)", tags: ["api", "madeInChina"], credentialType: "apikey", supportsImage: false, contextWindow: 128000, model: "ernie-speed-128k", baseURL: "https://qianfan.baidubce.com/v2" },
  { id: "zhipu-api", name: "智谱 ChatGLM (API)", tags: ["api", "madeInChina"], credentialType: "apikey", supportsImage: true, contextWindow: 128000, model: "glm-4-flash", baseURL: "https://open.bigmodel.cn/api/paas/v4" },
  { id: "moonshot-api", name: "Kimi (Moonshot API)", tags: ["api", "madeInChina"], credentialType: "apikey", supportsImage: false, contextWindow: 131072, model: "moonshot-v1-8k", baseURL: "https://api.moonshot.cn/v1" },
  { id: "deepseek-api", name: "DeepSeek (API)", tags: ["api", "madeInChina"], credentialType: "apikey", supportsImage: false, contextWindow: 64000, model: "deepseek-chat", baseURL: "https://api.deepseek.com/v1" },
  { id: "spark-api", name: "讯飞星火 (API)", tags: ["api", "madeInChina"], credentialType: "apikey", supportsImage: false, contextWindow: 32000, model: "generalv3.5" },
  { id: "doubao-api", name: "豆包 (API)", tags: ["api", "madeInChina"], credentialType: "apikey", supportsImage: true, contextWindow: 128000, baseURL: "https://ark.cn-beijing.volces.com/api/v3" },
  { id: "hunyuan-api", name: "腾讯混元 (API)", tags: ["api", "madeInChina"], credentialType: "apikey", supportsImage: false, contextWindow: 32000 },
  { id: "yi-api", name: "零一万物 Yi (API)", tags: ["api", "madeInChina"], credentialType: "apikey", supportsImage: false, contextWindow: 16000, model: "yi-lightning", baseURL: "https://api.lingyiwanwu.com/v1" },
  { id: "minimax-api", name: "MiniMax (API)", tags: ["api", "madeInChina"], credentialType: "apikey", supportsImage: false, contextWindow: 245760 },

  // ---- Web (cookie) type: free ----
  { id: "chatgpt", name: "ChatGPT", tags: ["free"], credentialType: "cookie", supportsImage: true, contextWindow: 128000, homepage: "https://chat.openai.com" },
  { id: "copilot", name: "Microsoft Copilot", tags: ["free"], credentialType: "cookie", supportsImage: true, contextWindow: 32000, homepage: "https://copilot.microsoft.com" },
  { id: "gemini", name: "Google Gemini", tags: ["free"], credentialType: "cookie", supportsImage: true, contextWindow: 32000, homepage: "https://gemini.google.com" },
  { id: "claude", name: "Claude", tags: ["free"], credentialType: "cookie", supportsImage: true, contextWindow: 200000, homepage: "https://claude.ai" },
  { id: "perplexity", name: "Perplexity", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 32000, homepage: "https://www.perplexity.ai" },
  { id: "phind", name: "Phind", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 16000, homepage: "https://www.phind.com" },
  { id: "pi", name: "Pi", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 8000, homepage: "https://pi.ai" },
  { id: "you", name: "YouChat", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 16000, homepage: "https://you.com" },
  { id: "huggingchat", name: "HuggingChat", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 32000, homepage: "https://huggingface.co/chat" },
  { id: "lmsys", name: "Chatbot Arena (LMSYS)", tags: ["free"], credentialType: "cookie", supportsImage: true, contextWindow: 32000, homepage: "https://chat.lmsys.org" },
  { id: "poe-chatgpt", name: "Poe - ChatGPT", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 16000, homepage: "https://poe.com" },
  { id: "poe-claude", name: "Poe - Claude", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 100000, homepage: "https://poe.com" },
  { id: "poe-sage", name: "Poe - Sage", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 16000, homepage: "https://poe.com" },
  { id: "poe-dragonfly", name: "Poe - Dragonfly", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 8000, homepage: "https://poe.com" },
  { id: "character-ai", name: "Character.AI", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 8000, homepage: "https://character.ai" },
  { id: "open-assistant", name: "OpenAssistant", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 8000, homepage: "https://open-assistant.io" },
  { id: "mistral", name: "Mistral Le Chat", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 32000, homepage: "https://chat.mistral.ai" },
  { id: "grok", name: "Grok (Web)", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 32000, homepage: "https://grok.x.ai" },
  { id: "llama2-70b", name: "LLaMA 2 70B", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 4096, homepage: "https://chat.lmsys.org" },
  { id: "llama2-13b", name: "LLaMA 2 13B", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 4096, homepage: "https://chat.lmsys.org" },
  { id: "llama2-7b", name: "LLaMA 2 7B", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 4096, homepage: "https://chat.lmsys.org" },
  { id: "code-llama", name: "Code Llama", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 16000, homepage: "https://chat.lmsys.org" },
  { id: "vicuna", name: "Vicuna", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 4096, homepage: "https://chat.lmsys.org" },
  { id: "alpaca", name: "Alpaca", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 4096, homepage: "https://chat.lmsys.org" },
  { id: "wizardlm", name: "WizardLM", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 4096, homepage: "https://chat.lmsys.org" },
  { id: "falcon-180b", name: "Falcon 180B", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 4096, homepage: "https://chat.lmsys.org" },
  { id: "falcon-40b", name: "Falcon 40B", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 4096, homepage: "https://chat.lmsys.org" },
  { id: "falcon-7b", name: "Falcon 7B", tags: ["free"], credentialType: "cookie", supportsImage: false, contextWindow: 4096, homepage: "https://chat.lmsys.org" },

  // ---- Web (cookie) type: 国产 ----
  { id: "kimi", name: "Kimi", tags: ["free", "madeInChina"], credentialType: "cookie", supportsImage: true, contextWindow: 131072, homepage: "https://kimi.moonshot.cn" },
  { id: "deepseek", name: "DeepSeek", tags: ["free", "madeInChina"], credentialType: "cookie", supportsImage: false, contextWindow: 64000, homepage: "https://chat.deepseek.com" },
  { id: "qwen", name: "通义千问", tags: ["free", "madeInChina"], credentialType: "cookie", supportsImage: true, contextWindow: 32000, homepage: "https://tongyi.aliyun.com" },
  { id: "wenxin", name: "文心一言", tags: ["free", "madeInChina"], credentialType: "cookie", supportsImage: true, contextWindow: 32000, homepage: "https://yiyan.baidu.com" },
  { id: "chatglm", name: "智谱清言 ChatGLM", tags: ["free", "madeInChina"], credentialType: "cookie", supportsImage: true, contextWindow: 32000, homepage: "https://chatglm.cn" },
  { id: "doubao", name: "豆包", tags: ["free", "madeInChina"], credentialType: "cookie", supportsImage: true, contextWindow: 32000, homepage: "https://www.doubao.com" },
  { id: "spark", name: "讯飞星火", tags: ["free", "madeInChina"], credentialType: "cookie", supportsImage: true, contextWindow: 32000, homepage: "https://xinghuo.xfyun.cn" },
  { id: "hunyuan", name: "腾讯元宝", tags: ["free", "madeInChina"], credentialType: "cookie", supportsImage: true, contextWindow: 32000, homepage: "https://yuanbao.tencent.com" },
  { id: "qihoo-360", name: "360 智脑", tags: ["free", "madeInChina"], credentialType: "cookie", supportsImage: false, contextWindow: 8000, homepage: "https://ai.360.com" },
  { id: "skywork", name: "天工 SkyWork", tags: ["free", "madeInChina"], credentialType: "cookie", supportsImage: false, contextWindow: 8000, homepage: "https://skywork.ai" },
  { id: "moss", name: "MOSS", tags: ["free", "madeInChina"], credentialType: "cookie", supportsImage: false, contextWindow: 4096, homepage: "https://moss.fastnlp.top" },
  { id: "yi", name: "万知 Yi", tags: ["free", "madeInChina"], credentialType: "cookie", supportsImage: false, contextWindow: 16000, homepage: "https://www.wanzhi.com" },
  { id: "baichuan", name: "百川智能", tags: ["free", "madeInChina"], credentialType: "cookie", supportsImage: false, contextWindow: 8000, homepage: "https://www.baichuan-ai.com" },

  // ---- Web (cookie) type: paid ----
  { id: "chatgpt-plus", name: "ChatGPT Plus (GPT-4)", tags: ["paid"], credentialType: "cookie", supportsImage: true, contextWindow: 128000, homepage: "https://chat.openai.com" },
  { id: "claude-pro", name: "Claude Pro", tags: ["paid"], credentialType: "cookie", supportsImage: true, contextWindow: 200000, homepage: "https://claude.ai" },
  { id: "gemini-advanced", name: "Gemini Advanced", tags: ["paid"], credentialType: "cookie", supportsImage: true, contextWindow: 1000000, homepage: "https://gemini.google.com" },
  { id: "perplexity-pro", name: "Perplexity Pro", tags: ["paid"], credentialType: "cookie", supportsImage: false, contextWindow: 32000, homepage: "https://www.perplexity.ai" },
  { id: "copilot-pro", name: "Copilot Pro", tags: ["paid"], credentialType: "cookie", supportsImage: true, contextWindow: 128000, homepage: "https://copilot.microsoft.com" },
  { id: "poe-gpt4", name: "Poe - GPT-4", tags: ["paid"], credentialType: "cookie", supportsImage: false, contextWindow: 32000, homepage: "https://poe.com" },
  { id: "poe-claude-plus", name: "Poe - Claude+", tags: ["paid"], credentialType: "cookie", supportsImage: false, contextWindow: 100000, homepage: "https://poe.com" },
  { id: "grok-premium", name: "Grok (Premium)", tags: ["paid"], credentialType: "cookie", supportsImage: false, contextWindow: 128000, homepage: "https://grok.x.ai" },
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

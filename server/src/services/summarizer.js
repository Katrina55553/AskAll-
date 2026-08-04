const { createBot, getBotMeta } = require("../bots/registry");
const config = require("../config");

/**
 * Heuristic token estimator:
 * - CJK chars ≈ 1 token each (conservative vs 0.5-0.6 documented,
 *   keeps us safely under budget)
 * - other chars ≈ 0.25 token (≈4 chars/token for English)
 */
function estimateTokens(text) {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of String(text)) {
    if (/[㐀-鿿豈-﫿　-〿＀-￯]/.test(ch)) cjk++;
    else other++;
  }
  return Math.ceil(cjk + other * 0.25);
}

function budgetFor(botMeta) {
  return Math.floor((botMeta.contextWindow || 8000) * config.summaryBudgetRatio);
}

function buildSinglePrompt(question, answers) {
  const blocks = answers
    .map((a, i) => `【AI ${i + 1}：${a.botName}】\n${a.answer}`)
    .join("\n\n");
  return (
    `你是一名答案汇总专家。用户的问题是：\n「${question}」\n\n` +
    `以下是多个 AI 对该问题的回答：\n\n${blocks}\n\n` +
    `请综合以上回答，给出一份最佳答案：取各家之长、纠正错误、去重整合，直接输出最终答案本身。`
  );
}

function buildChunkPrompt(question, chunk) {
  const blocks = chunk
    .map((a, i) => `【回答 ${i + 1}：${a.botName}】\n${a.answer}`)
    .join("\n\n");
  return (
    `用户的问题是：\n「${question}」\n\n` +
    `以下是部分 AI 的回答：\n\n${blocks}\n\n` +
    `请提炼这些回答中与问题相关的要点，输出精简的要点列表（保留关键事实与结论，去除重复）。`
  );
}

function buildMergePrompt(question, notes) {
  const blocks = notes.map((n, i) => `【要点组 ${i + 1}】\n${n}`).join("\n\n");
  return (
    `你是一名答案汇总专家。用户的问题是：\n「${question}」\n\n` +
    `以下是从多个 AI 回答中分组提炼出的要点：\n\n${blocks}\n\n` +
    `请综合全部要点，给出一份最终最佳答案：取各家之长、纠正错误、去重整合，直接输出最终答案本身。`
  );
}

/** Split answers into chunks whose total estimated tokens fit the budget. */
function chunkAnswers(question, answers, budget) {
  const overhead = estimateTokens(question) + 400; // prompt template overhead
  const perChunk = Math.max(500, budget - overhead);
  const chunks = [];
  let current = [];
  let currentTokens = 0;
  for (const a of answers) {
    const t = estimateTokens(a.answer);
    if (t > perChunk) {
      // a single overly long answer: split by characters
      if (current.length) {
        chunks.push(current);
        current = [];
        currentTokens = 0;
      }
      const approxCharsPerToken =
        a.answer.length / Math.max(1, estimateTokens(a.answer));
      const pieceLen = Math.floor(perChunk * approxCharsPerToken * 0.95);
      for (let i = 0; i < a.answer.length; i += pieceLen) {
        chunks.push([
          {
            ...a,
            answer: a.answer.slice(i, i + pieceLen),
            botName: `${a.botName}（片段）`,
          },
        ]);
      }
      continue;
    }
    if (currentTokens + t > perChunk && current.length) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(a);
    currentTokens += t;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * Summarize answers with the summarizer bot.
 * @returns {{ summary: string, rounds: number, mode: "single"|"split" }}
 */
async function summarize(question, answers, summarizerBotId, onProgress) {
  const meta = getBotMeta(summarizerBotId);
  if (!meta) throw new Error(`未知汇总 AI: ${summarizerBotId}`);
  const bot = createBot(summarizerBotId);
  const budget = budgetFor(meta);

  const okAnswers = answers.filter((a) => a.status === "done" && a.answer);
  if (!okAnswers.length) throw new Error("没有可用的回答用于汇总");

  const totalTokens =
    estimateTokens(buildSinglePrompt(question, okAnswers));

  if (totalTokens <= budget) {
    if (onProgress) onProgress({ phase: "summary", round: 1, totalRounds: 1 });
    const summary = await bot.ask(buildSinglePrompt(question, okAnswers), []);
    return { summary, rounds: 1, mode: "single" };
  }

  // Split path: round 1 per chunk -> notes, round 2 merge
  const chunks = chunkAnswers(question, okAnswers, budget);
  const totalRounds = 2;
  const notes = [];
  for (let i = 0; i < chunks.length; i++) {
    if (onProgress)
      onProgress({
        phase: "summary",
        round: 1,
        totalRounds,
        chunk: i + 1,
        totalChunks: chunks.length,
      });
    notes.push(await bot.ask(buildChunkPrompt(question, chunks[i]), []));
  }
  if (onProgress) onProgress({ phase: "summary", round: 2, totalRounds });
  const summary = await bot.ask(buildMergePrompt(question, notes), []);
  return { summary, rounds: totalRounds, mode: "split" };
}

module.exports = { summarize, estimateTokens, budgetFor };

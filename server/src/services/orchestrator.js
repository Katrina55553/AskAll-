const { EventEmitter } = require("events");
const { createBot, getBotMeta } = require("../bots/registry");

/**
 * Orchestrates parallel asking across selected bots.
 * Emits events: { type: "status", botId, status } and
 *               { type: "answer", botId, answer, durationMs } /
 *               { type: "error", botId, error, durationMs }
 */
class Orchestrator extends EventEmitter {
  /**
   * @param {string[]} botIds
   * @param {string} question
   * @param {Array<{mime:string, dataBase64:string}>} images
   */
  constructor(botIds, question, images = []) {
    super();
    this.botIds = botIds;
    this.question = question;
    this.images = images;
    this.results = []; // { botId, botName, status, answer, error, durationMs }
  }

  async run() {
    const tasks = this.botIds.map((botId) => this.runOne(botId));
    const settled = await Promise.allSettled(tasks);
    this.results = settled.map((r) => r.value); // runOne never rejects
    return this.results;
  }

  async runOne(botId) {
    const meta = getBotMeta(botId);
    const startedAt = Date.now();
    const emit = (payload) => this.emit("event", payload);
    const base = { botId, botName: meta?.name || botId };
    try {
      if (!meta) throw new Error(`未知 bot: ${botId}`);
      const bot = createBot(botId);
      // Only forward images to bots that support them
      const images = bot.supportsImage ? this.images : [];
      emit({ type: "status", ...base, status: "answering" });
      const answer = await bot.ask(this.question, images, (delta) =>
        emit({ type: "delta", ...base, delta })
      );
      const result = {
        ...base,
        status: "done",
        answer,
        error: null,
        durationMs: Date.now() - startedAt,
      };
      emit({ type: "answer", ...result });
      return result;
    } catch (e) {
      const result = {
        ...base,
        status: "error",
        answer: null,
        error: e.message,
        durationMs: Date.now() - startedAt,
      };
      emit({ type: "error", ...result });
      return result;
    }
  }
}

module.exports = Orchestrator;

const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config");
const db = require("../db");
const { authRequired } = require("../auth");
const { getBotMeta } = require("../bots/registry");
const credentialStore = require("../bots/credentialStore");
const Orchestrator = require("../services/orchestrator");
const { summarize } = require("../services/summarizer");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 9 },
});
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

// In-memory task store: taskId -> { userId, events[], done, listeners[] }
const tasks = new Map();
const TASK_TTL_MS = 30 * 60 * 1000;

function pushEvent(task, event) {
  task.events.push(event);
  for (const fn of task.listeners) fn(event);
}

function cleanupTasks() {
  const now = Date.now();
  for (const [id, t] of tasks) {
    if (now - t.createdAt > TASK_TTL_MS) tasks.delete(id);
  }
}
setInterval(cleanupTasks, 5 * 60 * 1000).unref();

// POST /api/ask — create an ask task (multipart: question, botIds, summarizerBotId, images[])
router.post("/", authRequired, upload.array("images", 9), async (req, res) => {
  const { question, botIds: botIdsRaw, summarizerBotId } = req.body || {};
  if (!question || !String(question).trim()) {
    return res.status(400).json({ error: "question required" });
  }
  let botIds;
  try {
    botIds = JSON.parse(botIdsRaw);
  } catch (e) {
    return res.status(400).json({ error: "botIds must be a JSON array" });
  }
  if (!Array.isArray(botIds) || botIds.length < 1) {
    return res.status(400).json({ error: "select 1-5 bots" });
  }
  if (botIds.length > config.maxSelectedBots) {
    return res
      .status(400)
      .json({ error: `at most ${config.maxSelectedBots} bots` });
  }
  // Validate bots + credentials
  const missing = [];
  for (const id of botIds) {
    const meta = getBotMeta(id);
    if (!meta) return res.status(400).json({ error: `unknown bot: ${id}` });
    if (!credentialStore.status(id).configured) missing.push(meta.name);
  }
  const sumId = summarizerBotId || config.defaultSummarizerBot;
  const sumMeta = getBotMeta(sumId);
  if (!sumMeta) return res.status(400).json({ error: `unknown summarizer: ${sumId}` });
  if (!credentialStore.status(sumId).configured) missing.push(`${sumMeta.name}（汇总）`);
  if (missing.length) {
    return res.status(400).json({ error: `未配置凭据：${missing.join("、")}`, missing });
  }

  // Validate + encode images
  const images = [];
  for (const f of req.files || []) {
    if (!ALLOWED_IMAGE_TYPES.has(f.mimetype)) {
      return res.status(400).json({ error: `不支持的图片类型: ${f.mimetype}` });
    }
    images.push({ mime: f.mimetype, dataBase64: f.buffer.toString("base64") });
  }

  const taskId = crypto.randomUUID();
  const task = {
    userId: req.user.id,
    createdAt: Date.now(),
    events: [],
    listeners: [],
    done: false,
  };
  tasks.set(taskId, task);

  // Run in background
  runTask(task, {
    question: String(question).trim(),
    botIds,
    images,
    summarizerBotId: sumId,
  }).catch((e) => {
    pushEvent(task, { type: "fatal", error: e.message });
    task.done = true;
  });

  res.json({ taskId });
});

async function runTask(task, { question, botIds, images, summarizerBotId }) {
  for (const id of botIds) {
    const meta = getBotMeta(id);
    pushEvent(task, {
      type: "status",
      botId: id,
      botName: meta.name,
      status: "pending",
    });
  }

  const orchestrator = new Orchestrator(botIds, question, images);
  orchestrator.on("event", (e) => pushEvent(task, e));
  const results = await orchestrator.run();

  // Summarize
  let summary = null;
  let splitRounds = 0;
  let summaryError = null;
  try {
    pushEvent(task, { type: "summary-start" });
    const r = await summarize(question, results, summarizerBotId, (p) =>
      pushEvent(task, { type: "summary-progress", ...p })
    );
    summary = r.summary;
    splitRounds = r.rounds;
    pushEvent(task, {
      type: "summary",
      summary,
      rounds: r.rounds,
      mode: r.mode,
    });
  } catch (e) {
    summaryError = e.message;
    pushEvent(task, { type: "summary-error", error: e.message });
  }

  // Persist history
  try {
    const imageMeta = images.map((i) => ({ mime: i.mime }));
    const info = db
      .prepare(
        `INSERT INTO history_records (user_id, question, images, summary, split_rounds)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(task.userId, question, JSON.stringify(imageMeta), summary, splitRounds || 1);
    const recordId = info.lastInsertRowid;
    const insertItem = db.prepare(
      `INSERT INTO answer_items (record_id, bot_id, bot_name, status, answer, error, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of results) {
      insertItem.run(
        recordId,
        r.botId,
        r.botName,
        r.status,
        r.answer,
        r.error,
        r.durationMs
      );
    }
    pushEvent(task, { type: "saved", recordId });
  } catch (e) {
    pushEvent(task, { type: "save-error", error: e.message });
  }

  pushEvent(task, { type: "done", summaryError });
  task.done = true;
}

// GET /api/ask/stream/:taskId — SSE progress stream.
// EventSource cannot send headers, so accept token via query param as well.
router.get("/stream/:taskId", (req, res) => {
  let user = null;
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : req.query.token;
  try {
    user = jwt.verify(String(token || ""), config.jwtSecret);
  } catch (e) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const task = tasks.get(req.params.taskId);
  if (!task || task.userId !== user.id) {
    return res.status(404).json({ error: "task not found" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");

  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  // Replay buffered events, then stream live
  for (const e of task.events) send(e);
  if (task.done) return res.end();

  const listener = (e) => {
    send(e);
    if (e.type === "done" || e.type === "fatal") {
      task.listeners = task.listeners.filter((fn) => fn !== listener);
      res.end();
    }
  };
  task.listeners.push(listener);
  req.on("close", () => {
    task.listeners = task.listeners.filter((fn) => fn !== listener);
  });
});

module.exports = router;

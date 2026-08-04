const express = require("express");
const db = require("../db");
const { authRequired } = require("../auth");

const router = express.Router();
router.use(authRequired);

// List history records for current user, grouped by date on the client
router.get("/", (req, res) => {
  const records = db
    .prepare(
      `SELECT id, question, images, summary, split_rounds, created_at
       FROM history_records WHERE user_id = ? ORDER BY created_at DESC`
    )
    .all(req.user.id);
  res.json({
    records: records.map((r) => ({ ...r, images: JSON.parse(r.images) })),
  });
});

// Record detail with per-bot answers
router.get("/:id", (req, res) => {
  const record = db
    .prepare(
      "SELECT * FROM history_records WHERE id = ? AND user_id = ?"
    )
    .get(req.params.id, req.user.id);
  if (!record) return res.status(404).json({ error: "Not found" });
  const answers = db
    .prepare(
      `SELECT bot_id, bot_name, status, answer, error, duration_ms
       FROM answer_items WHERE record_id = ? ORDER BY id`
    )
    .all(record.id);
  res.json({
    record: { ...record, images: JSON.parse(record.images) },
    answers,
  });
});

router.delete("/:id", (req, res) => {
  const info = db
    .prepare("DELETE FROM history_records WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

module.exports = router;

// ---- helpers used by the ask flow (stage 3) ----
function createRecord(userId, { question, images, summary, splitRounds, answers }) {
  const insertRecord = db.prepare(
    `INSERT INTO history_records (user_id, question, images, summary, split_rounds)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertAnswer = db.prepare(
    `INSERT INTO answer_items (record_id, bot_id, bot_name, status, answer, error, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction(() => {
    const info = insertRecord.run(
      userId,
      question,
      JSON.stringify(images || []),
      summary || null,
      splitRounds || 1
    );
    const recordId = info.lastInsertRowid;
    for (const a of answers || []) {
      insertAnswer.run(
        recordId,
        a.botId,
        a.botName,
        a.status,
        a.answer || null,
        a.error || null,
        a.durationMs || null
      );
    }
    return recordId;
  });
  return tx();
}

module.exports.createRecord = createRecord;

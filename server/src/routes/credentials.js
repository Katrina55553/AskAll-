const express = require("express");
const { authRequired } = require("../auth");
const { getBotMeta, createBot } = require("../bots/registry");
const credentialStore = require("../bots/credentialStore");

const router = express.Router();
router.use(authRequired);

// GET /api/credentials — status for all bots
router.get("/", (req, res) => {
  const { listBots } = require("../bots/registry");
  const result = listBots().map((b) => ({
    id: b.id,
    name: b.name,
    credentialType: b.credentialType,
    ...credentialStore.status(b.id),
  }));
  res.json({ credentials: result });
});

// GET /api/credentials/:botId — status (never returns the secret value)
router.get("/:botId", (req, res) => {
  const meta = getBotMeta(req.params.botId);
  if (!meta) return res.status(404).json({ error: "Unknown bot" });
  res.json({
    id: meta.id,
    credentialType: meta.credentialType,
    ...credentialStore.status(meta.id),
  });
});

// PUT /api/credentials/:botId — save Cookie / API Key
router.put("/:botId", (req, res) => {
  const meta = getBotMeta(req.params.botId);
  if (!meta) return res.status(404).json({ error: "Unknown bot" });
  const { value } = req.body || {};
  if (!value || typeof value !== "string") {
    return res.status(400).json({ error: "value required" });
  }
  credentialStore.set(meta.id, value);
  res.json({ ok: true, ...credentialStore.status(meta.id) });
});

// POST /api/credentials/:botId/validate — live-check the credential
router.post("/:botId/validate", async (req, res) => {
  const meta = getBotMeta(req.params.botId);
  if (!meta) return res.status(404).json({ error: "Unknown bot" });
  if (!credentialStore.status(meta.id).configured) {
    return res.json({ ok: false, error: "未配置凭据" });
  }
  try {
    const bot = createBot(meta.id);
    const ok = await bot.checkAvailability();
    res.json({ ok });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// DELETE /api/credentials/:botId — clear
router.delete("/:botId", (req, res) => {
  const meta = getBotMeta(req.params.botId);
  if (!meta) return res.status(404).json({ error: "Unknown bot" });
  credentialStore.clear(meta.id);
  res.json({ ok: true });
});

module.exports = router;

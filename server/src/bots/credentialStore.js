const fs = require("fs");
const path = require("path");
const config = require("../config");

// Credential store: one JSON file per bot under credentials/ (gitignored)
// Shape: { type: "cookie" | "apikey", value: string, updatedAt: string }

function fileFor(botId) {
  // guard against path traversal
  const safe = String(botId).replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(config.credentialsDir, `${safe}.json`);
}

function get(botId) {
  const file = fileFor(botId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return null;
  }
}

function set(botId, value) {
  fs.mkdirSync(config.credentialsDir, { recursive: true });
  const meta = require("./registry").getBotMeta(botId);
  if (!meta) throw new Error(`Unknown bot: ${botId}`);
  const record = {
    type: meta.credentialType,
    value: String(value || "").trim(),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(fileFor(botId), JSON.stringify(record, null, 2), "utf8");
  return record;
}

function clear(botId) {
  const file = fileFor(botId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function status(botId) {
  const record = get(botId);
  return { configured: !!(record && record.value), updatedAt: record?.updatedAt || null };
}

module.exports = { get, set, clear, status };

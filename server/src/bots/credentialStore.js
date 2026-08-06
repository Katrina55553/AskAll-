const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("../config");

// Credential store: one JSON file per bot under credentials/ (gitignored)
// 加密存储：AES-256-GCM，主密钥来自 config.credentialMasterKey。
// 文件格式：
//   加密后: { v: 2, type, iv, tag, ciphertext, updatedAt }
//   旧明文: { v: 1, type, value, updatedAt }  —— 启动时自动迁移为 v:2

const MASTER_KEY = config.credentialMasterKey;
const ALGO = "aes-256-gcm";

function fileFor(botId) {
  // guard against path traversal
  const safe = String(botId).replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(config.credentialsDir, `${safe}.json`);
}

/** 用 AES-256-GCM 加密明文，返回 { iv, tag, ciphertext }（均 base64）。 */
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, MASTER_KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: enc.toString("base64"),
  };
}

/** 解密 { iv, tag, ciphertext }，返回明文。 */
function decrypt({ iv, tag, ciphertext }) {
  const decipher = crypto.createDecipheriv(
    ALGO,
    MASTER_KEY,
    Buffer.from(iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

/**
 * 读取凭据文件。若检测到 v:1 明文格式，自动迁移为 v:2 加密格式并写回磁盘。
 * @returns {{type:string, value:string, updatedAt:string}|null}
 */
function get(botId) {
  const file = fileFor(botId);
  if (!fs.existsSync(file)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return null;
  }
  // v:2 加密格式
  if (raw.v === 2 && raw.ciphertext) {
    try {
      const value = decrypt(raw);
      return { type: raw.type, value, updatedAt: raw.updatedAt };
    } catch (e) {
      return null;
    }
  }
  // v:1 旧明文格式 —— 自动迁移
  if (raw.value != null) {
    const record = { type: raw.type, value: String(raw.value), updatedAt: raw.updatedAt };
    // 后台静默迁移（不阻塞读流程）
    try {
      writeEncrypted(file, record.type, record.value);
      console.log(`[credentialStore] 已自动迁移 ${botId} 明文凭据为加密格式`);
    } catch (e) {
      console.warn(`[credentialStore] 迁移 ${botId} 失败: ${e.message}`);
    }
    return record;
  }
  return null;
}

/** 写入加密格式的凭据文件。 */
function writeEncrypted(file, type, value) {
  const { iv, tag, ciphertext } = encrypt(value);
  const record = {
    v: 2,
    type,
    iv,
    tag,
    ciphertext,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(record, null, 2), "utf8");
}

function set(botId, value) {
  fs.mkdirSync(config.credentialsDir, { recursive: true });
  const meta = require("./registry").getBotMeta(botId);
  if (!meta) throw new Error(`Unknown bot: ${botId}`);
  const file = fileFor(botId);
  writeEncrypted(file, meta.credentialType, String(value || "").trim());
  return status(botId);
}

function clear(botId) {
  const file = fileFor(botId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function status(botId) {
  const file = fileFor(botId);
  if (!fs.existsSync(file)) return { configured: false, updatedAt: null };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const hasValue =
      (raw.v === 2 && raw.ciphertext) || (raw.v !== 2 && raw.value);
    return { configured: !!hasValue, updatedAt: raw.updatedAt || null };
  } catch (e) {
    return { configured: false, updatedAt: null };
  }
}

/**
 * 扫描所有凭据文件，将 v:1 明文格式迁移为 v:2 加密格式。
 * 在 server 启动时调用一次。
 */
function migrateAll() {
  const dir = config.credentialsDir;
  if (!fs.existsSync(dir)) return { scanned: 0, migrated: 0, failed: 0 };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  let migrated = 0;
  let failed = 0;
  for (const f of files) {
    const file = path.join(dir, f);
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      if (raw.v === 2 || raw.value == null) continue;
      writeEncrypted(file, raw.type, String(raw.value));
      migrated++;
      console.log(`[credentialStore] 已加密迁移: ${f}`);
    } catch (e) {
      failed++;
      console.warn(`[credentialStore] 迁移失败 ${f}: ${e.message}`);
    }
  }
  return { scanned: files.length, migrated, failed };
}

module.exports = { get, set, clear, status, migrateAll };

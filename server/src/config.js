const path = require("path");
const crypto = require("crypto");

const rootDir = path.resolve(__dirname, "..");

// 凭据加密主密钥（AES-256-GCM，32 字节）。
// 优先使用 CRED_MASTER_KEY（hex/base64），未配置时在开发模式下回退到
// 由 jwtSecret 派生的密钥；生产环境必须显式配置 CRED_MASTER_KEY。
function deriveMasterKey() {
  const raw = process.env.CRED_MASTER_KEY;
  if (raw) {
    // 接受 hex（64 字符）或 base64 编码的 32 字节
    let buf;
    if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, "hex");
    else {
      buf = Buffer.from(raw, "base64");
      if (buf.length !== 32) throw new Error("CRED_MASTER_KEY must be 32 bytes (hex or base64)");
    }
    return buf;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("CRED_MASTER_KEY is required in production");
  }
  // 开发回退：由 jwtSecret 派生（仅限本地，不保证安全）
  const jwtSecret = process.env.JWT_SECRET || "askall-dev-secret-change-me";
  return crypto.createHash("sha256").update(`cred-key:${jwtSecret}`).digest();
}

module.exports = {
  port: parseInt(process.env.PORT || "3000", 10),
  jwtSecret: process.env.JWT_SECRET || "askall-dev-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  dbPath: process.env.DB_PATH || path.join(rootDir, "data", "askall.db"),
  credentialsDir:
    process.env.CREDENTIALS_DIR || path.join(rootDir, "src", "credentials"),
  credentialMasterKey: deriveMasterKey(),
  publicDir: process.env.PUBLIC_DIR || path.join(rootDir, "public"),
  // Summary budget = summarizer bot contextWindow * summaryBudgetRatio
  summaryBudgetRatio: parseFloat(process.env.SUMMARY_BUDGET_RATIO || "0.8"),
  maxSelectedBots: parseInt(process.env.MAX_SELECTED_BOTS || "5", 10),
  defaultSummarizerBot: process.env.DEFAULT_SUMMARIZER_BOT || "chatgpt",
};

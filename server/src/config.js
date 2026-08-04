const path = require("path");

const rootDir = path.resolve(__dirname, "..");

module.exports = {
  port: parseInt(process.env.PORT || "3000", 10),
  jwtSecret: process.env.JWT_SECRET || "askall-dev-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  dbPath: process.env.DB_PATH || path.join(rootDir, "data", "askall.db"),
  credentialsDir:
    process.env.CREDENTIALS_DIR || path.join(rootDir, "src", "credentials"),
  publicDir: process.env.PUBLIC_DIR || path.join(rootDir, "public"),
  // Summary budget = summarizer bot contextWindow * summaryBudgetRatio
  summaryBudgetRatio: parseFloat(process.env.SUMMARY_BUDGET_RATIO || "0.8"),
  maxSelectedBots: parseInt(process.env.MAX_SELECTED_BOTS || "5", 10),
  defaultSummarizerBot: process.env.DEFAULT_SUMMARIZER_BOT || "chatgpt",
};

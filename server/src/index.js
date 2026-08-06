require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const config = require("./config");

// 启动时自动将旧明文凭据迁移为 AES-256-GCM 加密格式
try {
  const result = require("./bots/credentialStore").migrateAll();
  if (result.migrated > 0) {
    console.log(
      `[startup] 凭据加密迁移完成: ${result.migrated}/${result.scanned} 已加密, ${result.failed} 失败`
    );
  }
} catch (e) {
  console.warn("[startup] 凭据迁移失败:", e.message);
}

const app = express();

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// ---- API routes (mounted incrementally per stage) ----
try {
  app.use("/api/auth", require("./routes/auth"));
} catch (e) {
  /* stage 1 */
}
try {
  app.use("/api/bots", require("./routes/bots"));
} catch (e) {
  /* stage 1/2 */
}
try {
  app.use("/api/credentials", require("./routes/credentials"));
} catch (e) {
  /* stage 2 */
}
try {
  app.use("/api/ask", require("./routes/ask"));
} catch (e) {
  /* stage 3 */
}
try {
  app.use("/api/history", require("./routes/history"));
} catch (e) {
  /* stage 1 */
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, name: "AskAll", version: "1.0.0" });
});

// ---- Static hosting of built frontend ----
const publicDir = config.publicDir;
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  // SPA fallback (except /api)
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

app.use((err, req, res, next) => {
  console.error("[server error]", err);
  res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
});

app.listen(config.port, () => {
  console.log(`AskAll server listening on http://localhost:${config.port}`);
});

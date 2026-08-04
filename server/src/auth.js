const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const config = require("./config");
const db = require("./db");

function registerUser(username, password) {
  const hash = bcrypt.hashSync(password, 10);
  const stmt = db.prepare(
    "INSERT INTO users (username, password_hash) VALUES (?, ?)"
  );
  const info = stmt.run(username, hash);
  return { id: info.lastInsertRowid, username };
}

function verifyUser(username, password) {
  const user = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username);
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.password_hash)) return null;
  return { id: user.id, username: user.username };
}

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

// Express middleware: protects routes, attaches req.user
function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch (e) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

module.exports = { registerUser, verifyUser, signToken, authRequired };

const express = require("express");
const {
  registerUser,
  verifyUser,
  signToken,
  authRequired,
} = require("../auth");

const router = express.Router();

function validateCredentials(req, res) {
  const { username, password } = req.body || {};
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.trim().length < 2 ||
    password.length < 6
  ) {
    res
      .status(400)
      .json({ error: "Username (>=2 chars) and password (>=6 chars) required" });
    return null;
  }
  return { username: username.trim(), password };
}

router.post("/register", (req, res) => {
  const creds = validateCredentials(req, res);
  if (!creds) return;
  try {
    const user = registerUser(creds.username, creds.password);
    const token = signToken(user);
    res.json({ token, user });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "Username already exists" });
    }
    throw e;
  }
});

router.post("/login", (req, res) => {
  const creds = validateCredentials(req, res);
  if (!creds) return;
  const user = verifyUser(creds.username, creds.password);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  const token = signToken(user);
  res.json({ token, user });
});

router.get("/me", authRequired, (req, res) => {
  res.json({ user: { id: req.user.id, username: req.user.username } });
});

module.exports = router;

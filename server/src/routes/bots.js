const express = require("express");
const { authRequired } = require("../auth");
const { listBots } = require("../bots/registry");

const router = express.Router();
router.use(authRequired);

// GET /api/bots — all bot metadata with tags / credential type / availability
router.get("/", (req, res) => {
  res.json({ bots: listBots() });
});

module.exports = router;

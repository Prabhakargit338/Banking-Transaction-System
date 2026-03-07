const { Router } = require("express");
const jwt = require("jsonwebtoken");
const userModel = require("../models/user.model");
const accountModel = require("../models/account.model");

const router = Router();

router.get("/auth-check", async (req, res) => {
  const token = req.cookies?.token || req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(400).json({ message: "token missing" });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await userModel.findById(decoded.userId).select("+systemUser");
    const systemAccount = await accountModel.findOne({
      user: decoded.userId,
      systemUser: true,
    });

    return res.json({
      decoded,
      user: user ? { _id: user._id, systemUser: user.systemUser } : null,
      systemAccount,
    });
  } catch (err) {
    return res
      .status(400)
      .json({ message: "invalid token", error: err.message });
  }
});

module.exports = router;

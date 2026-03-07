const userModel = require("../models/user.model");
const accountModel = require("../models/account.model");
const jwt = require("jsonwebtoken");

async function authMiddleware(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      message: "Unauthorised access, token is missing",
    });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await userModel.findById(decoded.userId);

    req.user = user;

    return next();
  } catch (err) {
    return res.status(401).json({
      message: "Unauthorised access, token is invalid",
    });
  }
}

async function authSystemUserMiddleware(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      message: "Unauthorised access, token is missing",
    });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await userModel.findById(decoded.userId).select("+systemUser");

    // If user has explicit systemUser flag, allow
    if (user && user.systemUser) {
      req.user = user;
      return next();
    }

    // Otherwise, allow if the user has a system account (account.systemUser === true)
    const systemAccount = await accountModel.findOne({
      user: decoded.userId,
      systemUser: true,
    });
    if (systemAccount) {
      req.user = user;
      return next();
    }

    return res.status(403).json({
      message: "Forbidden access, user is not a system user",
    });
  } catch (err) {
    return res.status(401).json({
      message: "Unauthorised access, token is invalid",
    });
  }
}

module.exports = {
  authMiddleware,
  authSystemUserMiddleware,
};

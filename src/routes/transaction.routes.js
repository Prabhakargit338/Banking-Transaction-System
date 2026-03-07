const { Router } = require("express");

const authMiddleware = require("../middlewares/auth.middleware");
const transactionController = require("../controllers/transaction.controller");

const transactionRoutes = Router();

/**
 * POST  /api/transactions/
 * create a new transaction
 */

transactionRoutes.post(
  "/",
  authMiddleware.authMiddleware,
  transactionController.createTransactionController,
);

/**
 * POST /api/transactions/system/initial-funds
 * create initial funds transaction from system user
 */
transactionRoutes.post(
  "/system/initial-funds",
  authMiddleware.authSystemUserMiddleware,
  transactionController.createIntialFundsTransactionController,
);

module.exports = transactionRoutes;

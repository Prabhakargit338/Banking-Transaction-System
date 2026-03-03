const {Router} = require('express')

const authMiddleware = require('../middlewares/auth.middleware')
const transactionController = require('../controllers/transaction.controller')

const transactionRoutes = Router();

/**
 * POST  /api/transactions/
 * create a new transaction
 */

transactionRoutes.post("/", authMiddleware.authMiddleware, transactionController.createTransactionController)

module.exports = transactionRoutes
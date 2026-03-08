const transactionModel = require("../models/transaction.model");
const ledgerModel = require("../models/ledger.model");
const accountModel = require("../models/account.model");
const emailService = require("../services/email.service");
const mongoose = require("mongoose");

/**
 * create a new transaction
 * THE 10 STEP TRANSFER FLOW
 * 1. Validate request
 * 2. Validate idempotency key
 * 3. Check account status
 * 4. Derive sender balance from ledger
 * 5. Create transaction with PENDING status
 * 6. Create DEBIT ledger entry for sender
 * 7. Create CREDIT ledger entry for receiver
 * 8. Mark transaction as COMPLETED
 * 9. Commit all changes to database
 * 10.Send email notification
 */

async function createTransactionController(req, res) {
  const { fromAccount, toAccount, amount, idempotencyKey } = req.body;

  /**
   * 1. Validate request
   */

  if (!fromAccount || !toAccount || !amount || !idempotencyKey) {
    return res.status(400).json({
      message: "fromAccount, toAccount, amount and idempotencyKey are required",
    });
  }

  const fromUserAccount = await accountModel.findById(fromAccount);

  const toUserAccount = await accountModel.findById(toAccount);

  if (!fromUserAccount || !toUserAccount) {
    return res.status(400).json({
      message: "fromAccount or toAccount not found",
    });
  }

  // 2. Validate idempotency key
  const PENDING_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
  const existing = await transactionModel.findOne({ idempotencyKey });
  if (existing) {
    if (existing.status === "COMPLETED")
      return res
        .status(200)
        .json({
          message: "Transaction already processed",
          transaction: existing,
        });
    if (existing.status === "PENDING") {
      const age = Date.now() - new Date(existing.createdAt).getTime();
      if (age > PENDING_THRESHOLD_MS) {
        // mark stale pending as failed so we can retry
        await transactionModel.updateOne(
          { _id: existing._id },
          { $set: { status: "FAILED" } },
        );
      } else {
        return res
          .status(200)
          .json({ message: "transaction is in pending, try again after sometime" });
      }
    }
    if (existing.status === "FAILED" || existing.status === "REVERSED")
      return res
        .status(500)
        .json({ message: "Transaction processing failed, please try again" });
  }

  /**
   * 3. Check account status
   */
  if (
    fromUserAccount.status !== "ACTIVE" ||
    toUserAccount.status !== "ACTIVE"
  ) {
    return res
      .status(400)
      .json({
        message:
          "fromAccount or toAccount must be ACTIVE to process the transaction",
      });
  }


  console.log("fromAccount body:", fromAccount);
  console.log("fromUserAccount:", fromUserAccount._id);

  // 4. Derive sender balance from ledger
  const balance = await fromUserAccount.getBalance();
  if (balance < amount)
    return res
      .status(400)
      .json({
        message: `Insufficient balance. Current balance is ${balance}. Requested amount is ${amount}`,
      });

  // 5. Create transaction OUTSIDE the session to make PENDING state visible immediately
  let transaction;
  try {
    transaction = new transactionModel({
      fromAccount,
      toAccount,
      amount: Number(amount),
      idempotencyKey,
      status: "PENDING",
    });
    await transaction.save();
  } catch (err) {
    if (err.code === 11000) {
      const existingAfter = await transactionModel.findOne({
        idempotencyKey,
      });
      if (existingAfter) {
        if (existingAfter.status === "COMPLETED") {
          return res
            .status(200)
            .json({
              message: "Transaction already processed",
              transaction: existingAfter,
            });
        }
        if (existingAfter.status === "PENDING") {
          return res
            .status(200)
            .json({ message: "transaction is in pending, try again after sometime" });
        }
        return res
          .status(500)
          .json({
            message: "Transaction processing failed, please try again",
          });
      }
      console.error("Failed to create transaction - existing null", err);
      return res
        .status(500)
        .json({ message: "Failed to create transaction" });
    }
    console.error("Failed to create transaction document", err);
    return res.status(500).json({ message: "Failed to create transaction" });
  }

  // 6-9. Create ledger entries inside a transaction
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    await ledgerModel.create(
      [{
        account: fromUserAccount._id,
        type: "DEBIT",
        amount,
        transaction: transaction._id,
      }],
      { session },
    );

    // DELAY 15 seconds after amount is debited to get credited
    await new Promise(resolve => setTimeout(resolve, 15000));

    await ledgerModel.create(
      [{
        account: toUserAccount._id,
        type: "CREDIT",
        amount,
        transaction: transaction._id,
      }],
      { session },
    );

    transaction.status = "COMPLETED";
    await transactionModel.updateOne(
      { _id: transaction._id },
      { $set: { status: "COMPLETED" } },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    try {
      await emailService.sendTransactionEmail(
        req.user.email,
        req.user.name,
        amount,
        toUserAccount._id,
      );
    } catch (error) {
      res.status(400).json({
        message: "Transaction is Pending due to some issue , please retry after sometime."
      })
    }

    return res
      .status(201)
      .json({ message: "Transaction processed successfully", transaction });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(err);
    await transactionModel.updateOne(
      { _id: transaction._id },
      { $set: { status: "FAILED" } }
    );
    return res.status(500).json({ message: "Failed to process transaction" });
  }
}

async function createIntialFundsTransactionController(req, res) {
  const { toAccount, amount, idempotencyKey } = req.body;

  if (!toAccount || !amount || !idempotencyKey) {
    return res.status(400).json({
      message: "toAccount, amount and idempotencyKey are required",
    });
  }

  const toUserAccount = await accountModel.findOne({
    _id: toAccount.trim(),
  });
  if (!toUserAccount) {
    return res.status(400).json({
      message: "toAccount not found",
    });
  }
  const fromUserAccount = await accountModel.findOne({
    systemUser: true,
    user: req.user._id,
  });
  if (!fromUserAccount) {
    return res.status(400).json({
      message: "System account for the user not found",
    });
  }
  // idempotency check with stale pending handling
  const PENDING_THRESHOLD_MS = 2 * 60 * 1000;
  const existing = await transactionModel.findOne({ idempotencyKey });
  if (existing) {
    if (existing.status === "COMPLETED")
      return res
        .status(200)
        .json({
          message: "Transaction already processed",
          transaction: existing,
        });
    if (existing.status === "PENDING") {
      const age = Date.now() - new Date(existing.createdAt).getTime();
      if (age > PENDING_THRESHOLD_MS) {
        await transactionModel.updateOne(
          { _id: existing._id },
          { $set: { status: "FAILED" } },
        );
      } else {
        return res
          .status(200)
          .json({ message: "transaction is in pending, try again after sometime" });
      }
    }
  }

  let transaction;
  try {
    transaction = new transactionModel({
      fromAccount: fromUserAccount._id,
      toAccount: toUserAccount._id,
      amount,
      idempotencyKey,
      status: "PENDING"
    });
    await transaction.save();
  }
  catch (err) {
    if (err.code === 11000) {
      const existingAfter = await transactionModel.findOne({
        idempotencyKey,
      });
      if (existingAfter) {
        if (existingAfter.status === "COMPLETED")
          return res
            .status(200)
            .json({
              message: "Transaction already processed",
              transaction: existingAfter,
            });
        if (existingAfter.status === "PENDING")
          return res
            .status(200)
            .json({ message: "transaction is in pending, try again after sometime" });
        return res
          .status(500)
          .json({
            message: "Transaction processing failed, please try again",
          });
      }
      return res
        .status(500)
        .json({ message: "Failed to create transaction" });
    }
    throw err;
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    await ledgerModel.create(
      [{
        account: fromUserAccount._id,
        type: "DEBIT",
        amount,
        transaction: transaction._id,
      }],
      { session },
    );

    // DELAY 15 seconds after amount is debited to get credited
    await new Promise(resolve => setTimeout(resolve, 15000));

    await ledgerModel.create(
      [{
        account: toUserAccount._id,
        type: "CREDIT",
        amount,
        transaction: transaction._id,
      }],
      { session },
    );

    transaction.status = "COMPLETED";
    await transactionModel.updateOne(
      { _id: transaction._id },
      { $set: { status: "COMPLETED" } },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return res
      .status(201)
      .json({
        message: "Initial funds transaction processed successfully",
        transaction,
      });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(err);
    await transactionModel.updateOne(
      { _id: transaction._id },
      { $set: { status: "FAILED" } }
    );
    return res
      .status(500)
      .json({
        message: "Failed to process initial funds transaction",
        error: err.message,
      });
  }
}

module.exports = {
  createTransactionController,
  createIntialFundsTransactionController,
};

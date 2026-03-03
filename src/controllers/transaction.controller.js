const transactionModel = require("../models/transaction.model");
const ledgerModel = require("../models/ledger.model");
const accountModel = require("../models/account.model");
const emailService = require('../services/email.service');
const mongoose = require("mongoose")

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

async function createTransactionController(req,res){
  const {fromAccount, toAccount, amount, idempotencyKey} = req.body

/**
 * 1. Validate request
 */
 
  if(!fromAccount || !toAccount || !amount || !idempotencyKey){
    return res.status(400).json({
      message: "fromAccount, toAccount, amount and idempotencyKey are required"
    })
  }

  const fromUserAccount = await accountModel.findOne({
    _id: fromAccount,
  })

  const toUserAccount = await accountModel.findOne({
    _id: toAccount,
  })
 
  if(!fromUserAccount || !toUserAccount){
    return res.status(400).json({
      message: "fromAccount or toAccount not found"
    })
  }

  // 2. Validate idempotency key
  const isTransactionAlreadyExists = await transactionModel.findOne({
    idempotencyKey: idempotencyKey
  })

  if(isTransactionAlreadyExists){
    if(isTransactionAlreadyExists.status === "COMPLETED"){
      return res.status(200).json({
        message: "Transaction already processed",
        transaction: isTransactionAlreadyExists
      })
    }

    if(isTransactionAlreadyExists.status === "PENDING"){
      return res.status(200).json({
        message: "Transaction is still being processed",
      })
    }

    if(isTransactionAlreadyExists.status === "FAILED"){
      return res.status(500).json({
        message: "Transaction processing failed, please try again",
      })
    }

    if(isTransactionAlreadyExists.status === "REVERSED"){
      return res.status(500).json({
        message: "Transaction was reversed, please try again",
      })
    }

    /**
     * 3. Check account status
     */
    if(fromUserAccount.status !== "ACTIVE" || toUserAccount.status !== "ACTIVE"){
      return res.status(400).json({
        message: "fromAccount or toAccount must be ACTIVE to process the transaction"
      })
    } 

    // 4. Derive sender balance from ledger
    const balance = await fromUserAccount.getBalance()

    if(balance < amount){
      return res.status(400).json({
        message: `Insufficient balance. Current balance is ${balance}.Requested amount is ${amount}`
      })
    }

    /*
      * 5. Create transaction with PENDING status
     */

    const session = await mongoose.startSession()
    session.startTransaction()

    const transaction = await transactionModel.create([{
      fromAccount,
      toAccount,
      amount,
      idempotencyKey,
      status: "PENDING"
    }], {session})

    const debitLedgerEntry = await ledgerModel.create([{
      account: fromAccount,
      type: "DEBIT",
      amount,
      transaction: transaction[0]._id
    }], {session})

    const creditLedgerEntry = await ledgerModel.create([{
      account: toAccount,
      type: "CREDIT",
      amount,
      transaction: transaction[0]._id
    }], {session})

    transaction[0].status = "COMPLETED"
    await transaction[0].save({session})

    await session.commitTransaction()
    session.endSession()


    /**
     * 10.Send email notification
     */

    await emailService.sendTransactionEmail(req.user.email, req.user.name, amount, toUserAccount._id)

    res.status(201).json({
      message: "Transaction processed successfully",
      transaction: transaction[0]
    })
  }
    
}
     
module.exports = {
  createTransactionController
}





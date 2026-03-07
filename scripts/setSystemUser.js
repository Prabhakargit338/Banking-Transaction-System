require("dotenv").config();
const connectToDb = require("../src/config/db");
const mongoose = require("mongoose");
const User = require("../src/models/user.model");
const Account = require("../src/models/account.model");

async function main() {
  const userId = process.argv[2];
  const createAccount = process.argv.includes("--create-account");

  if (!userId) {
    console.error(
      "Usage: node scripts/setSystemUser.js <userId> [--create-account]",
    );
    process.exit(1);
  }

  connectToDb();

  // wait for connection
  mongoose.connection.once("open", async () => {
    try {
      const user = await User.findByIdAndUpdate(
        userId,
        { systemUser: true },
        { new: true, useFindAndModify: false },
      );
      if (!user) {
        console.error("User not found:", userId);
        process.exit(1);
      }
      console.log("Updated user.systemUser = true for", userId);

      if (createAccount) {
        const existing = await Account.findOne({
          user: userId,
          systemUser: true,
        });
        if (existing) {
          console.log("System account already exists:", existing._id);
        } else {
          const acc = await Account.create({
            user: userId,
            currency: "INR",
            systemUser: true,
            status: "ACTIVE",
          });
          console.log("Created system account:", acc._id);
        }
      }

      process.exit(0);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  });
}

main();

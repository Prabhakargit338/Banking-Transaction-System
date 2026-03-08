const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");

/*Routes Required*/
const authRouter = require("./routes/auth.routes");
const accountRouter = require("./routes/account.routes");
const transactionRoutes = require("./routes/transaction.routes");
const debugRoutes = require("./routes/debug.routes");

const app = express();

app.use(cors());
app.use(express.json());
app.use(cookieParser());

/*Use routes*/



app.use("/api/auth", authRouter);
app.use("/api/accounts", accountRouter);
app.use("/api/transactions", transactionRoutes);
app.use("/api/debug", debugRoutes);

module.exports = app;

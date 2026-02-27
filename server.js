require('dotenv').config()

const app = require('./src/app')
const connectToDb = require('./src/config/db')

connectToDb()


app.listen(3000, () => {
  console.log("App is running on port 3000")
})
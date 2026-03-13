require('dotenv').config()

const app = require('./src/app')
const connectToDb = require('./src/config/db')

connectToDb()

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`App is running on port ${PORT}`)
})
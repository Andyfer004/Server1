const { OpenAI } = require("openai");
const dotenv = require("dotenv");

dotenv.config();

console.log("API KEY:", process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEY.length);

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

module.exports = openai;

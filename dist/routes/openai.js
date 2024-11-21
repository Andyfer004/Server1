"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// api/routes/openai.ts
const openai_1 = require("openai");
const openai = new openai_1.OpenAI({
    apiKey: "sk-proj-U754wpxlEd3LSV4JGFlkT3BlbkFJ7LAn8IfGHiXs5g1l7LhJ" //process.env.OPENAI_API_KEY
});
exports.default = openai;

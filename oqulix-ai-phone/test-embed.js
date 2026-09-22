const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function testEmbed() {
  try {
    const res = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: 'hello',
    });
    console.log("Success with gemini-embedding-2:", res.embeddings[0].values.length);
  } catch(e) {
    console.error("Error:", e.message);
  }
}
testEmbed();

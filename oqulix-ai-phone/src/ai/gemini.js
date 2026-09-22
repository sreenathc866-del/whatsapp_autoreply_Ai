require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

/**
 * Generates an answer using the Gemini API, grounded in the provided Oqulix knowledge context.
 * @param {string} question - The user's question.
 * @param {string} context - The relevant knowledge retrieved via RAG.
 * @param {Array} conversationHistory - Previous conversation context (optional).
 * @returns {Promise<string>} - Gemini's generated answer.
 */
async function generateOqulixAnswer(question, context, conversationHistory = []) {
  try {
    const systemInstruction = `You are the official AI voice assistant for Oqulix Technology, speaking directly to a customer on a phone call.
Your answers MUST BE EXTREMELY SHORT, natural, and conversational. Limit your responses to 1-2 brief sentences maximum. 
NEVER use bullet points, markdown formatting, or long lists. Speak as a human would on a brief phone call.
You must use the provided "OQULIX KNOWLEDGE CONTEXT" to answer the customer's question.
NEVER invent company information, services, prices, or facts that are not present in the context.
If the context does not contain the answer, you must clearly state that you cannot confirm it and offer human assistance.

OQULIX KNOWLEDGE CONTEXT:
${context ? context : "No relevant information found in the knowledge base."}
`;

    // Construct history messages for the genai SDK.
    // The format expected by generateContent with history is a list of contents.
    const contents = [];
    
    // Add history if any
    for (const msg of conversationHistory) {
      contents.push({ role: msg.role === 'user' ? 'user' : 'model', parts: [{ text: msg.text }] });
    }
    
    // Add current question
    contents.push({ role: 'user', parts: [{ text: question }] });

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.2, // Low temperature to reduce hallucination
      }
    });

    return response.text;
  } catch (error) {
    console.error('Error generating answer with Gemini:', error);
    return "I'm sorry, I'm experiencing some technical difficulties right now. Can I help you with anything else or transfer you to a human agent?";
  }
}

module.exports = {
  generateOqulixAnswer
};

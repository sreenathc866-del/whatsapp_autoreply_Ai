require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

/**
 * Handles the WhatsApp AI conversation and extracts lead qualification data using structured output.
 * @param {string} incomingMessage - The customer's latest WhatsApp message.
 * @param {string} context - RAG knowledge base context.
 * @param {Array} conversationHistory - Array of previous { role, text } objects.
 * @returns {Promise<Object>} - Contains { response_text, lead_data }
 */
async function generateWhatsAppResponse(incomingMessage, context, conversationHistory = []) {
  try {
    const systemInstruction = `You are the official AI WhatsApp assistant for Oqulix Technology.
Your job is to qualify leads coming from Facebook/Instagram ads while providing excellent customer service.
Respond naturally, concisely, and NEVER pretend to be a human. Do not ask unnecessary questions or repeat questions already answered.

OQULIX KNOWLEDGE CONTEXT:
${context ? context : "No relevant information found in the knowledge base."}

IMPORTANT: You must always output valid JSON in the exact structure defined by the schema.
Extract the customer's intent, requirements, and lead score (0-100) based on the entire conversation.

LEAD SCORING GUIDELINES:
- HOT (80-100): Very urgent, short timeline, ready to start, explicit request for sales, high buying intent.
- WARM (40-79): Genuine requirement, comparing options, medium timeline.
- COLD (0-39): General questions, no immediate timeline, low intent.
- UNQUALIFIED: Just said hi, no details yet.

URGENCY GUIDELINES:
- HIGH: Mentioned "urgent", "immediately", "today", "this week".
- MEDIUM: Mentioned "this month", "soon".
- LOW: Exploring, no rush.
`;

    // Construct history messages
    const contents = [];
    for (const msg of conversationHistory) {
      contents.push({ role: msg.role === 'user' ? 'user' : 'model', parts: [{ text: msg.text }] });
    }
    contents.push({ role: 'user', parts: [{ text: incomingMessage }] });

    // We define the JSON schema we want Gemini to return
    const responseSchema = {
      type: "OBJECT",
      properties: {
        response_text: {
          type: "STRING",
          description: "The natural conversational reply to send to the customer on WhatsApp."
        },
        lead_data: {
          type: "OBJECT",
          properties: {
            customer_name: { type: "STRING", nullable: true },
            business_type: { type: "STRING", nullable: true },
            service_required: { type: "STRING", nullable: true },
            requirements: { type: "STRING", nullable: true },
            budget: { type: "STRING", nullable: true },
            timeline: { type: "STRING", nullable: true },
            urgency: { type: "STRING", enum: ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] },
            lead_score: { type: "INTEGER" },
            lead_status: { type: "STRING", enum: ["HOT", "WARM", "COLD", "UNQUALIFIED"] },
            human_needed: { type: "BOOLEAN", description: "True if the customer explicitly asks for a human or is a HOT lead requiring immediate attention." }
          },
          required: ["urgency", "lead_score", "lead_status", "human_needed"]
        }
      },
      required: ["response_text", "lead_data"]
    };

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.2, // Low temperature for consistent JSON extraction
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      }
    });

    // Parse the JSON output
    const jsonOutput = JSON.parse(response.text);
    return jsonOutput;

  } catch (error) {
    console.error('Error generating WhatsApp answer with Gemini:', error);
    return {
      response_text: "I'm sorry, I'm experiencing some technical difficulties right now. Can I have a team member contact you?",
      lead_data: {
        human_needed: true
      }
    };
  }
}

module.exports = {
  generateWhatsAppResponse
};

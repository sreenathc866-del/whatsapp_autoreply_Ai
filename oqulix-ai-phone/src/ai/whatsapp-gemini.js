require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

/**
 * Handles the WhatsApp AI conversation and extracts lead qualification data using structured output.
 * @param {string} incomingMessage - The customer's latest WhatsApp message.
 * @param {string} context - RAG knowledge base context.
 * @param {Array} conversationHistory - Array of previous { role, text } objects.
 * @returns {Promise<Object>} - Contains { response_text, lead_data }
 */
async function generateWhatsAppResponse(incomingMessage, context, conversationHistory = [], audioData = null) {
  try {
    const systemInstruction = `You are a friendly, human-like sales representative for Oqulix Technology chatting on WhatsApp.
Your job is to qualify leads coming from Facebook/Instagram ads while providing excellent, warm customer service.
Respond naturally, casually, and concisely, as if you are a real human texting a customer. Do not sound like a robot. Do not ask unnecessary questions or repeat questions already answered. Use emojis naturally but sparingly.

CRITICAL: DO NOT repeat greetings (e.g., "Hello", "Hi there") in every message. Only say "Hello" if it is the very first message. Otherwise, continue the conversation naturally.

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

    // Construct history messages ensuring it alternates correctly and starts with user
    const contents = [];
    
    // Filter out any starting 'model' messages which Gemini API rejects
    let historyToUse = [...conversationHistory];
    while (historyToUse.length > 0 && historyToUse[0].role !== 'user') {
      historyToUse.shift();
    }

    for (const msg of historyToUse) {
      contents.push({ role: msg.role === 'user' ? 'user' : 'model', parts: [{ text: msg.text }] });
    }
    let finalParts = [];
    if (audioData) {
      finalParts.push({ text: "User sent a voice message. Please listen to this audio and reply to them." });
      finalParts.push({
        inlineData: {
          mimeType: audioData.mimeType,
          data: audioData.base64
        }
      });
    } else {
      finalParts.push({ text: incomingMessage });
    }
    contents.push({ role: 'user', parts: finalParts });

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

    let retries = 5;
    while (retries > 0) {
      try {
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
        console.error(`[WhatsApp] Gemini API Error (Retries left: ${retries - 1}):`, error.message || error);
        retries--;
        if (retries === 0) {
          console.error('[WhatsApp] Gemini API failed after all retries. Silently ignoring to prevent AI-like fallback messages.');
          return {
            response_text: "", // Empty string so we don't send a robotic fallback
            lead_data: {}
          };
        }
        // Wait 12 seconds before retrying to ensure we pass Google's 1-minute rate limit window
        await new Promise(resolve => setTimeout(resolve, 12000));
      }
    }
  } catch (outerError) {
    console.error('[WhatsApp] Unhandled error in generateWhatsAppResponse:', outerError.message || outerError);
    return { response_text: "", lead_data: {} };
  }
}

module.exports = {
  generateWhatsAppResponse
};

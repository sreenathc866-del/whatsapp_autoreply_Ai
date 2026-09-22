require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const { createClient } = require('@supabase/supabase-js');

const fs = require('fs');
const path = require('path');

// Initialize Gemini and Supabase clients
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'gemini-embedding-2';

// Cache local knowledge file
let localKnowledgeCache = null;
function getLocalKnowledge() {
  if (!localKnowledgeCache) {
    const knowledgePath = path.join(__dirname, '../../data/oqulix/knowledge.md');
    if (fs.existsSync(knowledgePath)) {
      localKnowledgeCache = fs.readFileSync(knowledgePath, 'utf8');
    }
  }
  return localKnowledgeCache || '';
}

/**
 * Searches the Supabase knowledge base for relevant Oqulix information.
 * Falls back to local data/oqulix/knowledge.md if Supabase fails or is unconfigured.
 * @param {string} question - The user's question
 * @returns {Promise<string>} - The concatenated relevant context
 */
async function searchOqulixKnowledge(question) {
  try {
    // 1. Create embedding for the question
    const response = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: question,
    });
    const queryEmbedding = response.embeddings[0].values;

    // 2. Perform vector similarity search in Supabase
    const { data: documents, error } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.30, // Adjust threshold as needed
      match_count: 3         // Retrieve top 3 most relevant chunks
    });

    if (!error && documents && documents.length > 0) {
      return documents.map(doc => doc.content).join('\n\n---\n\n');
    }
  } catch (err) {
    console.error('Vector search error, falling back to local knowledge:', err.message);
  }

  // Fallback to local knowledge base file
  console.log('[RAG] Using local knowledge.md context fallback.');
  return getLocalKnowledge();
}

module.exports = {
  searchOqulixKnowledge
};

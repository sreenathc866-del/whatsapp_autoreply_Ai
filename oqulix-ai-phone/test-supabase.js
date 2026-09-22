const { GoogleGenAI } = require('@google/genai');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testSupabase() {
  try {
    const res = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: 'hello',
    });
    
    // Now let's try querying Supabase
    const { data: documents, error } = await supabase.rpc('match_documents', {
      query_embedding: res.embeddings[0].values,
      match_threshold: 0.30,
      match_count: 3
    });
    console.log("Supabase error:", error?.message);
    console.log("Docs found:", documents?.length);
  } catch(e) {
    console.error("Error:", e.message);
  }
}
testSupabase();

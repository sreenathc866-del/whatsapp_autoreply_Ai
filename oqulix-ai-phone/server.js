require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { URL } = require('url');
const { transcribeAudio } = require('./src/services/elevenlabs-stt');
const { processUserAudio, processUserText } = require('./src/services/voice-pipeline');
const { processIncomingWhatsApp } = require('./src/services/whatsapp-handler');
const { createClient } = require('@supabase/supabase-js');

// Supabase client for Admin API
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
const server = http.createServer(app);

// WebSocket server for browser voice endpoints
const wssBrowser = new WebSocket.Server({ noServer: true });

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Plivo sends webhook data as URL encoded form data
app.use(express.static('public'));
const upload = multer({ storage: multer.memoryStorage() });

// ============================================
// Browser WebSocket Connection Logic (/ws/voice)
// ============================================
wssBrowser.on('connection', (ws) => {
  console.log('New Browser WebSocket connection established.');
  
  // Session object for this browser connection
  const session = { conversationHistory: [] };

  ws.on('message', async (message) => {
    try {
      // Check if message is a JSON text message from the web client
      let textPayload = null;
      try {
        const msgString = message.toString();
        if (msgString.startsWith('{') && msgString.endsWith('}')) {
          const parsed = JSON.parse(msgString);
          if (parsed.type === 'text' && parsed.text) {
            textPayload = parsed.text;
          }
        }
      } catch (e) {}

      if (textPayload) {
        console.log(`\n=== Browser WebSocket: Received text ("${textPayload}") ===`);
        const audioBuffer = await processUserText(
          textPayload,
          session,
          (answer) => {
            ws.send(JSON.stringify({ type: 'answer', text: answer }));
          }
        );

        if (audioBuffer) {
          ws.send(audioBuffer);
          console.log(`[Browser WS] Audio answer sent to client.`);
        }
        console.log(`=====================================================\n`);
        return;
      }

      console.log(`\n=== Browser WebSocket: Received audio (${message.length} bytes) ===`);
      
      const audioBuffer = await processUserAudio(
        message, 
        'audio.webm',
        session,
        (transcription) => {
          ws.send(JSON.stringify({ type: 'transcription', text: transcription }));
        },
        (answer) => {
          ws.send(JSON.stringify({ type: 'answer', text: answer }));
        }
      );

      if (audioBuffer) {
        ws.send(audioBuffer);
        console.log(`[Browser WS] Audio sent to client.`);
      }
      
      console.log(`=====================================================\n`);
    } catch (error) {
      console.error('WebSocket Error processing message:', error);
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  });

  ws.on('close', () => {
    console.log('Browser WebSocket connection closed.');
  });
});


// ============================================
// WhatsApp Webhook Endpoints
// ============================================

// 1. Webhook Verification (Meta WhatsApp Cloud API requirement)
app.get('/api/whatsapp/webhook', (req, res) => {
  const verify_token = process.env.WHATSAPP_VERIFY_TOKEN || 'oqulix_secure_token';

  let mode = req.query["hub.mode"];
  let token = req.query["hub.verify_token"];
  let challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === verify_token) {
      console.log("[WhatsApp] Webhook verified!");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.status(400).send("Invalid verification request");
  }
});

// 2. Receive Incoming WhatsApp Messages
app.post('/api/whatsapp/webhook', async (req, res) => {
  try {
    const body = req.body;

    // Check if it's a WhatsApp API event
    if (body.object) {
      if (
        body.entry &&
        body.entry[0].changes &&
        body.entry[0].changes[0] &&
        body.entry[0].changes[0].value.messages &&
        body.entry[0].changes[0].value.messages[0]
      ) {
        let phoneNumber = body.entry[0].changes[0].value.contacts[0].wa_id;
        let customerName = body.entry[0].changes[0].value.contacts[0].profile.name;
        let msg = body.entry[0].changes[0].value.messages[0];
        
        if (msg.type === "text") {
          let incomingMessage = msg.text.body;
          let messageId = msg.id;
          // Process message asynchronously so we can return 200 OK immediately
          processIncomingWhatsApp(phoneNumber, customerName, incomingMessage, messageId).catch(err => {
             console.error("[WhatsApp] Error processing message:", err);
          });
        }
      }
      res.sendStatus(200);
    } else {
      res.sendStatus(404);
    }
  } catch (error) {
    console.error("[WhatsApp] Webhook error:", error);
    res.sendStatus(500);
  }
});

// ============================================
// Admin Dashboard API
// ============================================
app.get('/api/admin/leads', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .order('updated_at', { ascending: false });
      
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/leads/:id/conversations', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('lead_id', id)
      .order('timestamp', { ascending: true });
      
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/leads/:id/takeover', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('leads')
      .update({ human_needed: true })
      .eq('id', id);
      
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// WebSocket Routing
// ============================================
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

  if (pathname === '/ws/voice') {
    wssBrowser.handleUpgrade(request, socket, head, (ws) => {
      wssBrowser.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});


app.post('/api/test-ai', async (req, res) => {
  const { question } = req.body;

  if (!question) {
    return res.status(400).json({ error: "Missing 'question' in request body." });
  }

  try {
    console.log(`\n--- New Request ---`);
    console.log(`Question: "${question}"`);

    // 1. Search Oqulix Knowledge base
    console.log(`Searching knowledge base...`);
    const context = await searchOqulixKnowledge(question);
    
    if (context) {
      console.log(`Context found (length: ${context.length} chars).`);
    } else {
      console.log(`No relevant context found.`);
    }

    // 2. Generate answer using Gemini
    console.log(`Generating answer with Gemini...`);
    const answer = await generateOqulixAnswer(question, context);

    console.log(`Answer: "${answer}"`);
    console.log(`-------------------\n`);

    res.json({ answer });
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post('/api/test-stt', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No audio file provided. Please upload an 'audio' file." });
  }

  try {
    console.log(`\n--- New STT Request ---`);
    console.log(`File: ${req.file.originalname} (${req.file.size} bytes)`);

    // 1. Transcribe Audio
    console.log(`Transcribing audio with ElevenLabs...`);
    const sttResult = await transcribeAudio(req.file.buffer, req.file.originalname);
    const transcription = sttResult.text;
    console.log(`Transcription: "${transcription}"`);

    if (!transcription || transcription.trim() === '') {
      return res.status(400).json({ error: "Transcription resulted in empty text." });
    }

    // 2. Search RAG
    console.log(`Searching knowledge base...`);
    const context = await searchOqulixKnowledge(transcription);

    // 3. Generate Answer
    console.log(`Generating answer with Gemini...`);
    const answer = await generateOqulixAnswer(transcription, context);

    console.log(`Answer: "${answer}"`);
    console.log(`-----------------------\n`);

    res.json({
      transcription,
      answer
    });
  } catch (error) {
    console.error("Error processing STT request:", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

app.post('/api/test-tts', async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: "Missing 'text' in request body." });
  }

  try {
    console.log(`\n--- New TTS Request ---`);
    console.log(`Generating audio for: "${text}"`);
    const audioBuffer = await textToSpeech(text);
    
    // Save locally for testing
    const filePath = path.join(__dirname, 'temp-tts.mp3');
    fs.writeFileSync(filePath, audioBuffer);
    console.log(`Audio saved to ${filePath}`);
    console.log(`-----------------------\n`);

    res.json({ success: true, file: filePath });
  } catch (error) {
    console.error("Error processing TTS request:", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

app.post('/api/test-voice', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No audio file provided. Please upload an 'audio' file." });
  }

  try {
    console.log(`\n=== New Complete Voice Pipeline Request ===`);
    console.log(`File: ${req.file.originalname} (${req.file.size} bytes)`);

    // 1. ElevenLabs STT
    console.log(`[1] Transcribing audio with ElevenLabs...`);
    const sttResult = await transcribeAudio(req.file.buffer, req.file.originalname);
    const transcription = sttResult.text;
    console.log(`Transcription: "${transcription}"`);

    if (!transcription || transcription.trim() === '') {
      return res.status(400).json({ error: "Transcription resulted in empty text." });
    }

    // 2. RAG
    console.log(`[2] Searching knowledge base...`);
    const context = await searchOqulixKnowledge(transcription);

    // 3. Gemini
    console.log(`[3] Generating answer with Gemini...`);
    const answer = await generateOqulixAnswer(transcription, context);
    console.log(`Answer: "${answer}"`);

    // 4. Google TTS
    console.log(`[4] Converting answer to speech with Google TTS...`);
    const audioBuffer = await textToSpeech(answer);
    
    const filePath = path.join(__dirname, 'response-voice.mp3');
    fs.writeFileSync(filePath, audioBuffer);
    console.log(`Generated audio saved to ${filePath}`);
    console.log(`===========================================\n`);

    res.json({
      transcription,
      answer,
      contextUsed: !!context, // simple boolean to know if context was found
      audioFile: filePath
    });
  } catch (error) {
    console.error("Error processing complete voice pipeline request:", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

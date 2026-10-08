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
const axios = require('axios');

// --- In-Memory Cache for WhatsApp Webhook Deduplication ---
const processedMessages = new Set();
setInterval(() => {
  processedMessages.clear();
}, 60 * 60 * 1000); // Clear every hour
// --------------------------------------------------------

// --- In-Memory Queue for Sequential Processing per User ---
const userQueues = new Map();

async function processSequentially(phoneNumber, task) {
  if (!userQueues.has(phoneNumber)) {
    userQueues.set(phoneNumber, Promise.resolve());
  }
  
  const queue = userQueues.get(phoneNumber);
  const nextTask = queue.then(() => task()).catch(err => console.error(err));
  
  userQueues.set(phoneNumber, nextTask);
  
  nextTask.finally(() => {
    if (userQueues.get(phoneNumber) === nextTask) {
      userQueues.delete(phoneNumber);
    }
  });
}
// --------------------------------------------------------

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
app.use(express.static('public', {
    setHeaders: (res, path) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
    }
}));
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
    console.log("=== INCOMING WEBHOOK ===");
    console.log(JSON.stringify(body, null, 2));

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
        
        if (msg.type === "text" || msg.type === "audio") {
          let messageId = msg.id;
          
          if (processedMessages.has(messageId)) {
            console.log(`[WhatsApp] Ignoring duplicate message ID: ${messageId}`);
            return res.sendStatus(200);
          }
          processedMessages.add(messageId);

          // Process message asynchronously but sequentially per user so we can return 200 OK immediately
          processSequentially(phoneNumber, () => 
            processIncomingWhatsApp(phoneNumber, customerName, msg, messageId)
          );
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

app.delete('/api/admin/leads/:id/conversations', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 1. Fetch all conversations for this lead
    const { data: messagesToMove, error: fetchError } = await supabase
      .from('conversations')
      .select('*')
      .eq('lead_id', id);
      
    if (fetchError) throw fetchError;
    
    // 2. Insert into deleted_messages if there are any
    if (messagesToMove && messagesToMove.length > 0) {
      const { error: insertError } = await supabase
        .from('deleted_messages')
        .insert(messagesToMove);
      if (insertError) throw insertError;
    }

    // 3. Delete from conversations
    const { error: deleteError } = await supabase
      .from('conversations')
      .delete()
      .eq('lead_id', id);
      
    if (deleteError) throw deleteError;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/admin/conversations/:msgId', async (req, res) => {
  try {
    const { msgId } = req.params;
    
    // 1. Fetch the message
    const { data: msgToMove, error: fetchError } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', msgId)
      .single();
      
    if (fetchError) throw fetchError;
    
    // 2. Insert into deleted_messages
    if (msgToMove) {
      const { error: insertError } = await supabase
        .from('deleted_messages')
        .insert([msgToMove]);
      if (insertError) throw insertError;
      
      // Attempt to recall from WhatsApp if it's our own message AND recall was requested
      const shouldRecall = req.query.recall === 'true';
      if (shouldRecall && msgToMove.wamid && msgToMove.sender !== 'customer') {
         const { recallWhatsAppMessage } = require('./src/services/whatsapp-handler');
         await recallWhatsAppMessage(msgToMove.wamid);
      }
    }

    // 3. Delete from conversations
    const { error: deleteError } = await supabase
      .from('conversations')
      .delete()
      .eq('id', msgId);
      
    if (deleteError) throw deleteError;
    res.json({ success: true });
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
      
    // Also insert a system message to mark the exact pause time for the 10-minute logic
    await supabase.from('conversations').insert([{
      lead_id: id,
      sender: 'system',
      message: 'AI_PAUSED'
    }]);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/leads/:id/resume', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('leads')
      .update({ human_needed: false })
      .eq('id', id);
      
    await supabase.from('conversations').insert([{
      lead_id: id,
      sender: 'system',
      message: 'AI_RESUMED'
    }]);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const FormData = require('form-data');

app.post('/api/admin/bulk-send', upload.single('imageFile'), async (req, res) => {
  try {
    const { templateName, language, imageUrl, numbersRaw, variables, messageText } = req.body;
    let numbers;
    try {
      numbers = JSON.parse(numbersRaw);
    } catch(e) {
      numbers = numbersRaw.split(',').map(n => n.trim());
    }

    if (!templateName || !numbers || !Array.isArray(numbers)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
    const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
    
    let mediaId = null;

    if (req.file) {
      const form = new FormData();
      form.append('file', req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });
      form.append('messaging_product', 'whatsapp');
      form.append('type', req.file.mimetype);

      try {
        const mediaRes = await axios.post(
          `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/media`,
          form,
          { headers: { ...form.getHeaders(), Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
        );
        mediaId = mediaRes.data.id;
      } catch (err) {
        console.error('Failed to upload media to Meta:', err.response?.data || err.message);
        return res.status(400).json({ error: 'Failed to upload image to Meta: ' + (err.response?.data?.error?.message || err.message) });
      }
    }

    let successCount = 0;
    let failCount = 0;
    let lastError = "";

    for (const num of numbers) {
      try {
        const payload = {
          messaging_product: "whatsapp",
          to: num,
          type: "template",
          template: {
            name: templateName,
            language: { code: language || 'en' }
          }
        };

        if (mediaId) {
          payload.template.components = [
            {
              type: "header",
              parameters: [{ type: "image", image: { id: mediaId } }]
            }
          ];
        } else if (imageUrl) {
          payload.template.components = [
            {
              type: "header",
              parameters: [{ type: "image", image: { link: imageUrl } }]
            }
          ];
        }
        
        if (variables) {
          if (!payload.template.components) {
            payload.template.components = [];
          }
          const bodyParams = variables.split(',').map(v => ({
            type: "text",
            text: v.trim()
          }));
          payload.template.components.push({
            type: "body",
            parameters: bodyParams
          });
        }
        
        const response = await axios.post(
          `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`,
          payload,
          { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
        );
        successCount++;

        // --- NEW: Automatically create lead and conversation on bulk send ---
        try {
          const wamid = response.data?.messages?.[0]?.id;
          let { data: existingLead } = await supabase.from('leads').select('*').eq('phone_number', num).single();
          
          let leadId;
          if (!existingLead) {
             const { data: newLead } = await supabase.from('leads').insert([{
                 phone_number: num,
                 customer_name: 'Broadcast Recipient',
                 lead_status: 'BROADCAST'
             }]).select().single();
             if (newLead) leadId = newLead.id;
          } else {
             leadId = existingLead.id;
          }

          if (leadId) {
             let msgText = messageText || `[Broadcast] Template: ${templateName}`;
             if (!messageText && variables) msgText += ` | Variables: ${variables}`;
             
             await supabase.from('conversations').insert([{
                 lead_id: leadId,
                 sender: 'ai', // 'ai' instead of 'admin' so it doesn't pause the AI logic
                 message: msgText,
                 wamid: wamid
             }]);
          }
        } catch (dbErr) {
          console.error("Failed to save broadcast to DB:", dbErr);
        }
        // -------------------------------------------------------------------
      } catch (err) {
        const metaError = err.response?.data?.error?.message || err.message;
        console.error(`[Bulk Send] Failed for ${num}:`, metaError);
        lastError = metaError;
        failCount++;
      }
    }

    res.json({ success: true, successCount, failCount, lastError });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/leads/:id/message', async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    
    // Get lead phone number
    const { data: lead } = await supabase.from('leads').select('phone_number').eq('id', id).single();
    if (!lead) throw new Error("Lead not found");

    // Send via WhatsApp
    const { sendWhatsAppMessage } = require('./src/services/whatsapp-handler');
    const wamid = await sendWhatsAppMessage(lead.phone_number, text);

    // Save to conversation history as admin
    const { data: newMsg } = await supabase.from('conversations').insert([{
      lead_id: id,
      sender: 'admin',
      message: text,
      wamid: wamid
    }]).select().single();
    
    // Ensure human_needed is true
    await supabase.from('leads').update({ human_needed: true }).eq('id', id);

    res.json({ success: true, id: newMsg?.id });
  } catch (error) {
    console.error("Admin message error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/leads/:id/media', upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.body; // 'image', 'video', 'audio', 'document'
    const file = req.file;
    
    if (!file) throw new Error("No file provided");

    // Get lead phone number
    const { data: lead } = await supabase.from('leads').select('phone_number').eq('id', id).single();
    if (!lead) throw new Error("Lead not found");

    // Upload to Supabase Storage
    const ext = path.extname(file.originalname) || '';
    const filename = `admin-${Date.now()}-${id}${ext}`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('whatsapp_media')
      .upload(filename, file.buffer, { contentType: file.mimetype });
      
    if (uploadError) throw uploadError;

    const publicUrl = supabase.storage.from('whatsapp_media').getPublicUrl(filename).data.publicUrl;

    // Send via WhatsApp
    const { sendWhatsAppMedia } = require('./src/services/whatsapp-handler');
    const wamid = await sendWhatsAppMedia(lead.phone_number, type, publicUrl);

    // Save to conversation history as admin
    const textLabel = `[${type.charAt(0).toUpperCase() + type.slice(1)}] ${publicUrl}`;
    const { data: newMsg } = await supabase.from('conversations').insert([{
      lead_id: id,
      sender: 'admin',
      message: textLabel,
      wamid: wamid
    }]).select().single();
    
    // Ensure human_needed is true
    await supabase.from('leads').update({ human_needed: true }).eq('id', id);

    res.json({ success: true, url: publicUrl, id: newMsg?.id });
  } catch (error) {
    console.error("Admin media error:", error);
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

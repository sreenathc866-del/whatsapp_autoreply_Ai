const { createClient } = require('@supabase/supabase-js');
const { searchOqulixKnowledge } = require('../rag/search');
const { generateWhatsAppResponse } = require('../ai/whatsapp-gemini');
const axios = require('axios');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// You can use axios to send messages back to WhatsApp API
// const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
// const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

/**
 * Sends a message back to the customer via WhatsApp Cloud API
 */
async function sendWhatsAppMessage(to, text) {
  const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;

  console.log(`[WhatsApp] Sending message to ${to}: "${text}"`);
  
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
    console.warn('[WhatsApp] Warning: WHATSAPP_TOKEN or WHATSAPP_PHONE_ID missing in .env. Add them to send live outbound messages to WhatsApp customers.');
    return;
  }

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "text",
        text: { body: text }
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('[WhatsApp] Outbound message sent successfully! Response ID:', response.data?.messages?.[0]?.id);
  } catch (error) {
    console.error('[WhatsApp] Failed to send message:', error.response?.data || error.message);
  }
}

/**
 * Sends a read receipt (blue ticks) back to WhatsApp Cloud API
 */
async function markMessageAsRead(messageId) {
  const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID;
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID || !messageId) return;

  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    console.error('[WhatsApp] Failed to mark as read:', error.response?.data || error.message);
  }
}

/**
 * Process an incoming WhatsApp message.
 */
async function processIncomingWhatsApp(phoneNumber, customerName, incomingMessage, messageId) {
  console.log(`\n=== Incoming WhatsApp from ${phoneNumber} (${customerName || 'Unknown'}) ===`);
  console.log(`Message: "${incomingMessage}"`);

  let lead = null;
  let formattedHistory = [];

  // 1. Try finding or creating lead in Supabase (with fallback if database is offline)
  try {
    let { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone_number', phoneNumber)
      .single();

    if (!existingLead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert([{ 
          phone_number: phoneNumber, 
          customer_name: customerName,
          lead_status: 'UNQUALIFIED'
        }])
        .select()
        .single();
      lead = newLead;
      if (lead) console.log(`[WhatsApp] Created new lead: ${lead.id}`);
    } else {
      lead = existingLead;
      console.log(`[WhatsApp] Found existing lead: ${lead.id} (${lead.lead_status})`);
    }

    // Check human handoff
    if (lead && lead.human_needed && lead.assigned_agent) {
      console.log(`[WhatsApp] Human agent is handling this lead. AI skipping automatic response.`);
      await supabase.from('conversations').insert([{
        lead_id: lead.id,
        sender: 'customer',
        message: incomingMessage
      }]).catch(() => {});
      return;
    }

    // Save incoming message
    if (lead) {
      const { error: insertErr } = await supabase.from('conversations').insert([{
        lead_id: lead.id,
        sender: 'customer',
        message: incomingMessage
      }]);
      if (insertErr) {
        console.error('[WhatsApp] Failed to save customer message:', insertErr);
      }

      // Fetch history
      const { data: history } = await supabase
        .from('conversations')
        .select('sender, message')
        .eq('lead_id', lead.id)
        .order('timestamp', { ascending: true })
        .limit(10);

      if (history) {
        formattedHistory = history.slice(0, -1).map(row => ({
          role: row.sender === 'customer' ? 'user' : 'model',
          text: row.message
        }));
      }
    }
  } catch (dbErr) {
    console.error('[WhatsApp] Supabase DB Error:', dbErr);
    console.warn('[WhatsApp] Proceeding with AI response using local knowledge base.');
  }

  if (messageId) {
    await markMessageAsRead(messageId);
  }

  const cleanMessage = incomingMessage.trim().toLowerCase();
  const isGreeting = /^(hello|hi|hey|good morning|good afternoon|good evening|good night)$/i.test(cleanMessage);

  if (isGreeting) {
    const instantReply = `Hi ${customerName ? customerName.trim() : 'there'}! 👋 Welcome to OQULIX. How can I help you out today?`;
    await sendWhatsAppMessage(phoneNumber, instantReply);
    
    if (lead) {
      await supabase.from('conversations').insert([{
        lead_id: lead.id,
        sender: 'ai',
        message: instantReply
      }]).catch(() => {});
    }
    return; // Stop here, no need to run RAG for simple greeting
  }

  // 2. RAG Search (searches vector database or falls back to data/oqulix/knowledge.md)
  console.log(`[WhatsApp] Searching company knowledge base...`);
  const context = await searchOqulixKnowledge(incomingMessage);

  // 3. Gemini AI Response & Lead Qualification
  console.log(`[WhatsApp] Generating AI response using company knowledge...`);
  const aiResult = await generateWhatsAppResponse(incomingMessage, context, formattedHistory);
  
  const responseText = aiResult.response_text;
  const leadData = aiResult.lead_data || {};

  console.log(`[WhatsApp] AI Response: "${responseText}"`);
  console.log(`[WhatsApp] Extracted Lead Data:`, leadData);

  // 4. Send response back to customer on WhatsApp
  await sendWhatsAppMessage(phoneNumber, responseText);

  // 5. Save AI response and update lead in DB (if DB available)
  if (lead) {
    try {
      await supabase.from('conversations').insert([{
        lead_id: lead.id,
        sender: 'ai',
        message: responseText
      }]);

      const updates = {};
      if (leadData.customer_name && !lead.customer_name) updates.customer_name = leadData.customer_name;
      if (leadData.business_type) updates.business_type = leadData.business_type;
      if (leadData.service_required) updates.service_required = leadData.service_required;
      if (leadData.requirements) updates.requirements = leadData.requirements;
      if (leadData.budget) updates.budget = leadData.budget;
      if (leadData.timeline) updates.timeline = leadData.timeline;
      if (leadData.urgency) updates.urgency = leadData.urgency;
      if (leadData.lead_score !== undefined) updates.lead_score = leadData.lead_score;
      if (leadData.lead_status) updates.lead_status = leadData.lead_status;
      
      let newlyHot = false;
      if (leadData.human_needed || leadData.lead_status === 'HOT') {
        updates.human_needed = true;
        if (!lead.sales_team_notified) {
          updates.sales_team_notified = true;
          newlyHot = true;
        }
      }

      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString();
        await supabase.from('leads').update(updates).eq('id', lead.id);
      }

      if (newlyHot) {
        notifySalesTeam({ ...lead, ...updates }, incomingMessage);
      }
    } catch (err) {
      console.warn('[WhatsApp] Could not log interaction to Supabase:', err.message);
    }
  }
}

/**
 * Notifies the sales team about a HOT lead.
 */
function notifySalesTeam(leadData, lastMessage) {
  console.log(`\n=========================================`);
  console.log(`🔥 HOT OQULIX LEAD 🔥`);
  console.log(`=========================================`);
  console.log(`Name: ${leadData.customer_name || 'Unknown'}`);
  console.log(`Phone: ${leadData.phone_number}`);
  console.log(`Business: ${leadData.business_type || 'Unknown'}`);
  console.log(`Service: ${leadData.service_required || 'Unknown'}`);
  console.log(`Timeline: ${leadData.timeline || 'Unknown'}`);
  console.log(`Urgency: ${leadData.urgency || 'UNKNOWN'}`);
  console.log(`Lead Score: ${leadData.lead_score || 0}/100`);
  console.log(`\nCustomer message:`);
  console.log(`"${lastMessage}"`);
  console.log(`\n⚡ Recommended action: Contact immediately.`);
  console.log(`=========================================\n`);
  
  // Here you can add logic to send an Email via SendGrid, a Slack webhook, 
  // or a WhatsApp message to the sales manager.
}

module.exports = {
  processIncomingWhatsApp
};

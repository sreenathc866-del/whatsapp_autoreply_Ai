let currentLeadId = null;
let isAiPaused = false;

async function fetchLeads() {
    try {
        const response = await fetch('/api/admin/leads');
        const leads = await response.json();
        
        const listEl = document.getElementById('leads-list');
        listEl.innerHTML = '';
        
        let hotCount = 0;
        
        leads.forEach(lead => {
            if (lead.lead_status === 'HOT') hotCount++;
            
            const card = document.createElement('div');
            card.className = 'lead-card';
            card.onclick = () => loadLeadDetail(lead);
            
            const timeStr = new Date(lead.updated_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            
            card.innerHTML = `
                <div class="lead-header">
                    <span class="lead-name">${lead.customer_name || 'Unknown User'}</span>
                    <span class="status-badge ${lead.lead_status}">${lead.lead_status}</span>
                </div>
                <div class="lead-meta">
                    ${lead.phone_number} • ${timeStr}
                </div>
            `;
            listEl.appendChild(card);
        });

        document.getElementById('total-count').innerText = leads.length;
        document.getElementById('hot-count').innerText = hotCount;

    } catch (error) {
        console.error('Error fetching leads:', error);
        document.getElementById('leads-list').innerHTML = '<div class="loading">Error loading leads.</div>';
    }
}

async function loadLeadDetail(lead) {
    currentLeadId = lead.id;
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('detail-panel').style.display = 'flex';
    
    // Populate details
    document.getElementById('detail-name').innerText = lead.customer_name || 'Unknown User';
    document.getElementById('detail-phone').innerText = lead.phone_number;
    document.getElementById('detail-badges').innerHTML = `<span class="status-badge ${lead.lead_status}">${lead.lead_status}</span>`;
    
    document.getElementById('detail-service').innerText = lead.service_required || '-';
    document.getElementById('detail-timeline').innerText = lead.timeline || '-';
    document.getElementById('detail-budget').innerText = lead.budget || '-';
    document.getElementById('detail-score').innerText = `${lead.lead_score || 0}/100`;
    document.getElementById('detail-requirements').innerText = lead.requirements || 'No specific requirements extracted yet.';

    // Fetch conversation
    try {
        const response = await fetch(`/api/admin/leads/${lead.id}/conversations`);
        const messages = await response.json();
        
        const chatWindow = document.getElementById('chat-window');
        chatWindow.innerHTML = '';
        
        // Calculate current AI state
        const humanInterventions = messages.filter(msg => 
            msg.sender === 'admin' || (msg.sender === 'system' && (msg.message === 'AI_PAUSED' || msg.message === 'AI_RESUMED'))
        );
        
        isAiPaused = false;
        if (humanInterventions.length > 0) {
            const lastIntervention = humanInterventions[humanInterventions.length - 1];
            if (lastIntervention.message !== 'AI_RESUMED') {
                const timeDiff = new Date() - new Date(lastIntervention.timestamp);
                if (timeDiff < 10 * 60 * 1000) {
                    isAiPaused = true;
                }
            }
        }
        updateToggleBtn();
        
        messages.forEach(msg => {
            const bubble = document.createElement('div');
            
            let bubbleClass = 'ai';
            if (msg.sender === 'customer') bubbleClass = 'customer';
            else if (msg.sender === 'admin') bubbleClass = 'ai'; // AI class aligns to the right
            else if (msg.sender === 'system') bubbleClass = 'system';
            
            bubble.className = `bubble ${bubbleClass}`;
            if (msg.sender === 'admin') {
               bubble.style.backgroundColor = '#dcf8c6'; // WhatsApp light green
               bubble.style.color = '#000';
            }
            if (msg.sender === 'system') {
               bubble.style.backgroundColor = '#666';
               bubble.style.color = '#fff';
               bubble.style.textAlign = 'center';
               bubble.style.margin = '10px auto';
            }
            
            let timeStr = "";
            if (msg.timestamp) {
               timeStr = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            }
            
            // Add tick mark for admin/ai messages
            let tickHtml = "";
            if (msg.sender === 'admin' || msg.sender === 'ai') {
                tickHtml = "<span>✅</span>"; // Assuming already sent since it's in the DB
            }
            
            const timeHtml = `<div style="font-size: 0.7rem; opacity: 0.6; text-align: right; margin-top: 4px; display: flex; justify-content: flex-end; align-items: center; gap: 4px;">
                <span>${timeStr}</span>
                ${tickHtml}
            </div>`;
            
            let contentHtml = "";
            if (msg.message.startsWith('[Voice Message] ')) {
                const url = msg.message.replace('[Voice Message] ', '');
                contentHtml = `🎤 Voice Note<br><audio controls src="${url}" style="margin-top:5px; width: 220px;"></audio>`;
            } else {
                // Escape HTML for text messages
                const escapedText = msg.message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
                contentHtml = msg.sender === 'admin' ? `👨‍💻 Admin: ${escapedText}` : escapedText;
            }
            
            bubble.innerHTML = contentHtml + timeHtml;
            
            chatWindow.appendChild(bubble);
        });
        
        // Scroll to bottom
        chatWindow.scrollTop = chatWindow.scrollHeight;
    } catch (error) {
        console.error('Error fetching conversations:', error);
    }
    
    // The button state is now handled by updateToggleBtn() above
}

function updateToggleBtn() {
    const btn = document.getElementById('ai-toggle-btn');
    if (!btn) return;
    if (isAiPaused) {
        btn.innerText = "▶️ Resume AI";
        btn.style.backgroundColor = "#3b82f6"; // Blue
    } else {
        btn.innerText = "⏸ Pause AI (10m)";
        btn.style.backgroundColor = "#6b7280"; // Grey
    }
}

async function toggleAi() {
    if (!currentLeadId) return;
    const btn = document.getElementById('ai-toggle-btn');
    btn.disabled = true;
    
    try {
        if (isAiPaused) {
            btn.innerText = "Resuming...";
            await fetch(`/api/admin/leads/${currentLeadId}/resume`, { method: 'POST' });
        } else {
            btn.innerText = "Pausing...";
            await fetch(`/api/admin/leads/${currentLeadId}/takeover`, { method: 'POST' });
        }
        
        fetchLeads(); 
        const lead = {id: currentLeadId, phone_number: document.getElementById('detail-phone').innerText};
        loadLeadDetail(lead);
    } catch (err) {
        console.error(err);
        alert('Error toggling AI state');
    } finally {
        btn.disabled = false;
    }
}

function goBack() {
    document.getElementById('detail-panel').style.display = 'none';
    if (window.innerWidth > 768) {
        document.getElementById('empty-state').style.display = 'flex';
    }
}

// Bulk Send Feature
function showBulkPanel() {
    document.getElementById('detail-panel').style.display = 'none';
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('bulk-panel').style.display = 'flex';
}

function hideBulkPanel() {
    document.getElementById('bulk-panel').style.display = 'none';
    if (currentLeadId) {
        document.getElementById('detail-panel').style.display = 'flex';
    } else {
        document.getElementById('empty-state').style.display = 'flex';
    }
}

async function sendBulkBroadcast() {
    const templateName = document.getElementById('bulk-template').value.trim();
    const language = document.getElementById('bulk-language').value.trim() || 'en';
    const numbersRaw = document.getElementById('bulk-numbers').value;
    
    if (!templateName) return alert("Please enter the template name.");
    if (!numbersRaw) return alert("Please enter at least one phone number.");

    const numbers = numbersRaw.split('\n')
        .map(n => n.replace(/\D/g, ''))
        .filter(n => n.length >= 10);
        
    if (numbers.length === 0) return alert("No valid phone numbers found.");

    const btn = document.getElementById('bulk-send-btn');
    const statusDiv = document.getElementById('bulk-status');
    btn.disabled = true;
    btn.innerText = "Sending... Please wait.";
    statusDiv.style.display = 'none';
    
    try {
        const res = await fetch('/api/admin/bulk-send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ templateName, language, numbers })
        });
        const data = await res.json();
        
        statusDiv.style.display = 'block';
        if (data.success) {
            statusDiv.innerHTML = `✅ Successfully sent to <b>${data.successCount}</b> numbers.<br>❌ Failed: <b>${data.failCount}</b>.`;
            statusDiv.style.backgroundColor = '#d1fae5';
            statusDiv.style.color = '#065f46';
        } else {
            statusDiv.innerHTML = `❌ Error: ${data.error}`;
            statusDiv.style.backgroundColor = '#fee2e2';
            statusDiv.style.color = '#991b1b';
        }
    } catch (err) {
        statusDiv.style.display = 'block';
        statusDiv.innerHTML = `❌ Error sending broadcast.`;
        statusDiv.style.backgroundColor = '#fee2e2';
        statusDiv.style.color = '#991b1b';
    } finally {
        btn.disabled = false;
        btn.innerText = "🚀 Send Broadcast";
    }
}

async function sendAdminReply() {
    if (!currentLeadId) return;
    const input = document.getElementById('admin-reply-input');
    const text = input.value.trim();
    if (!text) return;

    // Optimistic UI Update: Instantly show the message on the screen
    input.value = '';
    
    const chatWindow = document.getElementById('chat-window');
    const bubble = document.createElement('div');
    bubble.className = `bubble ai`;
    bubble.style.backgroundColor = '#dcf8c6';
    bubble.style.color = '#000';
    
    const timeStr = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const tempId = 'tick-' + Date.now();
    const timeHtml = `<div style="font-size: 0.7rem; opacity: 0.6; text-align: right; margin-top: 4px; display: flex; justify-content: flex-end; align-items: center; gap: 4px;">
        <span>${timeStr}</span>
        <span id="${tempId}">🕓</span>
    </div>`;
    const escapedText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    
    bubble.innerHTML = `👨‍💻 Admin: ${escapedText}` + timeHtml;
    chatWindow.appendChild(bubble);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    
    try {
        const response = await fetch(`/api/admin/leads/${currentLeadId}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        
        const tickSpan = document.getElementById(tempId);
        if (response.ok) {
            if (tickSpan) tickSpan.innerText = '✅';
        } else {
            if (tickSpan) tickSpan.innerText = '❌';
            alert('Failed to send message to WhatsApp');
        }
    } catch (err) {
        console.error(err);
        const tickSpan = document.getElementById(tempId);
        if (tickSpan) tickSpan.innerText = '❌';
        alert('Error sending message');
    }
    
    input.focus();
}

// Initial load
fetchLeads();

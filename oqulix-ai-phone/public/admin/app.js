// --- Dark Mode Logic ---
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    
    // Update icon
    const iconPath = isDark 
        ? '<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />' 
        : '<path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />';
    
    document.getElementById('theme-icon').innerHTML = iconPath;
}

// Initialize theme on load
document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-mode');
        document.getElementById('theme-icon').innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />';
    }
});

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
    
    // Populate header details
    document.getElementById('detail-name').innerText = lead.customer_name || 'Unknown User';
    document.getElementById('detail-phone').innerText = lead.phone_number;
    document.getElementById('detail-badges').innerHTML = `<span class="status-badge ${lead.lead_status}">${lead.lead_status}</span>`;
    
    // Populate drawer details
    document.getElementById('drawer-name').innerText = lead.customer_name || 'Unknown User';
    document.getElementById('drawer-phone').innerText = lead.phone_number;
    document.getElementById('drawer-service').innerText = lead.service_required || '-';
    document.getElementById('drawer-timeline').innerText = lead.timeline || '-';
    document.getElementById('drawer-budget').innerText = lead.budget || '-';
    document.getElementById('drawer-score').innerText = `${lead.lead_score || 0}/100`;
    document.getElementById('drawer-requirements').innerText = lead.requirements || 'No specific requirements extracted yet.';

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
            else if (msg.sender === 'admin') bubbleClass = 'admin';
            else if (msg.sender === 'system') bubbleClass = 'system';
            
            bubble.className = `bubble ${bubbleClass}`;
            
            let timeStr = "";
            if (msg.timestamp) {
               timeStr = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            }
            
            // Add tick mark for admin/ai messages
            let tickHtml = "";
            if (msg.sender === 'admin' || msg.sender === 'ai') {
                tickHtml = "<span>✅</span>"; // Assuming already sent since it's in the DB
            }
            
            const deleteSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 14px; height: 14px; color: #ef4444;"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>`;
            const deleteHtml = msg.id ? `<button onclick="deleteMessage('${msg.id}', this)" style="background:none; border:none; cursor:pointer; padding: 0; opacity: 1; margin-right: 4px; display: flex; align-items: center;" title="Delete message">${deleteSvg}</button>` : '';
            
            const timeHtml = `<div style="font-size: 0.7rem; text-align: right; margin-top: 4px; display: flex; justify-content: flex-end; align-items: center; gap: 4px;">
                ${deleteHtml}
                <span style="opacity: 0.6; display: flex; align-items: center; gap: 4px;">
                    <span>${timeStr}</span>
                    ${tickHtml}
                </span>
            </div>`;
            
            let contentHtml = "";
            if (msg.message.startsWith('[Voice Message] ')) {
                const url = msg.message.replace('[Voice Message] ', '');
                contentHtml = `🎤 Voice Note<br><audio controls src="${url}" style="margin-top:5px; width: 220px;"></audio>`;
            } else if (msg.message.startsWith('[Audio] ')) {
                const url = msg.message.replace('[Audio] ', '');
                contentHtml = `👨‍💻 Admin: 🎤 Audio<br><audio controls src="${url}" style="margin-top:5px; width: 220px;"></audio>`;
            } else if (msg.message.startsWith('[Image] ')) {
                const url = msg.message.replace('[Image] ', '');
                contentHtml = `👨‍💻 Admin: 🖼️ Image<br><img src="${url}" style="margin-top:5px; max-width: 220px; border-radius: 6px;" />`;
            } else if (msg.message.startsWith('[Video] ')) {
                const url = msg.message.replace('[Video] ', '');
                contentHtml = `👨‍💻 Admin: 🎥 Video<br><video controls src="${url}" style="margin-top:5px; max-width: 220px; border-radius: 6px;"></video>`;
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
        btn.classList.add('paused');
    } else {
        btn.innerText = "⏸ Pause AI (10m)";
        btn.classList.remove('paused');
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
    document.getElementById('contact-info-panel').style.display = 'none';
    if (window.innerWidth > 768) {
        document.getElementById('empty-state').style.display = 'flex';
    }
}

function toggleContactInfo() {
    const panel = document.getElementById('contact-info-panel');
    if (panel.style.display === 'none' || panel.style.display === '') {
        panel.style.display = 'flex';
    } else {
        panel.style.display = 'none';
    }
}

async function clearCurrentChat() {
    if (!currentLeadId) return;
    if (!confirm("Are you sure you want to clear this entire conversation? This cannot be undone.")) return;
    
    try {
        const response = await fetch(`/api/admin/leads/${currentLeadId}/conversations`, {
            method: 'DELETE'
        });
        if (response.ok) {
            document.getElementById('chat-window').innerHTML = '';
            toggleContactInfo(); // close drawer
        } else {
            alert('Failed to clear chat.');
        }
    } catch (err) {
        console.error(err);
        alert('Error clearing chat.');
    }
}

let currentDeleteMsgId = null;
let currentDeleteBtnElement = null;

function deleteMessage(msgId, btnElement) {
    currentDeleteMsgId = msgId;
    currentDeleteBtnElement = btnElement;
    document.getElementById('delete-modal').style.display = 'flex';
    
    document.getElementById('btn-delete-everyone').onclick = () => confirmDeleteMessage(true);
    document.getElementById('btn-delete-me').onclick = () => confirmDeleteMessage(false);
}

async function confirmDeleteMessage(forEveryone) {
    document.getElementById('delete-modal').style.display = 'none';
    if (!currentDeleteMsgId) return;
    
    try {
        const query = forEveryone ? '?recall=true' : '';
        const response = await fetch(`/api/admin/conversations/${currentDeleteMsgId}${query}`, { method: 'DELETE' });
        if (response.ok) {
            const bubble = currentDeleteBtnElement.closest('.bubble');
            if (bubble) bubble.remove();
        } else {
            alert('Failed to delete message.');
        }
    } catch (err) {
        console.error(err);
        alert('Error deleting message.');
    }
    
    currentDeleteMsgId = null;
    currentDeleteBtnElement = null;
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
    const imageUrl = document.getElementById('bulk-image-url')?.value.trim();
    const imageFile = document.getElementById('bulk-image-file')?.files[0];
    const variables = document.getElementById('bulk-variables')?.value.trim();
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
        const formData = new FormData();
        formData.append('templateName', templateName);
        formData.append('language', language);
        formData.append('numbersRaw', JSON.stringify(numbers));
        if (imageUrl) formData.append('imageUrl', imageUrl);
        if (imageFile) formData.append('imageFile', imageFile);
        if (variables) formData.append('variables', variables);

        const res = await fetch('/api/admin/bulk-send', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        
        statusDiv.style.display = 'block';
        if (data.success && data.successCount > 0) {
            statusDiv.innerHTML = `✅ Successfully sent to <b>${data.successCount}</b> numbers.`;
            if (data.failCount > 0) {
                statusDiv.innerHTML += `<br>❌ Failed: <b>${data.failCount}</b>. Reason: ${data.lastError}`;
            }
            statusDiv.style.backgroundColor = '#d1fae5';
            statusDiv.style.color = '#065f46';
        } else if (data.success && data.failCount > 0) {
            statusDiv.innerHTML = `❌ Failed to send to <b>${data.failCount}</b> numbers.<br>Reason from Meta: <b>${data.lastError}</b>`;
            statusDiv.style.backgroundColor = '#fee2e2';
            statusDiv.style.color = '#991b1b';
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
    bubble.className = `bubble admin`;
    
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
            const data = await response.json();
            if (tickSpan) tickSpan.innerText = '✅';
            
            // Add delete button dynamically if we got the ID
            if (data.id && tickSpan) {
                const deleteSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 14px; height: 14px; color: #ef4444;"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>`;
                const deleteBtn = document.createElement('button');
                deleteBtn.innerHTML = deleteSvg;
                deleteBtn.title = "Delete message";
                deleteBtn.style = "background:none; border:none; cursor:pointer; padding: 0; opacity: 1; margin-right: 4px; display: flex; align-items: center;";
                deleteBtn.onclick = function() { deleteMessage(data.id, this); };
                tickSpan.parentNode.insertBefore(deleteBtn, tickSpan.previousSibling);
            }
            
            // Automatically pause AI locally since admin sent a message
            if (!isAiPaused) {
                isAiPaused = true;
                updateToggleBtn();
            }
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

let mediaRecorder;
let audioChunks = [];
let isRecording = false;

async function startRecording() {
    if (!currentLeadId || isRecording) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const file = new File([audioBlob], `voice-note-${Date.now()}.webm`, { type: 'audio/webm' });
            
            // Release microphone
            stream.getTracks().forEach(track => track.stop());
            
            // Don't upload if it's too short (e.g., accidental click)
            if (audioChunks.length > 0) {
                await uploadFileToWhatsApp(file, 'audio');
            }
        };

        mediaRecorder.start();
        isRecording = true;
        document.getElementById('voice-record-btn').classList.add('recording');
    } catch (err) {
        console.error('Microphone access denied or error:', err);
        alert('Could not access microphone.');
    }
}

function stopRecording() {
    if (isRecording && mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        isRecording = false;
        document.getElementById('voice-record-btn').classList.remove('recording');
    }
}

async function uploadFileToWhatsApp(file, type) {
    if (!currentLeadId || !file) return;

    // Determine type if not provided
    if (!type) {
        type = 'document';
        if (file.type.startsWith('image/')) type = 'image';
        else if (file.type.startsWith('video/')) type = 'video';
        else if (file.type.startsWith('audio/')) type = 'audio';
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);

    const chatWindow = document.getElementById('chat-window');
    const bubble = document.createElement('div');
    bubble.className = `bubble admin`;
    
    const timeStr = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const tempId = 'tick-' + Date.now();
    const timeHtml = `<div style="font-size: 0.7rem; opacity: 0.6; text-align: right; margin-top: 4px; display: flex; justify-content: flex-end; align-items: center; gap: 4px;">
        <span>${timeStr}</span>
        <span id="${tempId}">🕓</span>
    </div>`;
    
    bubble.innerHTML = `👨‍💻 Admin: Sending [${type}]...` + timeHtml;
    chatWindow.appendChild(bubble);
    chatWindow.scrollTop = chatWindow.scrollHeight;

    try {
        const response = await fetch(`/api/admin/leads/${currentLeadId}/media`, {
            method: 'POST',
            body: formData
        });
        
        const tickSpan = document.getElementById(tempId);
        if (response.ok) {
            const data = await response.json();
            if (tickSpan) tickSpan.innerText = '✅';
            
            // Add delete button dynamically if we got the ID
            if (data.id && tickSpan) {
                const deleteSvg = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 14px; height: 14px; color: #ef4444;"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>`;
                const deleteBtn = document.createElement('button');
                deleteBtn.innerHTML = deleteSvg;
                deleteBtn.title = "Delete message";
                deleteBtn.style = "background:none; border:none; cursor:pointer; padding: 0; opacity: 1; margin-right: 4px; display: flex; align-items: center;";
                deleteBtn.onclick = function() { deleteMessage(data.id, this); };
                tickSpan.parentNode.insertBefore(deleteBtn, tickSpan.previousSibling);
            }
            
            // Automatically pause AI locally since admin sent media
            if (!isAiPaused) {
                isAiPaused = true;
                updateToggleBtn();
            }
            
            // Update bubble text to show it sent
            let mediaHtml = `<a href="${data.url}" target="_blank">View File</a>`;
            if (type === 'audio') mediaHtml = `<br><audio controls src="${data.url}" style="margin-top:5px; width: 220px;"></audio>`;
            else if (type === 'image') mediaHtml = `<br><img src="${data.url}" style="margin-top:5px; max-width: 220px; border-radius: 6px;" />`;
            else if (type === 'video') mediaHtml = `<br><video controls src="${data.url}" style="margin-top:5px; max-width: 220px; border-radius: 6px;"></video>`;
            
            bubble.innerHTML = `👨‍💻 Admin: [${type.toUpperCase()}] ${mediaHtml}` + timeHtml;
            if (tickSpan) document.getElementById(tempId).innerText = '✅'; // re-assign since innerHTML replaced it
        } else {
            if (tickSpan) tickSpan.innerText = '❌';
            alert('Failed to send media to WhatsApp');
        }
    } catch (err) {
        console.error(err);
        const tickSpan = document.getElementById(tempId);
        if (tickSpan) tickSpan.innerText = '❌';
        alert('Error sending media');
    }
}

let pendingMediaFile = null;

function handleMediaUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    pendingMediaFile = file;
    const container = document.getElementById('media-preview-container');
    container.innerHTML = ''; // clear old

    const objectUrl = URL.createObjectURL(file);
    
    if (file.type.startsWith('image/')) {
        container.innerHTML = `<img src="${objectUrl}" style="max-width: 100%; max-height: 300px; border-radius: 4px;" />`;
    } else if (file.type.startsWith('video/')) {
        container.innerHTML = `<video controls src="${objectUrl}" style="max-width: 100%; max-height: 300px; border-radius: 4px;"></video>`;
    } else if (file.type.startsWith('audio/')) {
        container.innerHTML = `<audio controls src="${objectUrl}" style="max-width: 100%;"></audio>`;
    } else {
        container.innerHTML = `<div style="padding: 40px; font-weight: bold;">📄 Document selected</div>`;
    }

    document.getElementById('media-preview-modal').style.display = 'flex';
    event.target.value = ''; // reset so we can select the same file again if needed
}

function cancelMediaSend() {
    pendingMediaFile = null;
    document.getElementById('media-preview-modal').style.display = 'none';
}

async function confirmMediaSend() {
    if (!pendingMediaFile) return;
    const btn = document.getElementById('confirm-media-btn');
    btn.disabled = true;
    btn.innerText = 'Sending...';

    await uploadFileToWhatsApp(pendingMediaFile);

    btn.disabled = false;
    btn.innerText = 'Send';
    document.getElementById('media-preview-modal').style.display = 'none';
    pendingMediaFile = null;
}

// Initial load
fetchLeads();

let currentLeadId = null;

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
        
        messages.forEach(msg => {
            const bubble = document.createElement('div');
            bubble.className = `bubble ${msg.sender === 'customer' ? 'customer' : 'ai'}`;
            
            if (msg.message.startsWith('[Voice Message] ')) {
                const url = msg.message.replace('[Voice Message] ', '');
                bubble.innerHTML = `🎤 Voice Note<br><audio controls src="${url}" style="margin-top:5px; width: 220px;"></audio>`;
            } else {
                bubble.innerText = msg.message;
            }
            
            chatWindow.appendChild(bubble);
        });
        
        // Scroll to bottom
        chatWindow.scrollTop = chatWindow.scrollHeight;
    } catch (error) {
        console.error('Error fetching conversations:', error);
    }
    
    // Reset takeover button state
    const takeoverBtn = document.getElementById('takeover-btn');
    if (lead.human_needed) {
        takeoverBtn.innerText = "Taken Over (AI Paused)";
        takeoverBtn.style.backgroundColor = "#666";
        takeoverBtn.disabled = true;
    } else {
        takeoverBtn.innerText = "📞 Take Over (Mark Human)";
        takeoverBtn.style.backgroundColor = "var(--primary)";
        takeoverBtn.disabled = false;
    }
}

async function markHuman() {
    if (!currentLeadId) return;
    
    try {
        const btn = document.getElementById('takeover-btn');
        btn.innerText = "Taking over...";
        btn.disabled = true;

        const response = await fetch(`/api/admin/leads/${currentLeadId}/takeover`, {
            method: 'POST'
        });
        
        if (response.ok) {
            btn.innerText = "Taken Over (AI Paused)";
            btn.style.backgroundColor = "#666";
            fetchLeads(); // Refresh list
        } else {
            btn.innerText = "Failed. Try again.";
            btn.disabled = false;
        }
    } catch (err) {
        console.error(err);
    }
}

function goBack() {
    document.getElementById('detail-panel').style.display = 'none';
    if (window.innerWidth > 768) {
        document.getElementById('empty-state').style.display = 'flex';
    }
}

// Initial load
fetchLeads();

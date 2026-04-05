document.addEventListener('DOMContentLoaded', () => {
    const mainInput = document.getElementById('main-input');
    const chatHistory = document.getElementById('chat-history');
    const chipsGrid = document.querySelector('.chips-grid');
    const newChatBtn = document.querySelector('.new-chat-btn');
    const mainDisplay = document.querySelector('.main-display');
    const fileUpload = document.getElementById('file-upload');
    const attachBtn = document.getElementById('attach-btn');
    const pdfIndicator = document.getElementById('pdf-indicator');
    const pdfName = document.querySelector('.pdf-name');
    const removePdfBtn = document.getElementById('remove-pdf');
    const menuToggle = document.querySelector('.menu-toggle');
    const sidebar = document.querySelector('.sidebar');
    const webSearchToggle = document.getElementById('web-search-toggle');

    // State
    let webSearchEnabled = false;
    let SESSION_ID = null; // Will be set after login

    // Sidebar toggle functionality
    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    // Web Search Toggle
    if (webSearchToggle) {
        webSearchToggle.addEventListener('click', () => {
            webSearchEnabled = !webSearchEnabled;
            webSearchToggle.classList.toggle('active', webSearchEnabled);
            mainInput.placeholder = webSearchEnabled
                ? "Search the web with Iridescent AI..."
                : "Ask Iridescent AI";
        });
    }

    // Auto-focus input on load
    mainInput.focus();

    // Dummy Google Login Logic
    const loginOverlay = document.getElementById('login-overlay');
    const dummyLoginBtn = document.getElementById('dummy-google-login');

    if (dummyLoginBtn && loginOverlay) {
        dummyLoginBtn.addEventListener('click', async () => {
            dummyLoginBtn.textContent = "Connecting to Google...";
            dummyLoginBtn.disabled = true;

            try {
                // Simulate network latency for the UI effect
                await new Promise(resolve => setTimeout(resolve, 800));

                const response = await fetch('/auth/dummy_login', {
                    method: 'POST'
                });

                const data = await response.json();
                if (data.session_id) {
                    SESSION_ID = data.session_id;
                    // Mock success - update UI
                    loginOverlay.classList.add('hidden');
                    setTimeout(() => loginOverlay.remove(), 500); // Remove from DOM
                    
                    // You could update a user avatar in the menu here
                    console.log("Logged in as:", data.user);
                } else {
                    alert("Authentication completely failed.");
                    dummyLoginBtn.textContent = "Sign in with Google";
                    dummyLoginBtn.disabled = false;
                }
            } catch (err) {
                alert("Auth server error.");
                dummyLoginBtn.textContent = "Sign in with Google";
                dummyLoginBtn.disabled = false;
            }
        });
    }

    // Reset UI to initial state
    const resetUI = () => {
        chatHistory.innerHTML = `
            <div class="hero">
                <div class="greeting">
                    <span class="sparkle-gradient">✦</span>
                    <h2 id="user-greeting">Hi Rishitha</h2>
                </div>
                <h1 class="hero-text">I'm Iridescent AI, ready to help you plan, study, bring ideas to life and more.</h1>
            </div>
        `;
        if (chipsGrid) chipsGrid.style.display = 'flex';
        mainInput.value = '';
        mainPlaceholder();
    };

    const mainPlaceholder = () => {
        mainInput.placeholder = webSearchEnabled
            ? "Search the web with Iridescent AI..."
            : "Ask Iridescent AI";
    };

    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => {
            resetUI();
            hidePdfIndicator();
        });
    }

    // PDF Upload Logic
    if (attachBtn) {
        attachBtn.addEventListener('click', () => fileUpload.click());
    }

    if (fileUpload) {
        fileUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('file', file);

            try {
                pdfName.textContent = "Uploading & Analyzing...";
                pdfIndicator.style.display = 'flex';

                const response = await fetch('/upload', {
                    method: 'POST',
                    headers: { 'X-Session-ID': SESSION_ID },
                    body: formData
                });

                const data = await response.json();
                if (data.message) {
                    pdfName.textContent = file.name;
                    // Remove hero if first interaction
                    const hero = document.querySelector('.hero');
                    if (hero) hero.remove();
                    if (chipsGrid) chipsGrid.style.display = 'none';

                    appendMessage('ai', `System: Financial document "${file.name}" loaded successfully. Below is the automated analysis. You can also chat to ask specific questions.`);
                    
                    if (data.analysis) {
                        appendAnalysisDashboard(data.analysis);
                    }
                } else {
                    alert(data.error || "Upload failed");
                    hidePdfIndicator();
                }
            } catch (err) {
                alert("Error uploading PDF");
                hidePdfIndicator();
            }
        });
    }

    if (removePdfBtn) {
        removePdfBtn.addEventListener('click', hidePdfIndicator);
    }

    function hidePdfIndicator() {
        pdfIndicator.style.display = 'none';
        fileUpload.value = '';
    }

    // Handle Chip Clicks
    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
            let text = Array.from(chip.childNodes)
                .filter(node => node.nodeType === Node.TEXT_NODE)
                .map(node => node.textContent)
                .join('')
                .trim();
            if (!text) text = chip.textContent.trim();
            mainInput.value = text;
            handleSendMessage();
        });
    });

    // Handle Enter Key
    mainInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    async function handleSendMessage() {
        if (!SESSION_ID) {
            alert("Please sign in to execute AI queries.");
            return;
        }

        const message = mainInput.value.trim();
        if (!message) return;

        // Hide Hero if it's the first message
        const hero = document.querySelector('.hero');
        if (hero) hero.remove();
        if (chipsGrid) chipsGrid.style.display = 'none';

        // Add User Message
        appendMessage('user', message);
        mainInput.value = '';
        mainInput.style.height = 'auto';

        // Choose endpoint based on web search toggle
        const endpoint = webSearchEnabled ? '/search' : '/chat';
        const loadingText = webSearchEnabled ? 'Searching the web...' : 'Thinking...';

        // Add Loading Indicator
        const loadingId = appendMessage('ai', loadingText, true, webSearchEnabled);

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Session-ID': SESSION_ID
                },
                body: JSON.stringify({ message })
            });

            const data = await response.json();
            const loadingElement = document.getElementById(loadingId);
            if (loadingElement) loadingElement.remove();

            if (data.response) {
                appendMessage('ai', data.response);

                // If sources are present, render them
                if (data.sources && data.sources.length > 0) {
                    appendSources(data.sources);
                }
            } else {
                appendMessage('ai', "Error: " + (data.error || "Failed to get response"));
            }
        } catch (error) {
            const loadingElement = document.getElementById(loadingId);
            if (loadingElement) loadingElement.remove();
            appendMessage('ai', "Error connecting to server. Please ensure the backend is running.");
        }
    }

    function appendMessage(sender, text, isLoading = false, isSearching = false) {
        const id = 'msg-' + Date.now();
        const messageDiv = document.createElement('div');
        messageDiv.id = id;

        let classes = `message ${sender}-message`;
        if (isLoading) classes += ' loading';
        if (isSearching) classes += ' searching';
        messageDiv.className = classes;

        const avatar = document.createElement('div');
        avatar.className = `message-avatar ${sender === 'user' ? 'user-avatar-msg' : 'ai-avatar-msg'}`;
        avatar.innerHTML = sender === 'user' ? 'R' : '✦';

        const content = document.createElement('div');
        content.className = 'message-content';

        if (!isLoading) {
            // Convert markdown-style formatting to HTML
            let formattedText = text
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/\n/g, '<br>');
            content.innerHTML = formattedText;
        } else {
            content.textContent = text;
        }

        messageDiv.appendChild(avatar);
        messageDiv.appendChild(content);
        chatHistory.appendChild(messageDiv);

        // Smooth scroll to bottom
        mainDisplay.scrollTo({
            top: mainDisplay.scrollHeight,
            behavior: 'smooth'
        });

        return id;
    }

    function appendSources(sources) {
        const sourcesDiv = document.createElement('div');
        sourcesDiv.className = 'sources-section';

        const sourcesLabel = document.createElement('div');
        sourcesLabel.className = 'sources-label';
        sourcesLabel.innerHTML = '<span class="material-symbols-outlined">search</span> Web Search Results:';
        sourcesDiv.appendChild(sourcesLabel);

        const listContainer = document.createElement('div');
        listContainer.className = 'google-results-list';

        sources.forEach((source) => {
            const resultItem = document.createElement('div');
            resultItem.className = 'google-result-item';

            const favicon = `https://www.google.com/s2/favicons?domain=${source.domain}&sz=32`;

            resultItem.innerHTML = `
                <div class="google-result-header">
                    <img src="${favicon}" alt="" class="google-favicon" onerror="this.style.display='none'">
                    <span class="google-domain">${source.domain}</span>
                </div>
                <a href="${source.url}" target="_blank" rel="noopener noreferrer" class="google-result-title">${source.title}</a>
                <div class="google-result-snippet">${source.snippet}</div>
            `;

            listContainer.appendChild(resultItem);
        });

        sourcesDiv.appendChild(listContainer);
        chatHistory.appendChild(sourcesDiv);

        mainDisplay.scrollTo({
            top: mainDisplay.scrollHeight,
            behavior: 'smooth'
        });
    }

    function appendAnalysisDashboard(analysis) {
        const dashboardDiv = document.createElement('div');
        dashboardDiv.className = 'financial-dashboard';

        let metricsHtml = '';
        if (analysis.metrics && analysis.metrics.length > 0) {
            analysis.metrics.forEach(m => {
                const statusClass = m.status ? `metric-status-${m.status}` : 'metric-status-good';
                metricsHtml += `
                    <div class="metric-row ${statusClass}">
                        <div class="metric-info">
                            <span class="metric-name">${m.name}</span>
                            <span class="metric-comment">${m.comment}</span>
                        </div>
                        <span class="metric-value">${m.value}</span>
                    </div>
                `;
            });
        }

        let strengthsHtml = '';
        if (analysis.strengths && analysis.strengths.length > 0) {
            strengthsHtml = '<ul>' + analysis.strengths.map(s => `<li>${s}</li>`).join('') + '</ul>';
        }

        let risksHtml = '';
        if (analysis.risks && analysis.risks.length > 0) {
            risksHtml = '<ul>' + analysis.risks.map(r => `<li>${r}</li>`).join('') + '</ul>';
        }

        dashboardDiv.innerHTML = `
            <div class="dashboard-header">
                <div class="health-score-container">
                    <span class="health-score-value">${analysis.score || '-'}</span>
                    <span class="health-score-label">Score</span>
                </div>
                <div class="dashboard-title-area">
                    <h3>Sample analysis: Financial Document</h3>
                    <p><strong>${analysis.score_category || 'Status'}</strong>: ${analysis.summary || 'Document interpreted successfully.'}</p>
                </div>
            </div>

            <div class="metrics-section">
                <div class="metrics-title">Sample Output — Key Metrics</div>
                <div class="metrics-list">
                    ${metricsHtml}
                </div>
            </div>

            <div class="insights-grid">
                <div class="insight-card strengths-card">
                    <h4>Strengths</h4>
                    ${strengthsHtml}
                </div>
                <div class="insight-card risks-card">
                    <h4>Risks</h4>
                    ${risksHtml}
                </div>
            </div>
        `;

        chatHistory.appendChild(dashboardDiv);
        mainDisplay.scrollTo({
            top: mainDisplay.scrollHeight,
            behavior: 'smooth'
        });
    }


    // Auto-resize input height
    mainInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });
});

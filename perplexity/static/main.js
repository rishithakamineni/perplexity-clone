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

    // Sidebar toggle functionality
    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    // Auto-focus input on load
    mainInput.focus();

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
        mainInput.placeholder = "Ask Iridescent AI";
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
                // Show temporary state
                pdfName.textContent = "Uploading...";
                pdfIndicator.style.display = 'flex';

                const response = await fetch('/upload', {
                    method: 'POST',
                    body: formData
                });

                const data = await response.json();
                if (data.message) {
                    pdfName.textContent = file.name;
                    appendMessage('ai', `System: PDF "${file.name}" loaded successfully. You can now ask questions about it.`);
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
            // Only grab actual text nodes to avoid grabbing icon strings like "image"
            let text = Array.from(chip.childNodes)
                .filter(node => node.nodeType === Node.TEXT_NODE)
                .map(node => node.textContent)
                .join('')
                .trim();
            if (!text) text = chip.textContent.trim(); // Fallback just in case
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

        // Add Loading Indicator
        const loadingId = appendMessage('ai', 'Thinking...', true);

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            });

            const data = await response.json();
            const loadingElement = document.getElementById(loadingId);
            if (loadingElement) loadingElement.remove();

            if (data.response) {
                appendMessage('ai', data.response);
            } else {
                appendMessage('ai', "Error: " + (data.error || "Failed to get response"));
            }
        } catch (error) {
            const loadingElement = document.getElementById(loadingId);
            if (loadingElement) loadingElement.remove();
            appendMessage('ai', "Error connecting to server. Please ensure the backend is running.");
        }
    }

    function appendMessage(sender, text, isLoading = false) {
        const id = 'msg-' + Date.now();
        const messageDiv = document.createElement('div');
        messageDiv.id = id;
        messageDiv.className = `message ${sender}-message ${isLoading ? 'loading' : ''}`;

        const avatar = document.createElement('div');
        avatar.className = `message-avatar ${sender === 'user' ? 'user-avatar-msg' : 'ai-avatar-msg'}`;
        avatar.innerHTML = sender === 'user' ? 'R' : '✦';

        const content = document.createElement('div');
        content.className = 'message-content';
        
        // Simple formatting for line breaks
        if (!isLoading) {
            content.innerHTML = text.replace(/\n/g, '<br>');
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

    // Auto-resize input height
    mainInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });
});

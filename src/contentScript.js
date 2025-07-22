console.log("Content script loaded!");

// Group all state variables at the top
if (typeof window.STATE === 'undefined') {
    window.STATE = {
        isExtensionAlive: true,
        activePopup: null,
        reconnectionAttempts: 0,
        lastPingSuccess: Date.now(),
        connectionRetryTimeout: null,
        pingInterval: null
    };
}

// Define constants only if not already defined
if (typeof window.CONSTANTS === 'undefined') {
    window.CONSTANTS = {
        MAX_RECONNECTION_ATTEMPTS: 3,
        RECONNECT_DELAY: 2000, // 2 seconds
        LANGUAGE_NAMES: {
            'en': 'English',
            'es': 'Spanish',
            'hi': 'Hindi',
            'hi-en': 'Hinglish',
            'fr': 'French',
            'de': 'German'
        }
    };
}

// Alias for easier access
const STATE = window.STATE;
const CONSTANTS = window.CONSTANTS;

// Add connection management at the top

// Add ping interval to keep connection alive

// Add persistent connection management

async function initializeExtension() {
    clearAllIntervals(); // Clear any existing intervals
    
    try {
        const response = await sendMessage({ type: "PING" });
        if (response?.status === 'ok') {
            STATE.isExtensionAlive = true;
            startConnectionMonitoring();
            
            // Establish persistent connection
            const port = chrome.runtime.connect({ name: 'keepAlive' });
            port.onDisconnect.addListener(() => {
                STATE.isExtensionAlive = false;
                scheduleReconnect();
            });
            
            return true;
        }
    } catch (error) {
        console.warn('Extension initialization failed, retrying...');
        scheduleReconnect();
    }
    return false;
}

function scheduleReconnect() {
    if (STATE.connectionRetryTimeout) clearTimeout(STATE.connectionRetryTimeout);
    STATE.connectionRetryTimeout = setTimeout(async () => {
        if (!STATE.isExtensionAlive) {
            await initializeExtension();
        }
    }, CONSTANTS.RECONNECT_DELAY);
}

// Add connection management functions
async function checkConnection() {
    try {
        const response = await sendMessage({ type: "PING" });
        if (response?.status === 'ok') {
            STATE.isExtensionAlive = true;
            STATE.lastPingSuccess = Date.now();
            STATE.reconnectionAttempts = 0;
            return true;
        }
        throw new Error('Invalid ping response');
    } catch (error) {
        handleConnectionError();
        scheduleReconnect();
        return false;
    }
}

function handleConnectionError() {
    STATE.isExtensionAlive = false;
    if (STATE.reconnectionAttempts < CONSTANTS.MAX_RECONNECTION_ATTEMPTS) {
        STATE.reconnectionAttempts++;
        // Try to reconnect
        setTimeout(checkConnection, 1000 * STATE.reconnectionAttempts);
    }
}

// Simple message sender with retry
const sendMessage = async (message, maxRetries = 2) => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            // Check if too much time has passed since last successful ping
            if (Date.now() - STATE.lastPingSuccess > 30000) { // 30 seconds
                await checkConnection();
            }

            return await new Promise((resolve, reject) => {
                if (!chrome?.runtime?.id) {
                    STATE.isExtensionAlive = false;
                    reject(new Error('Extension not available'));
                    return;
                }

                chrome.runtime.sendMessage(message, response => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(response);
                    }
                });
            });
        } catch (error) {
            if (attempt === maxRetries) {
                await checkConnection(); // Try to restore connection
                if (!STATE.isExtensionAlive) {
                    showError('Connection lost. Attempting to reconnect...');
                }
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
};

// Add tab visibility handling
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
        await initializeExtension();
    } else {
        stopConnectionMonitoring();
    }
});

function startConnectionMonitoring() {
    // Clear any existing interval
    stopConnectionMonitoring();
    // Check connection every 15 seconds
    STATE.pingInterval = setInterval(checkConnection, 15000);
}

function stopConnectionMonitoring() {
    if (STATE.pingInterval) {
        clearInterval(STATE.pingInterval);
        STATE.pingInterval = null;
    }
}

// Initialize connection monitoring when script loads
startConnectionMonitoring();

// Helper function to check if text is selectable
function isValidSelection(text) {
    if (!text) return false;
    if (text.length > 500) return false;
    
    // Allow hyphenated words by replacing hyphens with spaces for word count
    const normalizedText = text.replace(/-/g, ' ');
    return normalizedText.trim().length > 0;
}

// Helper function to safely clear selection
function clearSelection() {
    try {
        // Store the selection before clearing
        const selection = window.getSelection();
        const selectedText = selection.toString();
        
        // Try multiple methods to clear selection
        if (document.selection) {
            document.selection.empty();
        } else if (window.getSelection) {
            // Only clear if we still have the same text selected
            if (window.getSelection().toString() === selectedText) {
                if (window.getSelection().empty) {
                    window.getSelection().empty();
                } else if (window.getSelection().removeAllRanges) {
                    window.getSelection().removeAllRanges();
                }
            }
        }
    } catch (e) {
        // Ignore selection clearing errors - don't let them break core functionality
        console.log('Selection clearing skipped:', e.message);
    }
}

// Helper function to handle selected text
async function handleSelectedText(event) {
    if (!STATE.isExtensionAlive || STATE.activePopup) return; // Don't process if there's an active popup

    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    
    if (!isValidSelection(selectedText)) {
        if (selectedText.length > 500) {
            showError('Selection too long. Please select less than 500 characters.');
        }
        return;
    }

    try {
        const popup = showPopup({
            definition: 'Analyzing text...',
            synonyms: [],
            examples: [],
            selectedText: selectedText  // Pass selected text to popup
        }, event);

        // Only proceed if popup was created successfully
        if (popup) {
            const response = await sendMessage({
                type: 'WORD_CLICKED',
                word: selectedText,
                context: getContext(selectedText),
                metadata: {
                    url: window.location.href,
                    title: document.title,
                    timestamp: Date.now()
                }
            });

            if (response?.data) {
                // Pass the selected text along with the response data
                response.data.selectedText = selectedText;
                showPopup(response.data, event);
            }
        }
    } catch (error) {
        console.error('Selection handling error:', error);
        showError('Failed to process selection');
    }
}

// Double-click handler for single words (intent: quick lookup)
document.addEventListener('dblclick', async (event) => {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    const wordCount = selectedText.replace(/-/g, ' ').split(/\s+/).length;
    if (selectedText && wordCount === 1) {
        await handleSelectedText(event);
    }
});

// Mouse-up handler for phrases and words (intent: only with Alt key, up to 3 words)
document.addEventListener('mouseup', async (event) => {
    // Skip if it was a double-click to avoid duplicate triggers
    if (event.detail === 2) return;
    if (event.button !== 0) return; // Only handle left click

    // Only show popup if Alt key is held during selection
    if (!event.altKey) return;

    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    // Only show for up to 3 words (intent: short phrases)
    const wordCount = selectedText.replace(/-/g, ' ').split(/\s+/).length;
    if (!selectedText || wordCount > 3) return;

    // Store the selected text and clear the selection
    const textToAnalyze = selectedText;

    setTimeout(async () => {
        if (textToAnalyze === selectedText) {
            await handleSelectedText(event);
        }
    }, 50);
});

function showError(message) {
    const error = document.createElement('div');
    error.className = 'cad-error';
    error.textContent = message;
    document.body.appendChild(error);
    setTimeout(() => error.remove(), 3000);
}

function getContext(selectedText) {
    try {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return selectedText;

        const range = selection.getRangeAt(0);
        if (!range) return selectedText;

        // Get paragraph and structural context
        let container = range.commonAncestorContainer;
        let structuralInfo = [];
        let paragraphContext = '';
        
        // Traverse up to gather structural context
        while (container && container.nodeType !== 9) {
            if (container.nodeType === 1) {
                // Check for headings
                if (/^H[1-6]$/.test(container.tagName)) {
                    structuralInfo.unshift(`Heading: ${container.textContent.trim()}`);
                }
                // Check for list context
                if (container.tagName === 'LI') {
                    const listType = container.parentElement.tagName === 'OL' ? 'Numbered list' : 'Bullet list';
                    structuralInfo.push(`${listType} item`);
                }
                // Check for special sections
                if (container.getAttribute('role') === 'article' || 
                    container.tagName === 'ARTICLE' || 
                    container.tagName === 'SECTION') {
                    const sectionTitle = container.querySelector('h1,h2,h3,h4,h5,h6')?.textContent;
                    if (sectionTitle) structuralInfo.unshift(`Section: ${sectionTitle.trim()}`);
                }
            }
            
            // Get the paragraph text
            if (container.nodeType === 1 && 
                (container.tagName === 'P' || container.tagName === 'DIV')) {
                paragraphContext = container.textContent;
                break;
            }
            
            container = container.parentNode;
        }

        // Find sentence boundaries
        const sentenceRegex = /[.!?]+[\s\n]+/g;
        const sentences = paragraphContext.split(sentenceRegex);
        const selectedTextIndex = sentences.findIndex(s => s.includes(selectedText));
        
        // Get surrounding sentences for context
        const contextSentences = sentences.slice(
            Math.max(0, selectedTextIndex - 2),
            Math.min(sentences.length, selectedTextIndex + 3)
        );

        // Combine structural info and textual context
        const context = {
            structure: structuralInfo.join(' > '),
            sentences: contextSentences.join('. ').trim(),
            position: selectedTextIndex / sentences.length // Relative position in paragraph
        };

        // Cache the context for better performance
        if (!window._contextCache) window._contextCache = new Map();
        window._contextCache.set(selectedText, context);

        return JSON.stringify(context);
    } catch (e) {
        console.error('Context extraction failed:', e);
        return selectedText;
    }
}

function detectColorScheme() {
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const rgb = bodyBg.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)/)?.slice(1).map(Number) || [255, 255, 255];
    const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
    const isDark = brightness < 128;

    return {
        background: isDark ? '#1e1e1e' : '#ffffff',
        text: isDark ? '#ffffff' : '#000000',
        subtext: isDark ? '#cccccc' : '#444444',
        border: isDark ? '#404040' : '#e0e0e0',
        hover: isDark ? '#2d2d2d' : '#f5f5f5',
        accent: '#2196F3',
        loading: isDark ? '#404040' : '#f0f0f0'
    };
}

// Update the calculatePopupPosition function to accept a popup element
function calculatePopupPosition(event, popupElement = null) {
    const viewport = {
        width: window.innerWidth,
        height: window.innerHeight
    };

    // Default minimum margins from viewport edges
    const margin = 20;
    
    // For initial positioning (without popupElement), estimate larger default size
    const popupWidth = popupElement ? popupElement.offsetWidth : 350;  // Increased from 300
    const popupHeight = popupElement ? popupElement.offsetHeight : 400; // Increased from 200

    // Start with cursor position
    let left = event.clientX + 10;
    let top = event.clientY + 10;

    // First, handle the right edge
    if (left + popupWidth > viewport.width - margin) {
        // Try positioning to the left of the cursor
        left = event.clientX - popupWidth - 10;
        
        // If still too far left, stick to the right edge with margin
        if (left < margin) {
            left = viewport.width - popupWidth - margin;
        }
    }

    // Then handle the bottom edge
    if (top + popupHeight > viewport.height - margin) {
        // Try positioning above the cursor
        top = event.clientY - popupHeight - 10;
        
        // If still too high, stick to the bottom edge with margin
        if (top < margin) {
            top = viewport.height - popupHeight - margin;
        }
    }

    // Ensure minimum margins are maintained
    left = Math.max(margin, Math.min(left, viewport.width - popupWidth - margin));
    top = Math.max(margin, Math.min(top, viewport.height - popupHeight - margin));

    return { left, top };
}

function showPopup(data, event) {
    try {
        // If updating existing popup, don't create new one
        if (STATE.activePopup && data.isRegenerateRequest) {
            return updateExistingPopup(STATE.activePopup, data);
        }

        // Remove any existing popup if not regenerating
        if (STATE.activePopup) {
            STATE.activePopup.remove();
            STATE.activePopup = null;
        }

        const selectedText = data.selectedText;
        const popup = document.createElement('div');
        const colorScheme = detectColorScheme();

        // Add the popup HTML
        popup.innerHTML = `
            <div class="draggable-popup" style="
                position: fixed;
                opacity: 0;
                z-index: 2147483647;
                background: ${colorScheme.background};
                border-radius: 16px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.15);
                padding: 16px;
                width: 320px;
                font-family: system-ui, -apple-system, sans-serif;
                color: ${colorScheme.text};
            ">
                <!-- Simple Modern Header -->
                <div class="popup-header" style="
                    margin: -16px -16px 8px -16px;  /* Reduced bottom margin from 12px to 8px */
                    padding: 12px 16px;  /* Reduced vertical padding from 16px to 12px */
                    background: ${colorScheme.hover};
                    border-radius: 16px 16px 0 0;
                    cursor: move;
                    user-select: none;
                    position: relative;
                ">
                    <!-- Close Button (Absolute Top Right) -->
                    <button style="
                        position: absolute;
                        right: 12px;
                        top: 12px;
                        border: none;
                        background: ${colorScheme.background};
                        color: ${colorScheme.subtext};
                        width: 26px;
                        height: 26px;
                        border-radius: 8px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        cursor: pointer;
                        font-size: 18px;
                        transition: all 0.2s;
                        z-index: 2;
                        &:hover {
                            background: ${colorScheme.border};
                            color: ${colorScheme.text};
                        }
                    ">×</button>

                    <!-- Content Container -->
                    <div style="padding-right: 32px;">
                        <!-- Selected Text -->
                        <div style="
                            font-size: 18px;
                            font-weight: 600;
                            color: ${colorScheme.text};
                            line-height: 1.4;
                            margin-bottom: 8px;
                        ">${selectedText}</div>

                        <!-- Language Badge (Below Text) -->
                        ${data.detectedLanguage ? `
                            <div style="
                                display: inline-flex;
                                align-items: center;
                                background: ${colorScheme.background};
                                padding: 4px 10px;
                                border-radius: 6px;
                                font-size: 12px;
                                color: ${colorScheme.accent};
                                font-weight: 500;
                            ">${CONSTANTS.LANGUAGE_NAMES[data.detectedLanguage]}</div>
                        ` : ''}
                    </div>
                </div>

                <!-- Translation Bar -->
                <div style="
                    display: flex;
                    gap: 8px;
                    margin-bottom: 16px;
                ">
                    <select class="language-selector" style="
                        flex: 1;
                        padding: 8px 12px;
                        border: 1px solid ${colorScheme.border};
                        border-radius: 8px;
                        background: ${colorScheme.background};
                        color: ${colorScheme.text};
                        font-size: 13px;
                        cursor: pointer;
                        transition: all 0.2s;
                        &:hover {
                            border-color: ${colorScheme.accent};
                        }
                    ">
                        ${Object.entries(CONSTANTS.LANGUAGE_NAMES).map(([code, name]) => `
                            <option value="${code}" ${code === (data.currentLanguage || data.detectedLanguage || 'en') ? 'selected' : ''}>
                                Translate to ${name}
                            </option>
                        `).join('')}
                    </select>

                    <!-- Speaker Button -->
                    <button class="speaker-btn" style="
                        border: 1px solid ${colorScheme.border};
                        background: ${colorScheme.background};
                        padding: 8px;
                        border-radius: 8px;
                        color: ${colorScheme.text};
                        cursor: pointer;
                        transition: all 0.2s;
                        &:hover {
                            border-color: ${colorScheme.accent};
                            color: ${colorScheme.accent};
                        }
                    ">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.8-1-3.3-2.5-4v8c1.5-.7 2.5-2.2 2.5-4z"/>
                        </svg>
                    </button>
                </div>

                <!-- Content Area -->
                <div class="popup-content" style="min-height: 100px;">
                    <div style="margin-bottom: 12px; line-height: 1.5; color: ${colorScheme.text};">
                        <div style="padding: 12px; background: ${colorScheme.hover}; border-radius: 8px;">
                            ${data.definition || 'Loading...'}
                        </div>
                    </div>
                    
                    <!-- Centered Footer Button -->
                    <div style="
                        display: flex;
                        justify-content: center;
                        margin-top: 12px;  /* Reduced from 16px */
                        padding-top: 8px;   /* Reduced from 12px */
                        border-top: 1px solid ${colorScheme.border};
                    ">
                        <button class="more-details" style="
                            border: none;
                            background: none;
                            color: #2196F3;
                            cursor: pointer;
                            font-size: 13px;   /* Slightly reduced from 14px */
                            font-weight: 500;
                            padding: 6px 12px;  /* Reduced vertical padding from 8px to 6px */
                            border-radius: 4px;
                            transition: background 0.2s;
                            &:hover {
                                background: ${colorScheme.hover};
                            }
                        ">
                            FULL DEFINITION
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Add to DOM only once
        document.body.appendChild(popup);

        // Store reference to active popup immediately
        STATE.activePopup = popup;

        // Get references to elements after DOM insertion
        const draggablePopup = popup.querySelector('.draggable-popup');
        const popupHeader = popup.querySelector('.popup-header');
        const closeButton = popup.querySelector('.popup-header button');  // Changed selector
        const speakerButton = popup.querySelector('.speaker-btn');
        const moreButton = popup.querySelector('.more-details');
        const langSelect = popup.querySelector('.language-selector');

        // Add validation with specific error messages
        if (!draggablePopup) throw new Error('Failed to initialize draggable popup');
        if (!popupHeader) throw new Error('Failed to initialize popup header');
        if (!closeButton) throw new Error('Failed to initialize close button');
        if (!speakerButton) throw new Error('Failed to initialize speaker button');
        if (!moreButton) throw new Error('Failed to initialize more button');

        // Set initial position
        const position = calculatePopupPosition(event, draggablePopup);
        draggablePopup.style.left = `${position.left}px`;
        draggablePopup.style.top = `${position.top}px`;
        draggablePopup.style.opacity = '1';
        draggablePopup.style.transition = 'opacity 0.2s';

        // Initialize dragging state
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;

        function dragStart(e) {
            if (e.target.closest('button')) return;

            try {
                // Store current selection
                const selection = window.getSelection();
                if (selection && selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    if (range) {
                        // Only start drag if clicking header
                        if (e.target === popupHeader || e.target.closest('.popup-header')) {
                            e.preventDefault();
                            e.stopPropagation();
                            
                            initialX = e.type === "mousedown" ? e.clientX - xOffset : e.touches[0].clientX - xOffset;
                            initialY = e.type === "mousedown" ? e.clientY - yOffset : e.touches[0].clientY - yOffset;
                            
                            isDragging = true;
                        }

                        // Restore selection
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }
                }
            } catch (error) {
                console.log('Drag start error:', error);
                // Continue with drag even if selection restoration fails
                if (e.target === popupHeader || e.target.closest('.popup-header')) {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    initialX = e.type === "mousedown" ? e.clientX - xOffset : e.touches[0].clientX - xOffset;
                    initialY = e.type === "mousedown" ? e.clientY - yOffset : e.touches[0].clientY - yOffset;
                    
                    isDragging = true;
                }
            }
        }

        function dragEnd(e) {
            if (!isDragging) return;
            
            e.preventDefault();
            e.stopPropagation();
            
            initialX = currentX;
            initialY = currentY;
            isDragging = false;
        }

        function drag(e) {
            if (isDragging) {
                e.preventDefault();
                e.stopPropagation();
                
                currentX = e.type === "mousemove" ? e.clientX - initialX : e.touches[0].clientX - initialX;
                currentY = e.type === "mousemove" ? e.clientY - initialY : e.touches[0].clientY - initialY;

                xOffset = currentX;
                yOffset = currentY;

                draggablePopup.style.transform = `translate(${currentX}px, ${currentY}px)`;
            }
        }

        // Make header non-selectable to prevent text selection during drag
        popupHeader.style.userSelect = 'none';
        popupHeader.style.webkitUserSelect = 'none';
        popupHeader.style.msUserSelect = 'none';
        popupHeader.style.MozUserSelect = 'none';

        // Add desktop event listeners
        popupHeader.addEventListener('mousedown', dragStart);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);

        // Add mobile event listeners
        popupHeader.addEventListener('touchstart', dragStart);
        document.addEventListener('touchmove', drag);
        document.addEventListener('touchend', dragEnd);

        // Cleanup listeners when popup is closed
        const cleanupListeners = () => {
            document.removeEventListener('mousemove', drag);
            document.removeEventListener('mouseup', dragEnd);
            document.removeEventListener('touchmove', drag);
            document.removeEventListener('touchend', dragEnd);
            resizeObserver.disconnect();
        };

        // Update close handlers to cleanup listeners
        const closePopup = () => {
            // Remove event listeners
            cleanupListeners();
            document.removeEventListener('click', handleOutsideClick);
            document.removeEventListener('mouseup', handleMouseUp);
            
            // Clear selection first
            window.getSelection().removeAllRanges();
            
            // Remove popup and reset state
            popup.remove();
            STATE.activePopup = null;

            // Prevent new popups from appearing immediately
            isClosing = true;
            setTimeout(() => {
                isClosing = false;
            }, 100);
        };

        // Track closing state
        let isClosing = false;

        // Handle mouseup events with debounce
        const handleMouseUp = (e) => {
            if (isClosing) return; // Skip if we're in closing state
            if (STATE.activePopup) return; // Skip if popup is already active
            
            const selection = window.getSelection();
            const selectedText = selection.toString().trim();
            
            if (selectedText && !popup.contains(e.target)) {
                handleSelectedText(e);
            }
        };

        // Add mouseup handler with proper cleanup
        document.addEventListener('mouseup', handleMouseUp);

        // Handle clicks outside popup
        function handleOutsideClick(e) {
            if (!popup.contains(e.target)) {
                closePopup();
            }
        }

        // Add outside click handler
        document.addEventListener('click', handleOutsideClick);

        // Handle close button click with proper event handling
        closeButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            closePopup();
        });

        // Enhanced speaker button interaction
        speakerButton.addEventListener('mouseover', () => {
            speakerButton.style.background = '#f0f0f0';
            speakerButton.style.color = '#2196F3';  // Change to blue on hover
        });
        speakerButton.addEventListener('mouseout', () => {
            speakerButton.style.background = 'none';
            speakerButton.style.color = '#666';     // Reset to original color
        });
        speakerButton.addEventListener('click', (e) => {
            e.stopPropagation();
            speakerButton.style.transform = 'scale(1.1)';  // Add slight "press" effect
            setTimeout(() => speakerButton.style.transform = 'scale(1)', 200);
            const utterance = new SpeechSynthesisUtterance(selectedText);
            speechSynthesis.speak(utterance);
        });

        // Add "More" button handler with improved toggle
        let isExpanded = false; // Track expanded state

        moreButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Encode the selected text for URL
            const encodedWord = encodeURIComponent(data.selectedText.toLowerCase().trim());
            
            // Open the word definition page in a new tab
            window.open(`https://shabdkosh-theta.vercel.app/word/${encodedWord}`, '_blank');
        });

        // Add resize observer to handle window resizing
        const resizeObserver = new ResizeObserver(() => {
            const draggablePopup = popup.querySelector('.draggable-popup');
            if (draggablePopup) {
                const rect = draggablePopup.getBoundingClientRect();
                const newPosition = calculatePopupPosition({
                    clientX: rect.left,
                    clientY: rect.top
                });
                
                // Only update if popup is outside viewport
                if (newPosition.left !== rect.left || newPosition.top !== rect.top) {
                    draggablePopup.style.left = `${newPosition.left}px`;
                    draggablePopup.style.top = `${newPosition.top}px`;
                }
            }
        });

        document.body.appendChild(popup);
        resizeObserver.observe(document.body);

        // Update the language change handler in showPopup function
        langSelect.addEventListener('change', async (e) => {
            const targetLang = e.target.value;
            const originalData = {
                word: data.selectedText,
                context: getContext(data.selectedText),
                originalDefinition: data.definition, // Store original contextual definition
                originalContext: data.context || getContext(data.selectedText)
            };
            
            try {
                // Get reference to the content div
                const popupContent = popup.querySelector('.popup-content > div:first-child');
                
                // Show loading state
                if (popupContent) {
                    popupContent.innerHTML = `
                        <div style="padding: 12px; background: ${colorScheme.hover}; border-radius: 8px;">
                            Translating to ${CONSTANTS.LANGUAGE_NAMES[targetLang]}...
                        </div>
                    `;
                }
                
                // Send translation request (no synonyms/examples)
                const response = await sendMessage({
                    type: 'TRANSLATE_DEFINITION',
                    word: originalData.word,
                    originalDefinition: originalData.originalDefinition,
                    context: originalData.context,
                    targetLanguage: targetLang,
                    preserveContext: true
                });

                if (response?.data) {
                    response.data.selectedText = originalData.word;
                    response.data.currentLanguage = targetLang;
                    response.data.context = originalData.context;
                    updateExistingPopup(popup, response.data);
                }
            } catch (error) {
                console.error('Translation error:', error);
                // Show error in popup content
                const popupContent = popup.querySelector('.popup-content > div:first-child');
                if (popupContent) {
                    popupContent.innerHTML = `
                        <div style="padding: 12px; background: ${colorScheme.hover}; border-radius: 8px; color: #ff5252;">
                            Failed to translate to ${CONSTANTS.LANGUAGE_NAMES[targetLang]}
                        </div>
                    `;
                }
                showError(`Failed to translate to ${CONSTANTS.LANGUAGE_NAMES[targetLang]}`);
                langSelect.value = data.currentLanguage || data.detectedLanguage;
            }
        });

        // In the showPopup function, update the language selector initialization
        if (langSelect) {
            // Set initial value to detected language
            langSelect.value = data.sourceLanguage || data.detectedLanguage || 'en';
            
            // Update options to show current language as default
            const currentLang = data.sourceLanguage || data.detectedLanguage;
            langSelect.innerHTML = Object.entries(CONSTANTS.LANGUAGE_NAMES).map(([code, name]) => `
                <option value="${code}" ${code === currentLang ? 'selected' : ''}>
                    ${code === currentLang ? `Original (${name})` : `Translate to ${name}`}
                </option>
            `).join('');
        }

        return popup;
    } catch (error) {
        console.error('Popup creation error:', error);
        // Clean up any partial popup that might have been created
        if (STATE.activePopup) {
            STATE.activePopup.remove();
            STATE.activePopup = null;
        }
        showError('Failed to create popup: ' + error.message);
        return null;
    }
}

// Update this helper function
function updateExistingPopup(popup, data) {
    const colorScheme = detectColorScheme();
    const popupContent = popup.querySelector('.popup-content > div:first-child');

    // Update main content only
    popupContent.innerHTML = data.definition || 'No definition available';

    // Update language selector to reflect current language
    const langSelect = popup.querySelector('.language-selector');
    if (langSelect && data.currentLanguage) {
        langSelect.value = data.currentLanguage;
    }

    return popup;
}

// Add new styles for animations
const fadeAnimation = document.createElement('style');
fadeAnimation.textContent = `
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(5px); }
        to { opacity: 1; transform: translateY(0); }
    }
`;
document.head.appendChild(fadeAnimation);

// Add shimmer animation
const style = document.createElement('style');
style.textContent = `
    @keyframes shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
    }
`;
document.head.appendChild(style);

// Add runtime connection listener
chrome.runtime.onConnect.addListener(port => {
    if (port.name === 'keepAlive') {
        port.onDisconnect.addListener(() => {
            STATE.isExtensionAlive = false;
            scheduleReconnect();
        });
    }
});

// Add tab activation listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "TAB_ACTIVATED") {
        initializeExtension();
    }
    if (message.type === "TAB_READY") {
        initializeExtension();
    }
    return true;
});

// Add interval cleanup
function clearAllIntervals() {
    if (STATE.pingInterval) clearInterval(STATE.pingInterval);
    if (STATE.connectionRetryTimeout) clearTimeout(STATE.connectionRetryTimeout);
    STATE.pingInterval = null;
    STATE.connectionRetryTimeout = null;
}

// Initialize on script load
initializeExtension();
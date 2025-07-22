# ShabdkoshAI – Context-aware AI Dictionary Chrome Extension

ShabdkoshAI is an intelligent Chrome extension that delivers instant, context-aware word definitions that understand how words are being used in context. Double-click any word or hold **Alt** and select a short phrase to get accurate, contextual definitions. Seamlessly integrated with your browsing experience, this extension helps you understand words in their natural context with AI-powered precision.

## Key Features

### Context-Aware Word Definitions
- Double-click any word or select phrases for instant, context-aware definitions
- Modern, draggable popup interface that works with your reading flow
- Automatic dark/light mode detection to match your system preferences
- Fast, non-intrusive, and lightweight design that works offline

### Smart Language Understanding
- Advanced AI that understands words in their context
- Works across different languages and scripts
- No more guessing which definition is right for the context
- Seamlessly integrated with your browsing experience

### How It Works
1. **Double-click** any word for instant definition in context
2. **Alt+select** short phrases for contextual understanding
3. Get the most relevant definition based on how the word is used
4. Continue reading without interruption

### Advanced User Experience
- Minimalist, distraction-free popup
- Language switcher dropdown
- Text-to-speech for pronunciation
- Robust error handling and recovery

## Installation

1. Install from Chrome Web Store (Coming Soon)
2. Or load unpacked:
   - Download this extension
   - Open Chrome Extensions (chrome://extensions/)
   - Enable Developer Mode
   - Click "Load Unpacked"
   - Select the extension directory

## Usage

- **Double-click** any word for instant definition
- **Alt+select** any short phrase (up to 3 words)
- Drag popup to reposition
- Select language from dropdown
- Click speaker icon for pronunciation

## Technical Details

### Project Structure
```
ShabdkoshAI/
├── src/
│   ├── background.js    # API handling and core logic
│   ├── contentScript.js # UI and popup management
│   ├── config.js       # Configuration settings
│   └── styles.css      # Styling and animations
├── icons/              # Extension icons
├── manifest.json       # Extension configuration
├── privacy_policy.md   # Privacy policy
└── README.md          # Documentation
```

## API Key Security

> **Note:**  
> The API key included in this extension is secured using Google Cloud Console restrictions.  
> - The key is restricted to requests from the official Chrome extension ID and the Chrome Web Store.
> - Even though the API key is visible in the source code (as required for Chrome extensions), it cannot be misused outside the allowed extension context.
> - For maximum security, always manage and rotate your API keys via Google Cloud Console.

## Future Improvements
- More language support
- Enhanced context analysis
- Offline mode support
- User preferences
- History tracking

## Privacy
See [privacy_policy.md](privacy_policy.md) for our privacy policy.

## License
MIT License - See LICENSE file for details

## Author
Ramesh Kumar

## Version
1.0.1
# AI Auto-Filler Extension (Manifest V3)

A background-running Google Chrome extension (Manifest V3) that detects web forms, extracts questions, queries AI via the OpenRouter API (`openrouter/free` model tier), and automatically injects answers into the DOM with synthetic input/change events.

---

## 📁 Project Architecture & Modularity

```text
Cheateria / ai-form-filler-project
├── ai_module/                  # Dedicated AI Module
│   ├── openrouter_client.js    # Secure fetch client with OpenRouter API
│   ├── prompt_builder.js       # Converts scraped form schema into LLM prompts
│   └── response_parser.js      # Robust JSON parsing and fallback extraction
├── extension_core/             # Dedicated Chrome Extension Directory
│   ├── manifest.json           # Manifest V3 configuration & permissions
│   ├── background.js           # Service worker orchestrating bridge & AI calls
│   ├── content_script.js       # DOM scraping, question extraction, & injection
│   ├── popup.html              # Clean extension popup user interface
│   ├── popup.js                # State management via chrome.storage.local
│   └── assets/                 # Extension icons (16px, 48px, 128px)
├── tests/                      # Dedicated Testing Directory
│   ├── test_ai_module.js       # Unit tests for prompt builder, client, & parser
│   ├── test_dom_parser.js      # Unit tests for DOM scraping & synthetic events
│   └── test_runner.html        # Interactive in-browser test suite & demo form
├── shared_config/
│   └── settings.js             # Shared default settings and storage keys
├── package.json
└── product_requirements_document.md
```

---

## 🚀 How to Install and Run in Chrome

1. Open Google Chrome and navigate to:
   ```text
   chrome://extensions
   ```
2. Enable **Developer mode** toggle in the top-right corner.
3. Click **Load unpacked**.
4. Select the project directory (`c:\Users\Ansh\Desktop\Vani\Projects\Cheateria` or `c:\Users\Ansh\Desktop\Vani\Projects\Cheateria\extension_core`).
5. The **AI Auto-Filler** extension icon will appear in the Chrome toolbar.

---

## ⚙️ Configuration

1. Click the extension icon in Chrome toolbar to open the popup.
2. Enter your [OpenRouter API Key](https://openrouter.ai/keys) (`sk-or-v1-...`).
3. Select an AI model (default: `openrouter/free` or choose another free/paid model).
4. *(Optional)* Add personal context/profile notes in the user context area (e.g. `Name: Jane Doe, Occupation: Software Engineer, Country: USA`).
5. Click **Save Settings**.

---

## 🧪 Running Unit Tests

Run the full automated test suite via Node:

```powershell
npm.cmd test
```

Or run individual test suites:

```powershell
node tests/test_ai_module.js
node tests/test_dom_parser.js
```

### Visual Browser Test Runner
Double-click or open `tests/test_runner.html` in Chrome:
- Execute all tests directly in browser.
- Test live DOM injection and watch real-time synthetic `input` and `change` event badges update on an interactive form!

# Product Requirements Document (PRD): AI Auto-Filler Extension

## 1. Project Overview
**Objective:** Build a highly modular, background-running Chrome extension (Manifest V3) that detects web forms, extracts questions, queries an AI via the OpenRouter API, and automatically injects the answers back into the DOM.
**Target Audience:** Personal productivity tool for automating data entry on repetitive forms.

## 2. Technical Stack & Architecture
*   **Platform:** Google Chrome Extension (Manifest V3).
*   **Languages:** Vanilla JavaScript (ES6 modules), HTML, CSS.
*   **AI Backend:** OpenRouter API (`openrouter/free` model).
*   **Storage:** `chrome.storage.local` for API key management.

### Directory Structure (Strict Modularity)
```text
/ai-form-filler-project
├── /ai_module                  # DEDICATED AI DIRECTORY
│   ├── openrouter_client.js    
│   ├── prompt_builder.js       
│   └── response_parser.js      
├── /extension_core             # DEDICATED CHROME EXTENSION DIRECTORY
│   ├── manifest.json           
│   ├── background.js           
│   ├── content_script.js       
│   ├── popup.html              
│   ├── popup.js                
│   └── /assets                 
│       └── [dummy icons]
├── /tests                      # DEDICATED TESTING DIRECTORY
│   ├── test_ai_module.js
│   └── test_dom_parser.js
└── /shared_config
    └── settings.js             
```

## 3. Workflow & Task Checklist

### Phase 1: Project Setup & Extension Framework
- [ ] Initialize directory structure.
- [ ] Create `manifest.json` with correct Manifest V3 permissions (`activeTab`, `storage`, `scripting`).
- [ ] Set up basic dummy icons in `/assets`.
- [ ] Create basic `background.js` and `content_script.js` to verify extension loads correctly.

### Phase 2: User Interface & State Management
- [ ] Build `popup.html` (minimal UI with API key input and on/off toggle).
- [ ] Implement `popup.js` to save/retrieve API key using `chrome.storage.local`.
- [ ] Create `settings.js` in `/shared_config` to store default model configuration.

### Phase 3: AI Module Integration (`/ai_module`)
- [ ] Write `openrouter_client.js` to handle secure `fetch` requests to OpenRouter.
- [ ] Write `prompt_builder.js` to convert scraped form JSON into a structured LLM prompt.
- [ ] Write `response_parser.js` to safely parse the AI's JSON output.

### Phase 4: DOM Interaction (`/extension_core`)
- [ ] Update `content_script.js` to scan the DOM for `<input>`, `<textarea>`, and `<select>` fields.
- [ ] Implement logic to extract associated `<label>` text or placeholder text as the "question".
- [ ] Implement DOM injection logic to fill fields and dispatch synthetic `input`/`change` events.

### Phase 5: Bridge & Integration
- [ ] Set up message passing between `content_script.js` and `background.js`.
- [ ] Connect `background.js` to the `ai_module` to process incoming form data and return answers.

## 4. Testing Strategy (Progress Mode)
To ensure each module works independently, we will use unit tests at each phase before integration.

**Unit Test Plan:**
1.  **AI Module Testing:**
    *   *Task:* Mock an API call to `openrouter_client.js` using a dummy API key to ensure it returns a valid 200 OK response.
    *   *Task:* Pass sample JSON to `prompt_builder.js` to verify string output structure.
2.  **DOM Parser Testing:**
    *   *Task:* Create a dummy HTML page with 3 form fields. Run `content_script.js` functions locally to ensure it correctly maps `id`, `type`, and `label` to a JSON object.
3.  **Data Injection Testing:**
    *   *Task:* Feed a mock JSON response (simulating AI output) to the injection function and verify if the dummy HTML form values update properly and trigger `change` events.
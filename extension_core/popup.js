/**
 * Popup UI Controller
 * Manages configuration storage, validates runtime environment,
 * and initiates autofill commands with automated fallback injection.
 */

import { DEFAULT_SETTINGS, STORAGE_KEYS, MESSAGE_TYPES } from './shared_config/settings.js';
import { queryOpenRouter } from './ai_module/openrouter_client.js';
import { buildPrompt } from './ai_module/prompt_builder.js';
import { parseFormAnswers } from './ai_module/response_parser.js';

console.log('[AI Auto-Filler Popup] Initializing popup controller...');

// DOM elements
const apiKeyInput = document.getElementById('apiKey');
const toggleApiKeyBtn = document.getElementById('toggleApiKeyBtn');
const modelSelect = document.getElementById('modelSelect');
const customModelGroup = document.getElementById('customModelGroup');
const customModelInput = document.getElementById('customModel');
const userContextInput = document.getElementById('userContext');
const enabledToggle = document.getElementById('enabledToggle');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const fillCurrentPageBtn = document.getElementById('fillCurrentPageBtn');
const statusMessage = document.getElementById('statusMessage');

let statusTimeout = null;

function showStatus(text, type = 'info', duration = 4000) {
  if (statusTimeout) clearTimeout(statusTimeout);
  statusMessage.textContent = text;
  statusMessage.className = type;
  console.log(`[AI Auto-Filler Popup] Status message [${type}]:`, text);
  if (duration > 0) {
    statusTimeout = setTimeout(() => {
      statusMessage.className = '';
      statusMessage.textContent = '';
    }, duration);
  }
}

// Load saved configuration from chrome.storage.local
async function loadSettings() {
  console.log('[AI Auto-Filler Popup] Loading settings from chrome.storage.local...');
  try {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.API_KEY,
      STORAGE_KEYS.MODEL,
      STORAGE_KEYS.ENABLED,
      STORAGE_KEYS.USER_CONTEXT
    ]);

    console.log('[AI Auto-Filler Popup] Retrieved stored data:', {
      hasKey: Boolean(data[STORAGE_KEYS.API_KEY]),
      model: data[STORAGE_KEYS.MODEL],
      enabled: data[STORAGE_KEYS.ENABLED],
      hasContext: Boolean(data[STORAGE_KEYS.USER_CONTEXT])
    });

    if (data[STORAGE_KEYS.API_KEY]) {
      apiKeyInput.value = data[STORAGE_KEYS.API_KEY];
    }

    const savedModel = data[STORAGE_KEYS.MODEL] || DEFAULT_SETTINGS.model;
    const knownOptions = Array.from(modelSelect.options).map(o => o.value);

    if (knownOptions.includes(savedModel)) {
      modelSelect.value = savedModel;
      customModelGroup.style.display = 'none';
    } else {
      modelSelect.value = 'custom';
      customModelInput.value = savedModel;
      customModelGroup.style.display = 'block';
    }

    if (data[STORAGE_KEYS.ENABLED] !== undefined) {
      enabledToggle.checked = Boolean(data[STORAGE_KEYS.ENABLED]);
    } else {
      enabledToggle.checked = DEFAULT_SETTINGS.enabled;
    }

    if (data[STORAGE_KEYS.USER_CONTEXT]) {
      userContextInput.value = data[STORAGE_KEYS.USER_CONTEXT];
    }
  } catch (err) {
    console.error('[AI Auto-Filler Popup] Failed to load settings:', err);
    showStatus('Failed to load settings from storage', 'error');
  }
}

// Save settings to chrome.storage.local
async function saveSettings(silent = false) {
  console.log('[AI Auto-Filler Popup] Saving settings to chrome.storage.local...');
  const apiKey = apiKeyInput.value.trim();
  const selectedModelVal = modelSelect.value;
  const model = selectedModelVal === 'custom'
    ? (customModelInput.value.trim() || DEFAULT_SETTINGS.model)
    : selectedModelVal;
  const isEnabled = enabledToggle.checked;
  const userContext = userContextInput.value.trim();

  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.API_KEY]: apiKey,
      [STORAGE_KEYS.MODEL]: model,
      [STORAGE_KEYS.ENABLED]: isEnabled,
      [STORAGE_KEYS.USER_CONTEXT]: userContext
    });

    console.log('[AI Auto-Filler Popup] Settings saved successfully. Model:', model, 'Enabled:', isEnabled);

    if (!silent) {
      showStatus('Settings saved successfully!', 'success');
    }
    return true;
  } catch (err) {
    console.error('[AI Auto-Filler Popup] Save failed:', err);
    showStatus(`Save failed: ${err.message}`, 'error');
    return false;
  }
}

// Auto-fill active tab with resilient dual-route execution
async function triggerAutofill() {
  console.log('[AI Auto-Filler Popup] Auto-Fill initiated by user click.');
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    console.warn('[AI Auto-Filler Popup] API key missing.');
    showStatus('Please enter your OpenRouter API key first.', 'error');
    apiKeyInput.focus();
    return;
  }

  // Persist current settings first
  await saveSettings(true);

  if (!enabledToggle.checked) {
    console.warn('[AI Auto-Filler Popup] Extension is disabled via toggle.');
    showStatus('Auto-filler is disabled. Turn the toggle ON.', 'error');
    return;
  }

  fillCurrentPageBtn.disabled = true;
  showStatus('Connecting to active page...', 'info', 0);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error('No active browser tab detected.');
    }

    console.log('[AI Auto-Filler Popup] Active tab detected:', { id: tab.id, url: tab.url, title: tab.title });

    // Validate that current tab allows content script execution
    const tabUrl = tab.url || '';
    if (
      tabUrl.startsWith('chrome://') ||
      tabUrl.startsWith('chrome-extension://') ||
      tabUrl.startsWith('edge://') ||
      tabUrl.startsWith('about:') ||
      tabUrl.startsWith('devtools://') ||
      tabUrl.startsWith('https://chromewebstore.google.com')
    ) {
      throw new Error('Cannot run on internal browser pages (chrome://). Please navigate to a standard webpage with a form.');
    }

    if (tabUrl.startsWith('file://')) {
      console.log('[AI Auto-Filler Popup] Note: Running on file:// URL. "Allow access to file URLs" must be enabled in chrome://extensions.');
    }

    showStatus('Scanning form fields...', 'info', 0);

    // Route 1: Try standard message passing
    let handled = false;
    try {
      console.log('[AI Auto-Filler Popup] Attempting standard message passing route...');
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: MESSAGE_TYPES.FILL_FORM
      });

      if (response) {
        handled = true;
        if (response.success) {
          console.log(`[AI Auto-Filler Popup] Message passing autofill succeeded! Injected ${response.filledCount} fields.`);
          showStatus(`Done! Injected ${response.filledCount || 0} fields.`, 'success');
        } else {
          console.error('[AI Auto-Filler Popup] Autofill returned error:', response.error);
          showStatus(`Error: ${response.error || 'Failed to fill form.'}`, 'error');
        }
        return;
      }
    } catch (sendErr) {
      console.warn('[AI Auto-Filler Popup] Standard message passing was not available on this tab:', sendErr.message);
      // Proceed to resilient Route 2
    }

    if (!handled) {
      console.log('[AI Auto-Filler Popup] Initiating resilient programmatic injection route via chrome.scripting...');
      showStatus('Injecting scanner into page...', 'info', 0);

      // Determine script file path relative to extension root
      const manifest = chrome.runtime.getManifest();
      const scriptPath = manifest?.content_scripts?.[0]?.js?.[0] || 'content_script.js';

      console.log(`[AI Auto-Filler Popup] Injecting ${scriptPath} via chrome.scripting.executeScript...`);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [scriptPath]
      });

      // Brief delay to ensure DOM execution
      await new Promise(r => setTimeout(r, 100));

      // Extract form fields directly from page context
      console.log('[AI Auto-Filler Popup] Extracting form fields from active tab DOM...');
      const scanResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          if (window.__AIAutoFiller && window.__AIAutoFiller.extractFormFields) {
            return window.__AIAutoFiller.extractFormFields();
          }
          return [];
        }
      });

      const extractedFields = scanResults?.[0]?.result || [];
      console.log(`[AI Auto-Filler Popup] Extracted ${extractedFields.length} fields:`, extractedFields);

      if (extractedFields.length === 0) {
        showStatus('No fillable form fields found on this page.', 'error');
        return;
      }

      showStatus(`Found ${extractedFields.length} fields. Querying OpenRouter AI...`, 'info', 0);

      // Query AI (try via background first, or direct from popup)
      const selectedModelVal = modelSelect.value;
      const model = selectedModelVal === 'custom'
        ? (customModelInput.value.trim() || DEFAULT_SETTINGS.model)
        : selectedModelVal;
      const userContext = userContextInput.value.trim();

      let answers = null;
      try {
        console.log('[AI Auto-Filler Popup] Requesting background service worker to process form...');
        const bgRes = await chrome.runtime.sendMessage({
          action: 'PROCESS_FORM',
          fields: extractedFields
        });

        if (bgRes && bgRes.success && bgRes.answers) {
          answers = bgRes.answers;
        } else {
          throw new Error(bgRes?.error || 'Background service returned an error.');
        }
      } catch (bgErr) {
        console.warn('[AI Auto-Filler Popup] Background service unreachable, executing AI call directly in popup:', bgErr.message);
        const messages = buildPrompt(extractedFields, userContext);
        const aiRes = await queryOpenRouter({ apiKey, model, messages });
        const parsed = parseFormAnswers(aiRes.content);
        answers = parsed.answers;
      }

      console.log('[AI Auto-Filler Popup] AI answers obtained:', answers);
      showStatus('Injecting AI answers into form...', 'info', 0);

      // Inject answers back into page DOM
      const injectResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (ans) => {
          if (window.__AIAutoFiller && window.__AIAutoFiller.injectAnswers) {
            return window.__AIAutoFiller.injectAnswers(ans);
          }
          return 0;
        },
        args: [answers]
      });

      const filledCount = injectResults?.[0]?.result || 0;
      console.log(`[AI Auto-Filler Popup] Successfully injected answers into ${filledCount} fields!`);
      showStatus(`Done! Injected ${filledCount} fields.`, 'success');
    }
  } catch (err) {
    console.error('[AI Auto-Filler Popup] Autofill execution error:', err);
    showStatus(err.message || 'Failed to communicate with active tab.', 'error');
  } finally {
    fillCurrentPageBtn.disabled = false;
  }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  console.log('[AI Auto-Filler Popup] DOM fully loaded.');
  loadSettings();

  toggleApiKeyBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleApiKeyBtn.textContent = 'Hide';
    } else {
      apiKeyInput.type = 'password';
      toggleApiKeyBtn.textContent = 'Show';
    }
  });

  modelSelect.addEventListener('change', () => {
    customModelGroup.style.display = modelSelect.value === 'custom' ? 'block' : 'none';
  });

  enabledToggle.addEventListener('change', () => {
    saveSettings(true);
  });

  saveSettingsBtn.addEventListener('click', () => {
    saveSettings(false);
  });

  fillCurrentPageBtn.addEventListener('click', () => {
    triggerAutofill();
  });
});

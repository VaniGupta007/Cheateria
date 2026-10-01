/**
 * Popup UI Controller
 * Manages configuration storage and initiates autofill commands.
 */

import { DEFAULT_SETTINGS, STORAGE_KEYS, MESSAGE_TYPES } from '../shared_config/settings.js';

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

function showStatus(text, type = 'info', duration = 3500) {
  if (statusTimeout) clearTimeout(statusTimeout);
  statusMessage.textContent = text;
  statusMessage.className = type;
  if (duration > 0) {
    statusTimeout = setTimeout(() => {
      statusMessage.className = '';
      statusMessage.textContent = '';
    }, duration);
  }
}

// Load saved configuration from chrome.storage.local
async function loadSettings() {
  try {
    const data = await chrome.storage.local.get([
      STORAGE_KEYS.API_KEY,
      STORAGE_KEYS.MODEL,
      STORAGE_KEYS.ENABLED,
      STORAGE_KEYS.USER_CONTEXT
    ]);

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
    console.error('Failed to load settings:', err);
    showStatus('Failed to load settings', 'error');
  }
}

// Save settings to chrome.storage.local
async function saveSettings(silent = false) {
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

    if (!silent) {
      showStatus('Settings saved successfully!', 'success');
    }
    return true;
  } catch (err) {
    console.error('Failed to save settings:', err);
    showStatus(`Save failed: ${err.message}`, 'error');
    return false;
  }
}

// Auto-fill active tab
async function triggerAutofill() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    showStatus('Please enter your OpenRouter API key first.', 'error');
    apiKeyInput.focus();
    return;
  }

  // Save current settings first
  await saveSettings(true);

  if (!enabledToggle.checked) {
    showStatus('Auto-filler is disabled. Turn the toggle ON.', 'error');
    return;
  }

  fillCurrentPageBtn.disabled = true;
  showStatus('Scanning page and querying AI...', 'info', 0);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error('No active browser tab detected.');
    }

    // Ping content script to initiate scan and fill
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: MESSAGE_TYPES.FILL_FORM
    });

    if (!response) {
      throw new Error('Could not communicate with the page. Try refreshing the page.');
    }

    if (response.success) {
      showStatus(`Done! Injected ${response.filledCount || 0} fields.`, 'success');
    } else {
      showStatus(`Error: ${response.error || 'Failed to fill form.'}`, 'error');
    }
  } catch (err) {
    console.error('Autofill trigger failed:', err);
    showStatus(err.message || 'Failed to communicate with active tab.', 'error');
  } finally {
    fillCurrentPageBtn.disabled = false;
  }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
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

/**
 * Background Service Worker
 * Orchestrates AI queries between content script, storage, and OpenRouter API.
 */

import { DEFAULT_SETTINGS, STORAGE_KEYS } from './shared_config/settings.js';
import { queryOpenRouter } from './ai_module/openrouter_client.js';
import { buildPrompt } from './ai_module/prompt_builder.js';
import { parseFormAnswers } from './ai_module/response_parser.js';

// Setup default configuration on extension installation
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get([
    STORAGE_KEYS.MODEL,
    STORAGE_KEYS.ENABLED
  ]);

  const updates = {};
  if (existing[STORAGE_KEYS.MODEL] === undefined) {
    updates[STORAGE_KEYS.MODEL] = DEFAULT_SETTINGS.model;
  }
  if (existing[STORAGE_KEYS.ENABLED] === undefined) {
    updates[STORAGE_KEYS.ENABLED] = DEFAULT_SETTINGS.enabled;
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
  console.log('AI Auto-Filler extension installed and initialized.');
});

// Central message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'PROCESS_FORM') {
    handleProcessForm(request.fields)
      .then(result => sendResponse(result))
      .catch(err => {
        console.error('Error handling PROCESS_FORM:', err);
        sendResponse({ success: false, error: err.message || 'Failed to process form.' });
      });

    return true; // Keep message channel open for async response
  }

  if (request.action === 'PING') {
    sendResponse({ success: true, message: 'Background service worker active.' });
    return true;
  }
});

/**
 * Handles end-to-end form processing: fetches settings, queries AI, parses answers.
 *
 * @param {Array<Object>} fields - Extracted form fields.
 * @returns {Promise<{ success: boolean, answers?: Record<string, any>, error?: string }>}
 */
async function handleProcessForm(fields) {
  if (!fields || !Array.isArray(fields) || fields.length === 0) {
    return { success: false, error: 'No fields provided for AI processing.' };
  }

  // 1. Retrieve settings from storage
  const storageData = await chrome.storage.local.get([
    STORAGE_KEYS.API_KEY,
    STORAGE_KEYS.MODEL,
    STORAGE_KEYS.ENABLED,
    STORAGE_KEYS.USER_CONTEXT
  ]);

  const isEnabled = storageData[STORAGE_KEYS.ENABLED] ?? DEFAULT_SETTINGS.enabled;
  if (!isEnabled) {
    return { success: false, error: 'AI Auto-Filler is currently disabled in settings.' };
  }

  const apiKey = storageData[STORAGE_KEYS.API_KEY];
  if (!apiKey || !apiKey.trim()) {
    return {
      success: false,
      error: 'OpenRouter API key is missing. Click the AI Auto-Filler extension icon to add your API key.'
    };
  }

  const model = storageData[STORAGE_KEYS.MODEL] || DEFAULT_SETTINGS.model;
  const userContext = storageData[STORAGE_KEYS.USER_CONTEXT] || '';

  // 2. Build structured prompt
  const messages = buildPrompt(fields, userContext);

  // 3. Query OpenRouter
  console.log(`Querying OpenRouter with model ${model} for ${fields.length} fields...`);
  const aiResult = await queryOpenRouter({
    apiKey,
    model,
    messages
  });

  // 4. Safely parse AI response
  const { answers } = parseFormAnswers(aiResult.content);

  return {
    success: true,
    answers
  };
}

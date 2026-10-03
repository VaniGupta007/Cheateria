/**
 * Background service worker: owns build-time configuration and OpenRouter calls.
 */

import { MESSAGE_TYPES } from '../shared_config/settings.js';
import { RUNTIME_CONFIG } from '../shared_config/runtime_config.js';
import { processForm } from '../ai_module/form_processor.js';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === MESSAGE_TYPES.PROCESS_FORM) {
    processForm({
      fields: request.fields,
      instruction: request.instruction,
      apiKey: RUNTIME_CONFIG.openRouterApiKey,
      model: RUNTIME_CONFIG.openRouterModel
    })
      .then(result => {
        if (result.qualityChecks) {
          console.info('Form processing quality checks:', result.qualityChecks);
        }
        sendResponse(result);
      })
      .catch(error => {
        console.error('Form processing failed:', error);
        sendResponse({ success: false, error: error.message || 'Failed to process the form.' });
      });
    return true;
  }

  if (request.action === MESSAGE_TYPES.PING) {
    sendResponse({ success: true });
  }
});

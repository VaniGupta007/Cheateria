/**
 * Shared configuration and constants for AI Auto-Filler Extension.
 */

export const DEFAULT_SETTINGS = {
  // OpenRouter Free model tier per PRD specification
  model: 'openrouter/free',
  // API Endpoint
  apiEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
  // Extension metadata for OpenRouter headers
  siteUrl: 'https://github.com/ai-form-filler-extension',
  siteName: 'AI Auto-Filler Extension',
  // Default extension enabled state
  enabled: true,
  // Optional user persona/context to guide form answers
  userContext: ''
};

export const STORAGE_KEYS = {
  API_KEY: 'openrouter_api_key',
  MODEL: 'autofill_model',
  ENABLED: 'autofill_enabled',
  USER_CONTEXT: 'autofill_user_context'
};

export const MESSAGE_TYPES = {
  FILL_FORM: 'FILL_FORM',
  FORM_DATA_EXTRACTED: 'FORM_DATA_EXTRACTED',
  INJECT_ANSWERS: 'INJECT_ANSWERS',
  TEST_API_KEY: 'TEST_API_KEY',
  GET_STATUS: 'GET_STATUS'
};

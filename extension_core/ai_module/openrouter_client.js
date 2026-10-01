/**
 * OpenRouter API Client Module
 * Handles secure communication with the OpenRouter API.
 */

import { DEFAULT_SETTINGS } from '../shared_config/settings.js';

/**
 * Sends a chat completion request to the OpenRouter API.
 *
 * @param {Object} options
 * @param {string} options.apiKey - The OpenRouter API key.
 * @param {Array<{ role: string, content: string }>} options.messages - Chat messages.
 * @param {string} [options.model] - Model identifier (default: settings.DEFAULT_SETTINGS.model).
 * @param {string} [options.endpoint] - API Endpoint URL.
 * @param {string} [options.siteUrl] - Application URL for OpenRouter ranking.
 * @param {string} [options.siteName] - Application title for OpenRouter ranking.
 * @param {Function} [options.fetchFn] - Custom fetch function (useful for mock unit testing).
 * @returns {Promise<{ content: string, raw: Object }>} AI response text and full payload.
 */
export async function queryOpenRouter({
  apiKey,
  messages,
  model = DEFAULT_SETTINGS.model,
  endpoint = DEFAULT_SETTINGS.apiEndpoint,
  siteUrl = DEFAULT_SETTINGS.siteUrl,
  siteName = DEFAULT_SETTINGS.siteName,
  fetchFn = (typeof fetch !== 'undefined' ? fetch : null)
}) {
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('OpenRouter API key is required. Please set it in the extension settings.');
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('Messages array cannot be empty.');
  }

  if (!fetchFn) {
    throw new Error('Fetch implementation is not available in the current environment.');
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey.trim()}`,
    'HTTP-Referer': siteUrl || 'https://github.com/ai-form-filler-extension',
    'X-Title': siteName || 'AI Auto-Filler'
  };

  const payload = {
    model: model || DEFAULT_SETTINGS.model,
    messages
  };

  let response;
  try {
    response = await fetchFn(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  } catch (networkError) {
    throw new Error(`Network error contacting OpenRouter API: ${networkError.message}`);
  }

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson.error?.message || JSON.stringify(errJson);
    } catch {
      errorDetail = await response.text().catch(() => '');
    }

    if (response.status === 401) {
      throw new Error(`Authentication failed (401): Invalid OpenRouter API key. ${errorDetail}`.trim());
    } else if (response.status === 402) {
      throw new Error(`Payment required (402): Insufficient OpenRouter credits. ${errorDetail}`.trim());
    } else if (response.status === 429) {
      throw new Error(`Rate limit exceeded (429): Please try again in a few moments. ${errorDetail}`.trim());
    } else {
      throw new Error(`OpenRouter API error (HTTP ${response.status}): ${errorDetail || response.statusText}`);
    }
  }

  const data = await response.json();
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;

  if (!content) {
    throw new Error('OpenRouter returned an empty response choice.');
  }

  return {
    content,
    raw: data
  };
}

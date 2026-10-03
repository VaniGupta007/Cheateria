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
 * @param {Object} [options.responseFormat] - Optional OpenAI-compatible response format.
 * @returns {Promise<{ content: string, raw: Object }>} AI response text and full payload.
 */
export async function queryOpenRouter({
  apiKey,
  messages,
  model,
  endpoint = DEFAULT_SETTINGS.apiEndpoint,
  siteUrl = DEFAULT_SETTINGS.siteUrl,
  siteName = DEFAULT_SETTINGS.siteName,
  responseFormat,
  fetchFn = (typeof fetch !== 'undefined' ? fetch : null)
}) {
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('OpenRouter API key is missing from the built extension configuration.');
  }

  if (!model || typeof model !== 'string' || !model.trim()) {
    throw new Error('OpenRouter model is missing from the built extension configuration.');
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
    model: model.trim(),
    messages,
    temperature: 0,
    max_tokens: 4096
  };
  if (responseFormat) {
    payload.response_format = responseFormat;
    payload.plugins = [{ id: 'response-healing' }];
  }

  async function send(requestPayload) {
    try {
      return await fetchFn(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload)
      });
    } catch (networkError) {
      throw new Error(`Network error contacting OpenRouter API: ${networkError.message}`);
    }
  }

  let response = await send(payload);
  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson.error?.message || JSON.stringify(errJson);
    } catch {
      errorDetail = await response.text().catch(() => '');
    }

    const formatUnsupported = responseFormat && response.status === 400 &&
      /response[_ -]?format|json mode|structured output/i.test(errorDetail);
    if (formatUnsupported) {
      const fallbackPayload = { ...payload };
      if (responseFormat?.type === 'json_schema') {
        fallbackPayload.response_format = { type: 'json_object' };
      } else {
        delete fallbackPayload.response_format;
      }
      response = await send(fallbackPayload);
      if (response.ok) return parseSuccessfulResponse(response);
      try {
        const fallbackError = await response.json();
        errorDetail = fallbackError.error?.message || JSON.stringify(fallbackError);
      } catch {
        errorDetail = await response.text().catch(() => errorDetail);
      }

      const jsonModeUnsupported = responseFormat?.type === 'json_schema' && response.status === 400 &&
        /response[_ -]?format|json mode|structured output|json[_ -]?schema/i.test(errorDetail);
      if (jsonModeUnsupported) {
        delete fallbackPayload.response_format;
        response = await send(fallbackPayload);
        if (response.ok) return parseSuccessfulResponse(response);
        try {
          const finalError = await response.json();
          errorDetail = finalError.error?.message || JSON.stringify(finalError);
        } catch {
          errorDetail = await response.text().catch(() => errorDetail);
        }
      }
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

  return parseSuccessfulResponse(response);
}

async function parseSuccessfulResponse(response) {
  const data = await response.json();
  const choice = data?.choices?.[0];
  const rawContent = choice?.message?.content;
  const content = Array.isArray(rawContent)
    ? rawContent.map(part => typeof part === 'string' ? part : part?.text || '').join('')
    : typeof rawContent === 'object' && rawContent !== null
      ? JSON.stringify(rawContent)
      : rawContent;

  if (typeof content !== 'string' || !content.trim()) {
    const finishReason = choice?.finish_reason || choice?.native_finish_reason || 'unknown';
    const completionTokens = data?.usage?.completion_tokens;
    const model = data?.model || 'unknown model';
    const refusal = choice?.message?.refusal;
    const detail = refusal
      ? ` The model refused the request: ${String(refusal).slice(0, 300)}`
      : ` Model: ${model}; finish reason: ${finishReason}` +
        (Number.isFinite(completionTokens) ? `; completion tokens: ${completionTokens}.` : '.');
    const error = new Error(`OpenRouter returned an empty response choice.${detail}`);
    error.retryable = !refusal;
    throw error;
  }

  return {
    content,
    raw: data
  };
}

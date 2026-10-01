/**
 * Response Parser Module
 * Safely extracts and validates JSON form answers from LLM output.
 */

/**
 * Extracts JSON content from raw LLM string, handling markdown blocks and preambles.
 *
 * @param {string} rawText - Raw text output from LLM.
 * @returns {Object} Parsed JSON object.
 * @throws {Error} If valid JSON cannot be found or parsed.
 */
export function extractJsonFromText(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new Error('Empty or invalid response received from AI model.');
  }

  const trimmed = rawText.trim();

  // Try parsing directly if clean JSON
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue with pattern matching
  }

  // Check for markdown code fences (```json ... ``` or ``` ...)
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Continue searching for brackets
    }
  }

  // Find outermost curly braces { ... }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch (err) {
      throw new Error(`Failed to parse extracted JSON object: ${err.message}`);
    }
  }

  throw new Error('No valid JSON object found in AI response.');
}

/**
 * Parses and normalizes form answers from AI model response.
 *
 * @param {string|Object} rawResponse - Either the raw string content or parsed response object.
 * @returns {{ answers: Record<string, any> }}
 */
export function parseFormAnswers(rawResponse) {
  let parsed;
  if (typeof rawResponse === 'string') {
    parsed = extractJsonFromText(rawResponse);
  } else if (typeof rawResponse === 'object' && rawResponse !== null) {
    parsed = rawResponse;
  } else {
    throw new Error('Invalid response type passed to parseFormAnswers.');
  }

  // Support both {"answers": { "field": "val" }} and direct { "field": "val" }
  let answers = null;
  if (parsed.answers && typeof parsed.answers === 'object' && !Array.isArray(parsed.answers)) {
    answers = parsed.answers;
  } else if (typeof parsed === 'object' && !Array.isArray(parsed)) {
    answers = parsed;
  }

  if (!answers || typeof answers !== 'object') {
    throw new Error('Parsed response does not contain a valid answers dictionary.');
  }

  return { answers };
}


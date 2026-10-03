/**
 * Safe JSON recovery and schema parsing for model responses.
 */

function removeTrailingCommas(jsonText) {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < jsonText.length; index++) {
    const character = jsonText[index];
    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }

    if (character === ',') {
      let nextIndex = index + 1;
      while (/\s/.test(jsonText[nextIndex] || '')) nextIndex++;
      if (jsonText[nextIndex] === '}' || jsonText[nextIndex] === ']') continue;
    }
    result += character;
  }

  return result;
}

function findBalancedObjects(text) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') {
      if (depth === 0) start = index;
      depth++;
    } else if (character === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function parseCandidate(candidate) {
  const normalized = candidate.replace(/^\uFEFF/, '').trim();
  try {
    return JSON.parse(normalized);
  } catch (originalError) {
    const withoutTrailingCommas = removeTrailingCommas(normalized);
    if (withoutTrailingCommas !== normalized) {
      return JSON.parse(withoutTrailingCommas);
    }
    throw originalError;
  }
}

/**
 * Returns every independently parseable JSON object in a model response.
 * This safely handles prose, code fences, trailing commas, and concatenated
 * objects such as `{...}{...}` without using eval or arbitrary code repair.
 */
export function extractJsonValuesFromText(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new Error('The model returned an empty response.');
  }

  const trimmed = rawText.replace(/^\uFEFF/, '').trim();
  try {
    return [parseCandidate(trimmed)];
  } catch {
    // Continue with bounded object extraction.
  }

  const sources = [];
  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) {
    sources.push(match[1]);
  }
  sources.push(trimmed);

  const parsedValues = [];
  const seenCandidates = new Set();
  let lastError = null;

  for (const source of sources) {
    for (const candidate of findBalancedObjects(source)) {
      if (seenCandidates.has(candidate)) continue;
      seenCandidates.add(candidate);
      try {
        parsedValues.push(parseCandidate(candidate));
      } catch (error) {
        lastError = error;
      }
    }
  }

  if (parsedValues.length === 0) {
    const detail = lastError?.message ? ` ${lastError.message}` : '';
    throw new Error(`The model response did not contain valid JSON.${detail}`);
  }
  return parsedValues;
}

export function extractJsonFromText(rawText) {
  return extractJsonValuesFromText(rawText)[0];
}

function getCandidates(rawResponse) {
  if (typeof rawResponse === 'string') return extractJsonValuesFromText(rawResponse);
  if (rawResponse && typeof rawResponse === 'object' && !Array.isArray(rawResponse)) return [rawResponse];
  throw new Error('The model returned an unsupported response type.');
}

export function parseFormAnswers(rawResponse) {
  const candidates = getCandidates(rawResponse);
  const wrapped = candidates.find(candidate => candidate && Object.hasOwn(candidate, 'answers'));
  const parsed = wrapped || candidates.find(candidate => candidate && typeof candidate === 'object' && !Array.isArray(candidate));
  const answers = wrapped ? parsed.answers : parsed;

  if (Array.isArray(answers)) {
    const normalized = {};
    for (const entry of answers) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
          typeof entry.key !== 'string' || !entry.key.trim() ||
          !Object.hasOwn(entry, 'value') || !Object.hasOwn(entry, 'confidence')) {
        throw new Error('The generation response contains an invalid answer entry.');
      }
      const key = entry.key.trim();
      if (Object.hasOwn(normalized, key)) {
        throw new Error(`The generation response contains a duplicate answer key: ${key}.`);
      }
      normalized[key] = { value: entry.value, confidence: entry.confidence };
    }
    return { answers: normalized };
  }

  if (!answers || typeof answers !== 'object') {
    throw new Error('The generation response does not contain an answers object.');
  }
  return { answers };
}

export function parseImprovementIntent(rawResponse) {
  const candidates = getCandidates(rawResponse);
  const parsed = candidates.find(candidate => Array.isArray(candidate?.targetKeys));
  if (!parsed) {
    throw new Error('The intent response does not contain a targetKeys array.');
  }

  const targetKeys = [...new Set(parsed.targetKeys
    .filter(key => typeof key === 'string' && key.trim())
    .map(key => key.trim()))];

  return {
    targetKeys,
    request: typeof parsed.request === 'string' ? parsed.request.trim() : '',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : NaN
  };
}

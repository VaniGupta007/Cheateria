const JSON_RESPONSE_FORMAT = { type: 'json_object' };

export const INTENT_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'form_intent',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        targetKeys: { type: 'array', items: { type: 'string' } },
        request: { type: 'string' },
        confidence: { type: 'number', minimum: 0, maximum: 1 }
      },
      required: ['targetKeys', 'request', 'confidence'],
      additionalProperties: false
    }
  }
};

export const ANSWER_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'form_answers',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        answers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: {
                anyOf: [
                  { type: 'string' },
                  { type: 'number' },
                  { type: 'boolean' },
                  { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } }
                ]
              },
              confidence: { type: 'number', minimum: 0, maximum: 1 }
            },
            required: ['key', 'value', 'confidence'],
            additionalProperties: false
          }
        }
      },
      required: ['answers'],
      additionalProperties: false
    }
  }
};

export function validateFormSchema(fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error('No form fields were found on this page.');
  }
  if (fields.length > 500) {
    throw new Error('The form contains too many fields to process safely.');
  }

  const keys = new Set();
  fields.forEach((field, index) => {
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      throw new Error(`Field ${index + 1} has an invalid schema.`);
    }
    const key = field.trackingId || field.key || field.id || field.name;
    if (!key || typeof key !== 'string') {
      throw new Error(`Field ${index + 1} is missing a stable identifier.`);
    }
    if (keys.has(key)) {
      throw new Error(`Duplicate form field identifier: ${key}.`);
    }
    keys.add(key);
  });
}

function validateModelContent(content, stageName) {
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error(`${stageName} returned empty content.`);
  }
  if (content.length > 1_000_000) {
    throw new Error(`${stageName} returned an unexpectedly large response.`);
  }
}

function correctionMessage(stageName, error) {
  return {
    role: 'user',
    content: [
      `QUALITY CHECK FAILED FOR ${stageName.toUpperCase()}: ${error.message}`,
      'Return exactly one valid JSON object matching the requested schema.',
      'For a multi-option checkbox, value must be one JSON array containing every selected option.',
      'Do not include markdown, prose, comments, duplicate JSON objects, or trailing commas.'
    ].join('\n')
  };
}

/**
 * Executes a JSON-producing model stage with validation and one clean retry.
 */
export async function runCheckedJsonStage({
  stageName,
  messages,
  request,
  queryFn,
  parse,
  validate = value => value,
  maxAttempts = 3,
  responseFormat = JSON_RESPONSE_FORMAT
}) {
  let lastError;
  let attemptMessages = messages;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let result;
    try {
      result = await queryFn({
        ...request,
        messages: attemptMessages,
        responseFormat
      });
    } catch (error) {
      lastError = error;
      const retryable = error?.retryable === true ||
        /network error|rate limit|\b429\b|http 5\d\d|empty response choice/i.test(error?.message || '');
      console.warn(`${stageName} request failed on attempt ${attempt}: ${error.message}`);
      if (attempt < maxAttempts && retryable) continue;
      throw error;
    }

    try {
      validateModelContent(result?.content, stageName);
      const parsed = parse(result.content);
      const value = validate(parsed);
      return { value, attempts: attempt };
    } catch (error) {
      lastError = error;
      console.warn(`${stageName} quality check failed on attempt ${attempt}: ${error.message}`);
      if (attempt < maxAttempts) {
        attemptMessages = [...messages, correctionMessage(stageName, error)];
      }
    }
  }

  throw new Error(`${stageName} failed quality checks after ${maxAttempts} attempts: ${lastError?.message || 'invalid response'}`);
}

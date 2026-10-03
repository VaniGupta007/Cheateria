/**
 * Builds the two OpenRouter requests used by the form-filling workflow.
 */

function canonicalKey(field, index) {
  return field.trackingId || field.key || field.id || field.name || `field_${index}`;
}

function summarizeField(field, index) {
  const item = {
    key: canonicalKey(field, index),
    label: field.label || field.placeholder || field.name || field.id || `Field #${index + 1}`,
    type: field.type || 'text',
    alreadyFilled: Boolean(field.hasExistingValue),
    qualityValid: field.qualityValid !== false
  };

  if (field.placeholder) item.placeholder = field.placeholder;
  if (Array.isArray(field.options) && field.options.length > 0) {
    item.options = field.options.map(option => ({
      value: String(option.value ?? ''),
      text: String(option.text ?? option.value ?? '')
    }));
  }

  return item;
}

/**
 * First request: map a natural-language request to one or more safe field keys.
 */
export function buildIntentPrompt(instruction, fields) {
  if (!instruction || typeof instruction !== 'string' || !instruction.trim()) {
    throw new Error('A field-improvement instruction is required.');
  }
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error('Fields array must not be empty.');
  }

  const eligibleFields = fields
    .map(summarizeField)
    .filter(field => field.qualityValid && !field.alreadyFilled)
    .map(({ key, label, type }) => ({ key, label, type }));

  return [
    {
      role: 'system',
      content: [
        'You map a user request to form fields.',
        'Return only valid JSON in this exact shape: {"targetKeys":["field_key"],"request":"concise instruction","confidence":0.95}.',
        'Return exactly one JSON object. Do not append a second object, markdown, comments, or prose.',
        'Use double quotes for every key and string, escape embedded quotes, and do not use trailing commas.',
        'Use only keys from eligibleFields. Never select a field that already contains a value.',
        'Confidence must be a number from 0 to 1. Select a field only when confidence is at least 0.75.',
        'If no eligible field matches, return an empty targetKeys array and confidence 1.'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        instruction: instruction.trim(),
        eligibleFields
      })
    }
  ];
}

/**
 * Second request: generate values using the complete form schema.
 */
export function buildPrompt(fields, options = {}) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error('Fields array must not be empty.');
  }

  const instruction = typeof options.instruction === 'string' ? options.instruction.trim() : '';
  const targetKeys = Array.isArray(options.targetKeys) ? options.targetKeys : [];
  const targetSet = new Set(targetKeys.map(key => String(key).toLowerCase()));
  const summarizedFields = fields
    .map(summarizeField)
    .filter(field => targetSet.size === 0 || targetSet.has(field.key.toLowerCase()));

  const systemMessage = {
    role: 'system',
    content: [
      'You are a precise form-writing assistant.',
      'Return only one valid JSON object in this shape: {"answers":[{"key":"field_key","value":"text, option, boolean, or array","confidence":0.95}]}.',
      'Do not append another JSON object, markdown, comments, or prose. Use double quotes, escape embedded quotes, and do not use trailing commas.',
      'Use only the field keys supplied in the request. Do not add keys or explanatory text.',
      'CRITICAL PRESERVATION RULE: fields marked alreadyFilled must always have an empty string as value if present. Never rewrite or improve an existing value.',
      'Only answer fields that are empty and included in targetKeys.',
      'Every answer must contain value and a numeric confidence from 0 to 1. Omit an answer when confidence would be below 0.75.',
      'For select and radio fields, value must be exactly one provided option value.',
      'For checkbox fields with multiple options, value must always be an array of every relevant provided option value, even when only one option is selected. Evaluate every option independently and do not stop after finding the first relevant option.',
      'The exact multi-checkbox form is: {"answers":[{"key":"field_key","value":["option_a","option_c"],"confidence":0.95}]}. Never return a scalar string for a multi-option checkbox.',
      'For a single yes/no checkbox, a boolean is also allowed.',
      'Keep generated writing relevant to the surrounding form and the user instruction.'
    ].join('\n\n')
  };

  const userMessage = {
    role: 'user',
    content: JSON.stringify({
      instruction: instruction || 'Complete every eligible empty field.',
      targetKeys,
      fields: summarizedFields
    })
  };

  return [systemMessage, userMessage];
}

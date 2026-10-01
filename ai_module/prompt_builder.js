/**
 * Prompt Builder Module
 * Converts scraped form field schemas into structured LLM prompts.
 */

/**
 * Builds system and user messages for the AI model to fill the form.
 *
 * @param {Array<Object>} fields - Scraped form fields.
 *   Each field contains:
 *     id: string
 *     name: string
 *     type: string ('text' | 'email' | 'tel' | 'number' | 'textarea' | 'select' | 'radio' | 'checkbox', etc.)
 *     label: string (question or field label)
 *     placeholder?: string
 *     options?: Array<{ value: string, text: string }> (for select/radio/checkbox)
 * @param {string} [userContext=''] - Optional personal info/context provided by user.
 * @returns {Array<{ role: string, content: string }>} OpenRouter/OpenAI compatible chat messages.
 */
export function buildPrompt(fields, userContext = '') {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error('Fields array must not be empty.');
  }

  const systemMessage = {
    role: 'system',
    content: [
      'You are an intelligent, precise form-filling assistant.',
      'Your task is to analyze the provided web form fields and generate realistic, coherent, and appropriate answers for each field.',
      'Guidelines:',
      '1. Return ONLY a single, valid JSON object in the exact format: {"answers": { "<field_identifier>": <value> }}.',
      '2. Use the "id" or "name" provided in each field as the key in the answers dictionary.',
      '3. For <select> or radio fields with "options", you MUST pick one of the available option values or texts.',
      '4. For checkboxes, return true, false, or the chosen value/text.',
      '5. Match data types properly (numbers for number fields, valid email format for email, etc.).',
      '6. Do NOT include markdown formatting, code fences (like ```json), or explanatory text outside the JSON object.',
      userContext ? `User Persona / Profile Information:\n${userContext.trim()}` : 'Provide professional and sensible realistic answers matching standard user profiles.'
    ].join('\n\n')
  };

  const simplifiedFields = fields.map((f, index) => {
    const item = {
      key: f.id || f.name || `field_${index}`,
      label: f.label || f.placeholder || f.name || f.id || `Field #${index + 1}`,
      type: f.type || 'text'
    };
    if (f.placeholder) item.placeholder = f.placeholder;
    if (Array.isArray(f.options) && f.options.length > 0) {
      item.options = f.options.map(o => {
        if (typeof o === 'string') return o;
        if (o.text && o.value && o.text !== o.value) {
          return `${o.text} (value: ${o.value})`;
        }
        return o.text || o.value;
      });
    }
    return item;
  });

  const userMessage = {
    role: 'user',
    content: JSON.stringify({
      instruction: 'Fill in the following web form fields with appropriate answers.',
      fields: simplifiedFields
    }, null, 2)
  };

  return [systemMessage, userMessage];
}

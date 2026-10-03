import { DEFAULT_SETTINGS } from '../shared_config/settings.js';
import { queryOpenRouter } from './openrouter_client.js';
import { buildIntentPrompt, buildPrompt } from './prompt_builder.js';
import { parseFormAnswers, parseImprovementIntent } from './response_parser.js';
import {
  ANSWER_RESPONSE_FORMAT,
  INTENT_RESPONSE_FORMAT,
  runCheckedJsonStage,
  validateFormSchema
} from './quality_checks.js';

export const MIN_ANSWER_CONFIDENCE = 0.75;
export const ANSWER_BATCH_SIZE = 5;

function getFieldKey(field, index) {
  return field.trackingId || field.key || field.id || field.name || `field_${index}`;
}

export function getEligibleFieldMap(fields) {
  const lookup = new Map();
  fields.forEach((field, index) => {
    if (field.qualityValid === false || field.hasExistingValue) return;
    const canonicalKey = getFieldKey(field, index);
    [canonicalKey, field.key, field.trackingId, field.id, field.name]
      .filter(Boolean)
      .forEach(key => lookup.set(String(key).toLowerCase(), canonicalKey));
  });
  return lookup;
}

function buildEligibleFieldIndex(fields) {
  const index = new Map();
  fields.forEach((field, fieldIndex) => {
    if (field.qualityValid === false || field.hasExistingValue) return;
    const canonicalKey = getFieldKey(field, fieldIndex);
    [canonicalKey, field.key, field.trackingId, field.id, field.name]
      .filter(Boolean)
      .forEach(key => index.set(String(key).toLowerCase(), { canonicalKey, field }));
  });
  return index;
}

function matchesAllowedOption(answer, field) {
  if (!Array.isArray(field.options) || field.options.length === 0) return true;
  if (field.type === 'checkbox' && typeof answer === 'boolean') return field.options.length === 1;
  const values = Array.isArray(answer) ? answer : [answer];
  return values.every(value => {
    const normalized = String(value).trim().toLowerCase();
    return field.options.some(option =>
      String(option.value ?? '').trim().toLowerCase() === normalized ||
      String(option.text ?? '').trim().toLowerCase() === normalized
    );
  });
}

export function assessAnswers(answers, fields, requestedKeys) {
  const fieldIndex = buildEligibleFieldIndex(fields);
  const requested = new Set(requestedKeys.map(key => String(key).toLowerCase()));
  const sanitized = {};
  let rejectedCount = 0;
  let lowConfidenceCount = 0;

  for (const [answerKey, envelope] of Object.entries(answers || {})) {
    const match = fieldIndex.get(answerKey.toLowerCase());
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
        !Object.hasOwn(envelope, 'value') || typeof envelope.confidence !== 'number' ||
        !Number.isFinite(envelope.confidence) || envelope.confidence < 0 || envelope.confidence > 1) {
      rejectedCount++;
      continue;
    }
    if (envelope.confidence < MIN_ANSWER_CONFIDENCE) {
      rejectedCount++;
      lowConfidenceCount++;
      continue;
    }
    const answer = envelope.value;
    if (!match || !requested.has(match.canonicalKey.toLowerCase())) {
      rejectedCount++;
      continue;
    }
    const isScalar = ['string', 'number', 'boolean'].includes(typeof answer);
    const isMultiCheckbox = match.field.type === 'checkbox' && (match.field.options?.length || 0) > 1;
    const isCheckboxArray = match.field.type === 'checkbox' && Array.isArray(answer) &&
      answer.length > 0 && answer.every(value => ['string', 'number'].includes(typeof value)) &&
      new Set(answer.map(value => String(value).trim().toLowerCase())).size === answer.length;
    const isSingleCheckboxBoolean = match.field.type === 'checkbox' &&
      (match.field.options?.length || 0) === 1 && typeof answer === 'boolean';
    const hasValidType = match.field.type === 'checkbox'
      ? (isMultiCheckbox ? isCheckboxArray : isCheckboxArray || isSingleCheckboxBoolean)
      : isScalar;
    if (!hasValidType) {
      rejectedCount++;
      continue;
    }
    if (String(answer).trim() === '' || JSON.stringify(answer).length > 20_000) {
      rejectedCount++;
      continue;
    }
    if (match.field.type === 'number' && !Number.isFinite(Number(answer))) {
      rejectedCount++;
      continue;
    }
    if (!matchesAllowedOption(answer, match.field)) {
      rejectedCount++;
      continue;
    }
    sanitized[match.canonicalKey] = answer;
  }

  return { answers: sanitized, rejectedCount, lowConfidenceCount };
}

export function sanitizeAnswers(answers, fields, requestedKeys) {
  return assessAnswers(answers, fields, requestedKeys).answers;
}

export async function processForm({
  fields,
  instruction: rawInstruction = '',
  apiKey,
  model,
  queryFn = queryOpenRouter
}) {
  if (!Array.isArray(fields) || fields.length === 0) {
    return { success: false, error: 'No form fields were found on this page.' };
  }
  validateFormSchema(fields);
  if (!apiKey || !model) {
    throw new Error('Extension secrets are missing. Run npm run build and load the dist folder.');
  }

  const eligibleLookup = getEligibleFieldMap(fields);
  const allEligibleKeys = [...new Set(eligibleLookup.values())];
  if (allEligibleKeys.length === 0) {
    return {
      success: true,
      answers: {},
      eligibleCount: 0,
      qualityChecks: { formSchema: 'passed', intentAttempts: 0, generationAttempts: 0, rejectedAnswers: 0 }
    };
  }

  const instruction = typeof rawInstruction === 'string' ? rawInstruction.trim() : '';
  let targetKeys = allEligibleKeys;
  let normalizedInstruction = instruction;
  let intentAttempts = 0;

  if (instruction) {
    const intentStage = await runCheckedJsonStage({
      stageName: 'intent selection',
      messages: buildIntentPrompt(instruction, fields),
      request: { apiKey, model },
      queryFn,
      parse: parseImprovementIntent,
      responseFormat: INTENT_RESPONSE_FORMAT,
      validate: intent => {
        const normalizedTargets = [...new Set(intent.targetKeys
          .map(key => eligibleLookup.get(key.toLowerCase()))
          .filter(Boolean))];
        if (intent.targetKeys.length > 0 && normalizedTargets.length === 0) {
          throw new Error('The response selected fields that are not eligible.');
        }
        if (!Number.isFinite(intent.confidence) || intent.confidence < 0 || intent.confidence > 1) {
          throw new Error('The response did not provide a valid intent confidence.');
        }
        if (normalizedTargets.length > 0 && intent.confidence < MIN_ANSWER_CONFIDENCE) {
          throw new Error('The requested field could not be identified with enough confidence.');
        }
        return {
          targetKeys: normalizedTargets,
          request: intent.request || instruction,
          confidence: intent.confidence
        };
      }
    });
    intentAttempts = intentStage.attempts;
    targetKeys = intentStage.value.targetKeys;
    normalizedInstruction = intentStage.value.request;

    if (targetKeys.length === 0) {
      return {
        success: true,
        answers: {},
        eligibleCount: allEligibleKeys.length,
        qualityChecks: { formSchema: 'passed', intentAttempts, generationAttempts: 0, rejectedAnswers: 0 }
      };
    }
  }

  let rejectedAnswers = 0;
  let lowConfidenceAnswers = 0;
  let generationAttempts = 0;
  const generatedAnswers = {};

  for (let start = 0; start < targetKeys.length; start += ANSWER_BATCH_SIZE) {
    const batchKeys = targetKeys.slice(start, start + ANSWER_BATCH_SIZE);
    const generationStage = await runCheckedJsonStage({
      stageName: `answer generation batch ${Math.floor(start / ANSWER_BATCH_SIZE) + 1}`,
      messages: buildPrompt(fields, {
        instruction: normalizedInstruction,
        targetKeys: batchKeys
      }),
      request: {
        apiKey,
        model,
        endpoint: DEFAULT_SETTINGS.apiEndpoint,
        siteUrl: DEFAULT_SETTINGS.siteUrl,
        siteName: DEFAULT_SETTINGS.siteName
      },
      queryFn,
      parse: parseFormAnswers,
      responseFormat: ANSWER_RESPONSE_FORMAT,
      validate: result => {
        const assessed = assessAnswers(result.answers, fields, batchKeys);
        rejectedAnswers += assessed.rejectedCount;
        lowConfidenceAnswers += assessed.lowConfidenceCount;
        const answeredKeys = new Set(Object.keys(assessed.answers).map(key => key.toLowerCase()));
        const missingKeys = batchKeys.filter(key => !answeredKeys.has(String(key).toLowerCase()));
        if (missingKeys.length > 0) {
          throw new Error(`The response omitted or invalidly formatted ${missingKeys.length} requested field answer(s). Multi-option checkboxes must use arrays.`);
        }
        return assessed.answers;
      }
    });
    generationAttempts += generationStage.attempts;
    Object.assign(generatedAnswers, generationStage.value);
  }

  return {
    success: true,
    answers: generatedAnswers,
    eligibleCount: targetKeys.length,
    qualityChecks: {
      formSchema: 'passed',
      intentAttempts,
      generationAttempts,
      rejectedAnswers,
      lowConfidenceAnswers
    }
  };
}

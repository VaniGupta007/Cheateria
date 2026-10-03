import { buildIntentPrompt, buildPrompt } from '../ai_module/prompt_builder.js';
import {
  extractJsonFromText,
  parseFormAnswers,
  parseImprovementIntent
} from '../ai_module/response_parser.js';
import { queryOpenRouter } from '../ai_module/openrouter_client.js';
import { assessAnswers, processForm, sanitizeAnswers } from '../ai_module/form_processor.js';

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  FAIL: ${testName}`);
    failed++;
  }
}

function assertThrows(fn, testName) {
  try {
    fn();
    assert(false, `${testName} (did not throw)`);
  } catch {
    assert(true, testName);
  }
}

async function runTests() {
  const fields = [
    {
      trackingId: 'af_summary',
      id: 'project_summary',
      type: 'textarea',
      label: 'Project summary',
      isPersonal: false,
      hasExistingValue: false
    },
    {
      trackingId: 'af_email',
      id: 'email',
      type: 'email',
      label: 'Email address',
      isPersonal: true,
      hasExistingValue: false
    },
    {
      trackingId: 'af_notes',
      id: 'notes',
      type: 'textarea',
      label: 'Additional notes',
      value: 'Private existing value that must never be sent',
      isPersonal: false,
      hasExistingValue: true
    }
  ];

  console.log('\n--- Prompt safety and targeting ---');
  const intentMessages = buildIntentPrompt('Make the project summary concise', fields);
  const intentPayload = JSON.parse(intentMessages[1].content);
  assert(intentPayload.eligibleFields.length === 2, 'Intent prompt includes every empty valid field');
  assert(intentPayload.eligibleFields.some(field => field.key === 'af_summary'), 'Intent prompt uses stable tracking keys');
  assert(intentPayload.eligibleFields.some(field => field.key === 'af_email'), 'Personal-looking fields are passed to intent selection');

  const messages = buildPrompt(fields, {
    instruction: 'Make the project summary concise',
    targetKeys: ['af_summary']
  });
  const generationPayload = JSON.parse(messages[1].content);
  assert(!messages[0].content.includes('personal fields'), 'System prompt does not exclude personal-looking fields');
  assert(messages[0].content.includes('fields marked alreadyFilled must always have an empty string'), 'System prompt protects existing values');
  assert(messages[0].content.includes('Evaluate every option independently'), 'Checkbox prompt requires exhaustive option evaluation');
  assert(!messages[1].content.includes('Private existing value'), 'Existing values are never sent to the model');
  assert(generationPayload.targetKeys[0] === 'af_summary', 'Generation prompt carries selected target');
  assertThrows(() => buildPrompt([]), 'Empty fields are rejected');

  console.log('\n--- Response parsing ---');
  const cleanResult = parseFormAnswers('{"answers":{"af_summary":{"value":"Clear summary","confidence":0.96}}}');
  assert(cleanResult.answers.af_summary.value === 'Clear summary', 'Clean answer JSON is parsed');
  const entryList = parseFormAnswers('{"answers":[{"key":"af_features","value":["api","export"],"confidence":0.96}]}');
  assert(entryList.answers.af_features.value.length === 2, 'Stable answer-entry JSON preserves multiple checkbox values');
  assertThrows(
    () => parseFormAnswers('{"answers":[{"key":"af_features","value":["api"],"confidence":0.9},{"key":"af_features","value":["export"],"confidence":0.9}]}'),
    'Duplicate answer entries are rejected instead of silently overwriting values'
  );
  const fenced = extractJsonFromText('```json\n{"answers":{"af_summary":"Clear"}}\n```');
  assert(fenced.answers.af_summary === 'Clear', 'Markdown-wrapped JSON is recovered');
  const concatenated = parseFormAnswers('{"note":"first object"}{"answers":{"af_summary":"Recovered"}}');
  assert(concatenated.answers.af_summary === 'Recovered', 'Correct object is selected from concatenated JSON');
  const trailingComma = parseFormAnswers('{"answers":{"af_summary":"Recovered",},}');
  assert(trailingComma.answers.af_summary === 'Recovered', 'Safe trailing commas are repaired');
  const intent = parseImprovementIntent('{"targetKeys":["af_summary","af_summary"],"request":"Shorten it","confidence":0.91}');
  assert(intent.targetKeys.length === 1 && intent.request === 'Shorten it' && intent.confidence === 0.91, 'Intent response is normalized');
  assertThrows(() => parseFormAnswers('not json'), 'Malformed model output is rejected');

  console.log('\n--- Two-call form processing ---');
  const mockResponses = [
    '{"targetKeys":["af_summary"],"request":"Make the summary concise","confidence":0.95}',
    '{"answers":{"af_summary":{"value":"Concise summary","confidence":0.94},"af_email":{"value":"invented@example.com","confidence":0.99},"af_notes":{"value":"overwrite","confidence":0.99}}}'
  ];
  let queryCount = 0;
  const processed = await processForm({
    fields,
    instruction: 'Improve the summary',
    apiKey: 'test-key',
    model: 'test-model',
    queryFn: async () => ({ content: mockResponses[queryCount++] })
  });
  assert(queryCount === 2, 'A targeted request makes intent and generation calls');
  assert(processed.answers.af_summary === 'Concise summary', 'Selected eligible answer survives filtering');
  assert(!processed.answers.af_email && !processed.answers.af_notes, 'Untargeted and existing-field answers are discarded');

  const automatic = await processForm({
    fields,
    apiKey: 'test-key',
    model: 'test-model',
    queryFn: async () => ({
      content: '{"answers":{"af_summary":{"value":"Summary","confidence":0.95},"af_email":{"value":"generated@example.com","confidence":0.95},"af_notes":{"value":"overwrite","confidence":0.95}}}'
    })
  });
  assert(automatic.answers.af_email === 'generated@example.com', 'Automatic fill accepts personal-looking fields');
  assert(!automatic.answers.af_notes, 'Automatic fill still preserves existing values');

  const sanitized = sanitizeAnswers({ project_summary: { value: 'Alias answer', confidence: 0.9 } }, fields, ['af_summary']);
  assert(sanitized.af_summary === 'Alias answer', 'Safe aliases normalize to the tracking key');

  const retryResponses = [
    '{"targetKeys":["af_summary"],"request":"Improve it","confidence":0.9}',
    'I could not format the answer correctly.',
    '{"answers":{"af_summary":{"value":"Recovered after retry","confidence":0.93}}}'
  ];
  let retryCount = 0;
  const retried = await processForm({
    fields,
    instruction: 'Improve the summary',
    apiKey: 'test-key',
    model: 'test-model',
    queryFn: async () => ({ content: retryResponses[retryCount++] })
  });
  assert(retryCount === 3, 'Malformed generation receives one corrective retry');
  assert(retried.answers.af_summary === 'Recovered after retry', 'Corrected retry output passes quality checks');
  assert(retried.qualityChecks.generationAttempts === 2, 'Quality report records retry count');

  let emptyChoiceAttempts = 0;
  const recoveredFromEmptyChoice = await processForm({
    fields: [fields[0]],
    apiKey: 'test-key',
    model: 'test-model',
    queryFn: async () => {
      emptyChoiceAttempts++;
      if (emptyChoiceAttempts === 1) {
        const error = new Error('OpenRouter returned an empty response choice.');
        error.retryable = true;
        throw error;
      }
      return { content: '{"answers":[{"key":"af_summary","value":"Recovered","confidence":0.95}]}' };
    }
  });
  assert(emptyChoiceAttempts === 2 && recoveredFromEmptyChoice.answers.af_summary === 'Recovered',
    'An empty provider completion is retried instead of aborting the form run');

  const unsafe = assessAnswers({ af_summary: { nested: 'bad' }, unknown: 'bad' }, fields, ['af_summary']);
  assert(Object.keys(unsafe.answers).length === 0 && unsafe.rejectedCount === 2, 'Nested and unknown answers are rejected');

  const checkboxFields = [{
    trackingId: 'af_features',
    type: 'checkbox',
    label: 'Required features',
    options: [{ value: 'api', text: 'API' }, { value: 'export', text: 'Export' }],
    isPersonal: false,
    hasExistingValue: false
  }];
  const checkboxAnswers = assessAnswers({ af_features: { value: ['api', 'export'], confidence: 0.91 } }, checkboxFields, ['af_features']);
  assert(checkboxAnswers.answers.af_features.length === 2, 'Checkbox arrays pass option validation');
  const invalidCheckbox = assessAnswers({ af_features: { value: ['api', 'unknown'], confidence: 0.91 } }, checkboxFields, ['af_features']);
  assert(invalidCheckbox.rejectedCount === 1, 'Checkbox arrays reject unknown options');
  const scalarCheckbox = assessAnswers({ af_features: { value: 'api', confidence: 0.91 } }, checkboxFields, ['af_features']);
  assert(scalarCheckbox.rejectedCount === 1 && !scalarCheckbox.answers.af_features,
    'Multi-option checkbox groups reject scalar answers');

  let checkboxRetryCount = 0;
  const checkboxRetryResponses = [
    '{"answers":{"af_features":{"value":"api","confidence":0.95}}}',
    '{"answers":{"af_features":{"value":["api","export"],"confidence":0.95}}}'
  ];
  const checkboxRetry = await processForm({
    fields: checkboxFields,
    apiKey: 'test-key',
    model: 'test-model',
    queryFn: async () => ({ content: checkboxRetryResponses[checkboxRetryCount++] })
  });
  assert(checkboxRetryCount === 2 && checkboxRetry.answers.af_features.length === 2,
    'Scalar checkbox output is retried and recovered as a multi-value array');

  const batchFields = Array.from({ length: 11 }, (_, index) => ({
    trackingId: `af_question_${index + 1}`,
    type: 'checkbox',
    label: `Question ${index + 1}`,
    options: [{ value: 'a', text: 'A' }, { value: 'b', text: 'B' }],
    hasExistingValue: false
  }));
  let batchCalls = 0;
  const batched = await processForm({
    fields: batchFields,
    apiKey: 'test-key',
    model: 'test-model',
    queryFn: async ({ messages, responseFormat }) => {
      batchCalls++;
      const payload = JSON.parse(messages[1].content);
      assert(payload.fields.length <= 5, `Generation batch ${batchCalls} contains at most five fields`);
      assert(responseFormat.type === 'json_schema', `Generation batch ${batchCalls} requests strict JSON schema`);
      return {
        content: JSON.stringify({
          answers: payload.targetKeys.map(key => ({ key, value: ['a', 'b'], confidence: 0.95 }))
        })
      };
    }
  });
  assert(batchCalls === 3 && Object.keys(batched.answers).length === 11,
    'Large multi-select forms are generated and merged in bounded batches');

  const lowConfidence = assessAnswers({
    af_features: { value: ['api'], confidence: 0.4 }
  }, checkboxFields, ['af_features']);
  assert(lowConfidence.rejectedCount === 1 && lowConfidence.lowConfidenceCount === 1,
    'Low-confidence answers fail closed');

  const ambiguousFields = [{ ...checkboxFields[0], qualityValid: false }];
  const ambiguousAnswer = assessAnswers({
    af_features: { value: ['api'], confidence: 0.99 }
  }, ambiguousFields, ['af_features']);
  assert(Object.keys(ambiguousAnswer.answers).length === 0,
    'Extraction quality failures cannot reach injection');

  console.log('\n--- OpenRouter client ---');
  let capturedHeaders;
  let capturedBody;
  const mockFetch = async (url, options) => {
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"answers":{"af_summary":"Done"}}' } }] })
    };
  };

  const result = await queryOpenRouter({
    apiKey: 'sk-or-test-key',
    model: 'openrouter/free',
    messages,
    responseFormat: { type: 'json_object' },
    fetchFn: mockFetch
  });
  assert(result.content.includes('af_summary'), 'Assistant content is returned');
  assert(capturedHeaders.Authorization === 'Bearer sk-or-test-key', 'Bearer token is sent');
  assert(capturedBody.model === 'openrouter/free', 'Configured model is sent');
  assert(capturedBody.temperature === 0, 'Deterministic temperature is requested');
  assert(capturedBody.max_tokens === 4096, 'Enough completion tokens are reserved for structured answers');
  assert(capturedBody.response_format.type === 'json_object', 'JSON response mode is requested');
  assert(capturedBody.plugins[0].id === 'response-healing', 'OpenRouter response healing is enabled for JSON');

  let fallbackCalls = 0;
  const formatFallbackFetch = async () => {
    fallbackCalls++;
    if (fallbackCalls === 1) {
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'response_format is not supported by this model' } })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: [{ type: 'text', text: '{"answers":{"af_summary":"Fallback"}}' }] } }]
      })
    };
  };
  const fallbackResult = await queryOpenRouter({
    apiKey: 'test-key',
    model: 'test-model',
    messages,
    responseFormat: { type: 'json_object' },
    fetchFn: formatFallbackFetch
  });
  assert(fallbackCalls === 2, 'Unsupported JSON mode retries without response_format');
  assert(fallbackResult.content.includes('Fallback'), 'Multipart model content is normalized');

  let schemaFallbackCalls = 0;
  const schemaFallbackFetch = async (url, options) => {
    schemaFallbackCalls++;
    const body = JSON.parse(options.body);
    if (body.response_format?.type === 'json_schema') {
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'structured output json_schema is not supported' } })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"answers":[]}' } }] })
    };
  };
  await queryOpenRouter({
    apiKey: 'test-key',
    model: 'test-model',
    messages,
    responseFormat: { type: 'json_schema', json_schema: { name: 'test', schema: {} } },
    fetchFn: schemaFallbackFetch
  });
  assert(schemaFallbackCalls === 2, 'Unsupported strict schema falls back to JSON object mode');

  await queryOpenRouter({ apiKey: 'key', model: '', messages, fetchFn: mockFetch })
    .then(() => assert(false, 'Missing model is rejected'))
    .catch(() => assert(true, 'Missing model is rejected'));

  console.log(`\nAI tests: ${passed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
}

runTests().catch(error => {
  console.error(error);
  process.exit(1);
});

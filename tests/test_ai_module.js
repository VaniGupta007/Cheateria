/**
 * Unit Tests for AI Module
 * Tests openrouter_client.js, prompt_builder.js, and response_parser.js.
 */

import { buildPrompt } from '../ai_module/prompt_builder.js';
import { extractJsonFromText, parseFormAnswers } from '../ai_module/response_parser.js';
import { queryOpenRouter } from '../ai_module/openrouter_client.js';

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    failed++;
  }
}

function assertThrows(fn, testName) {
  try {
    fn();
    console.error(`  ✗ FAIL: ${testName} (did not throw)`);
    failed++;
  } catch {
    console.log(`  ✓ PASS: ${testName}`);
    passed++;
  }
}

async function runTests() {
  console.log('\n--- 1. Testing prompt_builder.js ---');

  const sampleFields = [
    { id: 'full_name', name: 'name', type: 'text', label: 'Full Name', placeholder: 'John Doe' },
    { id: 'email_addr', name: 'email', type: 'email', label: 'Email Address' },
    {
      id: 'country_sel',
      name: 'country',
      type: 'select',
      label: 'Country',
      options: [
        { value: 'us', text: 'United States' },
        { value: 'ca', text: 'Canada' },
        { value: 'uk', text: 'United Kingdom' }
      ]
    }
  ];

  const messages = buildPrompt(sampleFields, 'User is a software engineer located in Canada.');
  assert(Array.isArray(messages) && messages.length === 2, 'Returns system and user messages array');
  assert(messages[0].role === 'system', 'First message is system prompt');
  assert(messages[0].content.includes('User Persona / Profile Information:'), 'System prompt incorporates user context');
  assert(messages[1].role === 'user', 'Second message is user prompt');

  const parsedUserPayload = JSON.parse(messages[1].content);
  assert(parsedUserPayload.fields && parsedUserPayload.fields.length === 3, 'User prompt contains 3 structured fields');
  assert(parsedUserPayload.fields[2].options.some(opt => opt.includes('United States')), 'Select options correctly mapped');

  assertThrows(() => buildPrompt([]), 'Throws error when passed empty fields array');

  console.log('\n--- 2. Testing response_parser.js ---');

  // Test clean JSON
  const cleanJson = JSON.stringify({ answers: { full_name: 'Alex Mercer', email_addr: 'alex@example.com' } });
  const cleanResult = parseFormAnswers(cleanJson);
  assert(cleanResult.answers.full_name === 'Alex Mercer', 'Parses clean JSON successfully');

  // Test markdown-wrapped JSON
  const markdownJson = '```json\n{"answers": {"full_name": "Sarah Connor", "country_sel": "Canada"}}\n```';
  const mdResult = parseFormAnswers(markdownJson);
  assert(mdResult.answers.full_name === 'Sarah Connor', 'Extracts and parses markdown code fence JSON');

  // Test JSON with conversational preamble and postamble
  const preambleJson = 'Certainly! Here is the completed form data:\n\n{"answers": {"full_name": "Bruce Wayne"}}\n\nLet me know if you need anything else!';
  const preambleResult = parseFormAnswers(preambleJson);
  assert(preambleResult.answers.full_name === 'Bruce Wayne', 'Extracts JSON with preamble and postscript');

  // Test direct dictionary without outer "answers" key
  const directDictJson = '{"full_name": "Clark Kent", "email_addr": "clark@dailyplanet.com"}';
  const directResult = parseFormAnswers(directDictJson);
  assert(directResult.answers.full_name === 'Clark Kent', 'Handles direct field-value dictionary');

  // Test invalid response
  assertThrows(() => parseFormAnswers('Invalid text without JSON'), 'Throws on malformed text');

  console.log('\n--- 3. Testing openrouter_client.js ---');

  // Mock successful 200 OK response
  let capturedUrl = '';
  let capturedHeaders = null;
  let capturedBody = null;

  const mockFetchSuccess = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);

    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'gen-12345',
        choices: [
          {
            message: {
              role: 'assistant',
              content: '{"answers": {"full_name": "Diana Prince"}}'
            }
          }
        ]
      })
    };
  };

  const aiResponse = await queryOpenRouter({
    apiKey: 'sk-or-test-dummy-key-123',
    messages,
    model: 'openrouter/free',
    fetchFn: mockFetchSuccess
  });

  assert(aiResponse.content === '{"answers": {"full_name": "Diana Prince"}}', 'Returns extracted assistant content on 200 OK');
  assert(capturedHeaders['Authorization'] === 'Bearer sk-or-test-dummy-key-123', 'Passes Authorization Bearer header correctly');
  assert(capturedHeaders['Content-Type'] === 'application/json', 'Passes Content-Type application/json');
  assert(capturedBody.model === 'openrouter/free', 'Sends configured model in request body');

  // Mock 401 Unauthorized
  const mockFetch401 = async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    json: async () => ({ error: { message: 'Invalid API key' } })
  });

  let errorCaught = false;
  try {
    await queryOpenRouter({
      apiKey: 'invalid-key',
      messages,
      fetchFn: mockFetch401
    });
  } catch (err) {
    errorCaught = true;
    assert(err.message.includes('401') && err.message.includes('Invalid OpenRouter API key'), 'Handles HTTP 401 authentication error gracefully');
  }
  assert(errorCaught, 'Throws on 401 response');

  // Missing API key test
  let missingKeyCaught = false;
  try {
    await queryOpenRouter({
      apiKey: '',
      messages,
      fetchFn: mockFetchSuccess
    });
  } catch (err) {
    missingKeyCaught = true;
    assert(err.message.includes('API key is required'), 'Validates missing API key');
  }
  assert(missingKeyCaught, 'Throws on missing API key');

  console.log(`\n================================`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});

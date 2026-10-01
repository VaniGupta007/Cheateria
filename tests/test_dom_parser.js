/**
 * Unit Tests for DOM Parser & Data Injection
 * Tests extraction of form fields, label mapping, and DOM answer injection with synthetic events.
 * Executes content_script.js in Node.js via mock DOM harness without requiring module exports.
 */

import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Minimal DOM simulation for Node.js test execution
class MockEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = options.bubbles ?? false;
    this.cancelable = options.cancelable ?? false;
  }
}

class MockElement {
  constructor(tagName, attrs = {}) {
    this.tagName = tagName.toUpperCase();
    this.attrs = { ...attrs };
    this.children = [];
    this.parentElement = null;
    this.eventListeners = {};
    this.style = {};
    this.value = attrs.value || '';
    this.checked = false;
    this.options = [];
    this.selectedIndex = 0;
  }

  get id() {
    return this.attrs.id || '';
  }
  set id(val) {
    this.attrs.id = val;
  }

  getAttribute(name) {
    return this.attrs[name] !== undefined ? this.attrs[name] : null;
  }

  setAttribute(name, val) {
    this.attrs[name] = String(val);
  }

  addEventListener(type, cb) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(cb);
  }

  dispatchEvent(event) {
    const list = this.eventListeners[event.type] || [];
    list.forEach(cb => cb(event));
    return true;
  }

  closest(selector) {
    if (selector.toLowerCase() === 'label' && this.parentElement && this.parentElement.tagName === 'LABEL') {
      return this.parentElement;
    }
    return null;
  }

  cloneNode(deep = true) {
    const clone = new MockElement(this.tagName, { ...this.attrs });
    clone.textContent = this.textContent;
    return clone;
  }

  remove() {}

  get textContent() {
    if (this._textContent !== undefined) return this._textContent;
    return this.children.map(c => c.textContent || '').join(' ');
  }

  set textContent(val) {
    this._textContent = val;
  }

  get previousElementSibling() {
    if (!this.parentElement) return null;
    const idx = this.parentElement.children.indexOf(this);
    return idx > 0 ? this.parentElement.children[idx - 1] : null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const lowerSel = selector.toLowerCase();

    function recurse(node) {
      for (const child of node.children) {
        const tag = child.tagName.toLowerCase();
        if (lowerSel.startsWith('label[for=')) {
          const matchFor = selector.match(/label\[for=["']?(.*?)["']?\]/i);
          if (matchFor && tag === 'label' && child.getAttribute('for') === matchFor[1]) {
            matches.push(child);
          }
        } else {
          const allowedTags = lowerSel.split(',').map(s => s.trim());
          if (allowedTags.includes(tag)) {
            matches.push(child);
          }
        }
        recurse(child);
      }
    }

    recurse(this);
    return matches;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
}

// Setup environment globals before loading content_script.js
globalThis.window = {
  location: { href: 'https://example.com/form' },
  HTMLInputElement: { prototype: {} },
  HTMLTextAreaElement: { prototype: {} },
  HTMLSelectElement: { prototype: {} }
};
globalThis.Event = MockEvent;
globalThis.CSS = { escape: str => str };

// Read and execute content_script.js into current global context
const contentScriptPath = path.resolve(__dirname, '../extension_core/content_script.js');
const contentScriptCode = fs.readFileSync(contentScriptPath, 'utf8');
vm.runInThisContext(contentScriptCode);

const {
  extractFormFields,
  findLabelForElement,
  injectAnswers,
  dispatchInputEvents
} = globalThis.__AIAutoFiller;

function buildDummyDomForm() {
  const container = new MockElement('div');

  // Field 1: Text input with explicit <label for="username">
  const label1 = new MockElement('label', { for: 'username' });
  label1.textContent = 'Username';
  const input1 = new MockElement('input', { type: 'text', id: 'username', name: 'user_name', placeholder: 'Enter username' });
  container.appendChild(label1);
  container.appendChild(input1);

  // Field 2: Email input wrapped inside <label>
  const label2 = new MockElement('label');
  label2.textContent = 'Email Address';
  const input2 = new MockElement('input', { type: 'email', id: 'user_email', name: 'email', placeholder: 'name@domain.com' });
  label2.appendChild(input2);
  container.appendChild(label2);

  // Field 3: Select dropdown with label
  const label3 = new MockElement('label', { for: 'country' });
  label3.textContent = 'Country';
  const select3 = new MockElement('select', { id: 'country', name: 'user_country' });
  const opt1 = new MockElement('option', { value: 'us' });
  opt1.textContent = 'United States';
  opt1.value = 'us';
  const opt2 = new MockElement('option', { value: 'ca' });
  opt2.textContent = 'Canada';
  opt2.value = 'ca';
  select3.options = [opt1, opt2];
  select3.appendChild(opt1);
  select3.appendChild(opt2);
  container.appendChild(label3);
  container.appendChild(select3);

  // Setup document mock queries
  globalThis.document = {
    querySelector: (sel) => container.querySelector(sel),
    querySelectorAll: (sel) => container.querySelectorAll(sel)
  };

  return { container, input1, input2, select3, label1, label2, label3 };
}

function runDomTests() {
  console.log('\n--- 1. Testing DOM Field Extraction & Label Mapping ---');
  const { container, input1, input2, select3 } = buildDummyDomForm();

  // Test label extraction
  const label1Text = findLabelForElement(input1);
  assert(label1Text === 'Username', `findLabelForElement extracts explicit <label for="username">: "${label1Text}"`);

  const label2Text = findLabelForElement(input2);
  assert(label2Text.includes('Email Address'), `findLabelForElement extracts parent label: "${label2Text}"`);

  const label3Text = findLabelForElement(select3);
  assert(label3Text === 'Country', `findLabelForElement extracts select label: "${label3Text}"`);

  // Test extractFormFields
  const fields = extractFormFields(container);
  assert(fields.length === 3, `extractFormFields returns exactly 3 fields (got ${fields.length})`);

  // Verify Field 1 mapping (id, type, label)
  const f1 = fields.find(f => f.id === 'username');
  assert(f1 && f1.type === 'text' && f1.label === 'Username', 'Field 1 correctly maps id="username", type="text", label="Username"');

  // Verify Field 2 mapping (id, type, label)
  const f2 = fields.find(f => f.id === 'user_email');
  assert(f2 && f2.type === 'email' && f2.label.includes('Email Address'), 'Field 2 correctly maps id="user_email", type="email", label="Email Address"');

  // Verify Field 3 mapping (id, type, label, options)
  const f3 = fields.find(f => f.id === 'country');
  assert(f3 && f3.type === 'select' && f3.options && f3.options.length === 2, 'Field 3 correctly maps id="country", type="select", options count=2');

  console.log('\n--- 2. Testing Data Injection & Event Dispatching ---');

  // Set up event listeners to verify change and input events fire
  const firedEvents = {
    username: { input: false, change: false },
    user_email: { input: false, change: false },
    country: { input: false, change: false }
  };

  input1.addEventListener('input', () => { firedEvents.username.input = true; });
  input1.addEventListener('change', () => { firedEvents.username.change = true; });

  input2.addEventListener('input', () => { firedEvents.user_email.input = true; });
  input2.addEventListener('change', () => { firedEvents.user_email.change = true; });

  select3.addEventListener('input', () => { firedEvents.country.input = true; });
  select3.addEventListener('change', () => { firedEvents.country.change = true; });

  // Mock AI response answers
  const mockAiAnswers = {
    username: 'alex_mercer',
    user_email: 'alex@prototype.org',
    country: 'Canada'
  };

  const injectedCount = injectAnswers(mockAiAnswers, container);
  assert(injectedCount === 3, `injectAnswers returned 3 successfully filled fields (got ${injectedCount})`);

  // Check updated values
  assert(input1.value === 'alex_mercer', `input1 value updated to "alex_mercer" (got "${input1.value}")`);
  assert(input2.value === 'alex@prototype.org', `input2 value updated to "alex@prototype.org" (got "${input2.value}")`);
  assert(select3.selectedIndex === 1, `select3 selectedIndex updated to 1 ("Canada") (got ${select3.selectedIndex})`);

  // Verify events fired
  assert(firedEvents.username.input && firedEvents.username.change, 'input1 received both synthetic "input" and "change" events');
  assert(firedEvents.user_email.input && firedEvents.user_email.change, 'input2 received both synthetic "input" and "change" events');
  assert(firedEvents.country.input && firedEvents.country.change, 'select3 received both synthetic "input" and "change" events');

  console.log(`\n================================`);
  console.log(`DOM Test Results: ${passed} passed, ${failed} failed`);
  console.log(`================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runDomTests();

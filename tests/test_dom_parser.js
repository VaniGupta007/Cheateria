import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
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

class MockEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = options.bubbles ?? false;
  }
}

function matchesSelector(element, selector) {
  const part = selector.trim();
  if (part === '*') return true;
  const labelFor = part.match(/^label\[for=["']?(.*?)["']?\]$/i)?.[1];
  if (labelFor !== undefined) return element.tagName === 'LABEL' && element.getAttribute('for') === labelFor;
  const attribute = part.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
  if (attribute) {
    const actual = element.getAttribute(attribute[1]);
    return attribute[2] === undefined ? actual !== null : actual === attribute[2];
  }
  return element.tagName.toLowerCase() === part.toLowerCase();
}

class MockElement {
  constructor(tagName, attributes = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this.children = [];
    this.parentElement = null;
    this.listeners = {};
    this.style = {};
    this.value = attributes.value || '';
    this.checked = Boolean(attributes.checked);
    this.options = [];
    this.selectedIndex = 0;
    this.disabled = false;
    this.readOnly = false;
  }

  get id() { return this.attributes.id || ''; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  dispatchEvent(event) { (this.listeners[event.type] || []).forEach(listener => listener(event)); return true; }
  remove() {}

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  closest(selector) {
    const selectors = selector.split(',').map(part => part.trim());
    let current = this;
    while (current) {
      if (selectors.some(part => matchesSelector(current, part))) return current;
      current = current.parentElement;
    }
    return null;
  }

  cloneNode() {
    const clone = new MockElement(this.tagName, this.attributes);
    clone.textContent = this.textContent;
    return clone;
  }

  click() {
    this.clicked = true;
    this.clickCount = (this.clickCount || 0) + 1;
    const role = this.getAttribute('role');
    const type = this.getAttribute('type');
    if (role === 'radio') {
      this.parentElement?.querySelectorAll('[role="radio"]').forEach(control => control.setAttribute('aria-checked', 'false'));
      this.setAttribute('aria-checked', 'true');
    } else if (role === 'checkbox') {
      this.setAttribute('aria-checked', this.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    } else if (type === 'radio') {
      const root = this.getRoot();
      root.querySelectorAll('input').filter(control =>
        control.getAttribute('type') === 'radio' && control.getAttribute('name') === this.getAttribute('name')
      ).forEach(control => { control.checked = false; });
      this.checked = true;
    } else if (type === 'checkbox') {
      this.checked = !this.checked;
    }
    this.dispatchEvent(new MockEvent('click', { bubbles: true }));
    this.dispatchEvent(new MockEvent('input', { bubbles: true }));
    this.dispatchEvent(new MockEvent('change', { bubbles: true }));
  }

  getRoot() {
    let current = this;
    while (current.parentElement) current = current.parentElement;
    return current;
  }

  getRootNode() {
    return this.getRoot();
  }

  attachShadow() {
    const root = new MockElement('shadow-root');
    root.host = this;
    this.shadowRoot = root;
    return root;
  }

  get textContent() {
    return this._textContent ?? this.children.map(child => child.textContent || '').join(' ');
  }

  set textContent(value) { this._textContent = value; }

  get previousElementSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return index > 0 ? this.parentElement.children[index - 1] : null;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  querySelectorAll(selector) {
    const selectors = selector.split(',').map(part => part.trim());
    const matches = [];
    const visit = node => {
      for (const child of node.children) {
        if (selectors.some(part => matchesSelector(child, part))) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }
}

globalThis.window = {
  HTMLInputElement: { prototype: {} },
  HTMLTextAreaElement: { prototype: {} }
};
globalThis.Event = MockEvent;
globalThis.CSS = { escape: value => value };
globalThis.location = { pathname: '/quiz/sample-question', hostname: 'example.com' };

const contentScriptPath = path.resolve(currentDirectory, '../extension_core/content_script.js');
vm.runInThisContext(fs.readFileSync(contentScriptPath, 'utf8'));
const { extractFormFields, injectAnswers, injectAnswersWithReport } = globalThis.__AIAutoFiller;

function addLabeledField(container, labelText, element) {
  const label = new MockElement('label', { for: element.id });
  label.textContent = labelText;
  container.appendChild(label);
  container.appendChild(element);
  return element;
}

function addNativeChoice(fieldset, type, id, name, value, text) {
  const input = new MockElement('input', { type, id, name, value });
  const label = new MockElement('label', { for: id });
  label.textContent = text;
  fieldset.appendChild(input);
  fieldset.appendChild(label);
  return input;
}

function buildForm() {
  const container = new MockElement('div');
  const siteHeader = new MockElement('header', { class: 'site-header' });
  const menuButton = new MockElement('button', { type: 'button', 'aria-label': 'Open menu' });
  siteHeader.appendChild(menuButton);
  container.appendChild(siteHeader);
  const email = addLabeledField(container, 'Email address', new MockElement('input', { id: 'email', type: 'email' }));
  const summary = addLabeledField(container, 'Project summary', new MockElement('textarea', { id: 'summary' }));
  const notes = addLabeledField(container, 'Additional notes', new MockElement('textarea', { id: 'notes', value: 'Keep this text' }));
  const category = addLabeledField(container, 'Project category', new MockElement('select', { id: 'category' }));
  const categoryA = new MockElement('option', { value: 'research' });
  categoryA.value = 'research';
  categoryA.textContent = 'Research';
  const categoryB = new MockElement('option', { value: 'education' });
  categoryB.value = 'education';
  categoryB.textContent = 'Education';
  category.options = [categoryA, categoryB];

  const radioFieldset = new MockElement('fieldset');
  const radioLegend = new MockElement('legend');
  radioLegend.textContent = 'Choose a project type';
  radioFieldset.appendChild(radioLegend);
  const radioResearch = addNativeChoice(radioFieldset, 'radio', 'type_research', 'project_type', 'research', 'Research');
  const radioEducation = addNativeChoice(radioFieldset, 'radio', 'type_education', 'project_type', 'education', 'Education');
  container.appendChild(radioFieldset);

  const checkboxFieldset = new MockElement('fieldset');
  const checkboxLegend = new MockElement('legend');
  checkboxLegend.textContent = 'Required features';
  checkboxFieldset.appendChild(checkboxLegend);
  const featureApi = addNativeChoice(checkboxFieldset, 'checkbox', 'feature_api', 'features', 'api', 'API');
  const featureExport = addNativeChoice(checkboxFieldset, 'checkbox', 'feature_export', 'features', 'export', 'Export');
  container.appendChild(checkboxFieldset);

  const ariaTitle = new MockElement('div', { id: 'quiz_question' });
  ariaTitle.textContent = 'Choose the correct answer';
  container.appendChild(ariaTitle);
  const ariaGroup = new MockElement('div', { role: 'radiogroup', 'aria-labelledby': 'quiz_question' });
  const ariaA = new MockElement('div', { role: 'radio', 'aria-label': 'Answer A', 'data-value': 'a', 'aria-checked': 'false' });
  const ariaB = new MockElement('div', { role: 'radio', 'aria-label': 'Answer B', 'data-value': 'b', 'aria-checked': 'false' });
  ariaGroup.appendChild(ariaA);
  ariaGroup.appendChild(ariaB);
  container.appendChild(ariaGroup);

  const ariaCheckboxTitle = new MockElement('div', { id: 'tools_question' });
  ariaCheckboxTitle.textContent = 'Choose useful tools';
  container.appendChild(ariaCheckboxTitle);
  const ariaCheckboxGroup = new MockElement('div', { role: 'group', 'aria-labelledby': 'tools_question' });
  const ariaToolA = new MockElement('div', { role: 'checkbox', 'aria-label': 'Linting', 'data-value': 'lint', 'aria-checked': 'false' });
  const ariaToolB = new MockElement('div', { role: 'checkbox', 'aria-label': 'Testing', 'data-value': 'test', 'aria-checked': 'false' });
  ariaCheckboxGroup.appendChild(ariaToolA);
  ariaCheckboxGroup.appendChild(ariaToolB);
  container.appendChild(ariaCheckboxGroup);

  const quizGroup = new MockElement('section', { class: 'quiz-question' });
  const quizHeading = new MockElement('h2');
  quizHeading.textContent = 'Which city is the capital of France?';
  quizGroup.appendChild(quizHeading);
  const cityLondon = new MockElement('button', { type: 'button' });
  cityLondon.textContent = 'London';
  const cityParis = new MockElement('button', { type: 'button' });
  cityParis.textContent = 'Paris';
  const cityRome = new MockElement('button', { type: 'button' });
  cityRome.textContent = 'Rome';
  quizGroup.appendChild(cityLondon);
  quizGroup.appendChild(cityParis);
  quizGroup.appendChild(cityRome);
  container.appendChild(quizGroup);

  const shadowHost = new MockElement('div', { id: 'assessment-widget' });
  const shadowRoot = shadowHost.attachShadow();
  const shadowTitle = new MockElement('div', { id: 'shadow_question' });
  shadowTitle.textContent = 'Which runtime executes JavaScript in Chrome?';
  shadowRoot.appendChild(shadowTitle);
  const shadowGroup = new MockElement('div', { role: 'radiogroup', 'aria-labelledby': 'shadow_question' });
  const shadowV8 = new MockElement('div', { role: 'radio', 'aria-label': 'V8', 'data-value': 'v8', 'aria-checked': 'false' });
  const shadowSpiderMonkey = new MockElement('div', { role: 'radio', 'aria-label': 'SpiderMonkey', 'data-value': 'spidermonkey', 'aria-checked': 'false' });
  shadowGroup.appendChild(shadowV8);
  shadowGroup.appendChild(shadowSpiderMonkey);
  shadowRoot.appendChild(shadowGroup);
  container.appendChild(shadowHost);
  container.children.pop();
  container.children.splice(container.children.indexOf(quizGroup), 0, shadowHost);

  globalThis.document = {
    querySelector: selector => container.querySelector(selector),
    querySelectorAll: selector => container.querySelectorAll(selector),
    getElementById: id => container.querySelectorAll(`[id="${id}"]`)[0] || null
  };

  return {
    container, email, summary, notes, category,
    radioResearch, radioEducation, featureApi, featureExport, ariaA, ariaB, ariaToolA, ariaToolB,
    cityLondon, cityParis, cityRome, quizHeading, menuButton, shadowV8, shadowSpiderMonkey
  };
}

function runTests() {
  console.log('\n--- DOM extraction and grouped choices ---');
  const form = buildForm();
  const fields = extractFormFields(form.container);
  assert(fields.length === 10, 'Text, select, native, ARIA, custom, and shadow-root choice groups are described');
  assert(!Object.hasOwn(fields.find(field => field.id === 'email'), 'isPersonal'), 'Email fields are not classified or excluded');
  assert(fields.find(field => field.id === 'notes').hasExistingValue, 'Existing value is marked as protected');
  assert(!fields.some(field => Object.hasOwn(field, 'value')), 'Extracted context does not expose current values');

  const nativeRadio = fields.find(field => field.type === 'radio' && field.name === 'project_type');
  const nativeCheckbox = fields.find(field => field.type === 'checkbox' && field.name === 'features');
  const ariaRadio = fields.find(field => field.type === 'radio' && field.label === 'Choose the correct answer');
  const ariaCheckbox = fields.find(field => field.type === 'checkbox' && field.label === 'Choose useful tools');
  const customRadio = fields.find(field => field.type === 'radio' && field.label === 'Which city is the capital of France?');
  const shadowRadio = fields.find(field => field.type === 'radio' && field.label === 'Which runtime executes JavaScript in Chrome?');
  assert(nativeRadio?.options.length === 2, 'Native radio buttons are grouped with options');
  assert(nativeCheckbox?.options.length === 2, 'Native checkboxes are grouped with options');
  assert(ariaRadio?.options.length === 2, 'ARIA radio controls are grouped like Google Forms');
  assert(ariaCheckbox?.options.length === 2, 'ARIA checkbox controls are grouped like Google Forms');
  assert(customRadio?.options.length === 3, 'Quiz buttons are grouped as a radio question');
  assert(shadowRadio?.options.length === 2, 'Open shadow-root controls use accessible names and grouping');
  assert(!fields.some(field => field.label.toLowerCase().includes('menu')), 'Navigation menu is never classified as a choice');

  const shadowFilled = injectAnswers({ [shadowRadio.trackingId]: 'v8' }, form.container);
  assert(shadowFilled === 1 && form.shadowV8.getAttribute('aria-checked') === 'true',
    'Shadow-root radio answers can be injected through the composed DOM');

  console.log('\n--- Safe answer injection ---');
  const events = [];
  form.summary.addEventListener('input', () => events.push('summary'));
  form.category.addEventListener('change', () => events.push('category'));
  const report = injectAnswersWithReport({
    email: 'invented@example.com',
    summary: 'A concise project summary.',
    notes: 'Overwrite the existing answer',
    category: 'education',
    [nativeRadio.trackingId]: 'education',
    [nativeCheckbox.trackingId]: ['api', 'export'],
    [ariaRadio.trackingId]: 'b',
    [ariaCheckbox.trackingId]: ['lint', 'test'],
    [customRadio.trackingId]: 'Paris',
    [shadowRadio.trackingId]: 'v8'
  }, form.container);

  assert(report.filledCount === 8, 'Every eligible text and grouped choice question is filled');
  assert(form.email.value === 'invented@example.com', 'Personal-looking fields are filled like other fields');
  assert(form.notes.value === 'Keep this text', 'Existing field value is preserved');
  assert(form.summary.value === 'A concise project summary.', 'Eligible textarea is filled');
  assert(form.category.selectedIndex === 1, 'Eligible select option is chosen');
  assert(form.radioEducation.checked && !form.radioResearch.checked, 'Native radio answer is selected');
  assert(form.featureApi.checked && form.featureExport.checked, 'Multiple native checkboxes are selected');
  assert(form.ariaB.getAttribute('aria-checked') === 'true', 'ARIA radio answer is clicked');
  assert(form.ariaToolA.getAttribute('aria-checked') === 'true' && form.ariaToolB.getAttribute('aria-checked') === 'true', 'Multiple ARIA checkboxes are clicked');
  assert(form.cityParis.clicked && !form.cityLondon.clicked, 'Custom quiz answer button is clicked');
  assert(!form.menuButton.clicked, 'Menu button is never clicked');
  assert(report.detected.radio === 4 && report.detected.checkbox === 2, 'Status report includes all radio and checkbox groups');
  assert(report.filled.radio === 3 && report.filled.checkbox === 2, 'Status report includes completed choice groups');
  assert(events.includes('summary') && events.includes('category'), 'Synthetic events are dispatched');

  const overwritten = injectAnswers({ [nativeRadio.trackingId]: 'research' }, form.container);
  assert(overwritten === 0 && form.radioEducation.checked, 'Existing radio selection is never overwritten');

  const lateField = addLabeledField(form.container, 'Late generated field', new MockElement('input', { id: 'late_field', type: 'text' }));
  const repeatedReport = injectAnswersWithReport({
    [customRadio.trackingId]: 'Rome',
    late_field: 'Must remain empty'
  }, form.container);
  assert(repeatedReport.filledCount === 0 && repeatedReport.blockedUntilContentChanges &&
    !form.cityRome.clicked && lateField.value === '',
  'All interaction is locked while custom quiz content is unchanged');

  form.quizHeading.textContent = 'Which city is the capital of Spain?';
  form.cityLondon.textContent = 'Berlin';
  form.cityParis.textContent = 'Madrid';
  form.cityRome.textContent = 'Lisbon';
  const changedQuestion = extractFormFields(form.container).find(field =>
    field.type === 'radio' && field.label === 'Which city is the capital of Spain?'
  );
  const nextQuestionClick = injectAnswers({ [changedQuestion.trackingId]: 'Madrid' }, form.container);
  assert(nextQuestionClick === 1 && form.cityParis.clickCount === 2, 'Quiz interaction unlocks after question content changes');

  const ambiguous = new MockElement('fieldset');
  const ambiguousLegend = new MockElement('legend');
  ambiguousLegend.textContent = 'Question 1';
  ambiguous.appendChild(ambiguousLegend);
  const ambiguousA = addNativeChoice(ambiguous, 'radio', 'ambiguous_a', 'question_1', 'a', 'Option');
  const ambiguousB = addNativeChoice(ambiguous, 'radio', 'ambiguous_b', 'question_1', 'b', 'Option');
  form.container.appendChild(ambiguous);
  const ambiguousField = extractFormFields(form.container).find(field => field.name === 'question_1');
  assert(ambiguousField?.qualityValid === false && ambiguousField.qualityIssues.includes('duplicate-options'),
    'Missing or duplicated choice context is marked invalid');
  const ambiguousReport = injectAnswersWithReport({ [ambiguousField.trackingId]: 'a' }, form.container);
  assert(!ambiguousA.clicked && !ambiguousB.clicked && ambiguousReport.invalid.radio >= 1,
    'Invalid choice groups are reported and never clicked');

  const semanticSection = new MockElement('section');
  const semanticQuestion = new MockElement('p');
  semanticQuestion.textContent = 'Which statements are correct?';
  semanticSection.appendChild(semanticQuestion);
  const semanticOptionA = new MockElement('div', { role: 'checkbox', 'aria-label': 'First statement', 'aria-checked': 'false' });
  const semanticOptionB = new MockElement('div', { role: 'checkbox', 'aria-label': 'Second statement', 'aria-checked': 'false' });
  semanticSection.appendChild(semanticOptionA);
  semanticSection.appendChild(semanticOptionB);
  const inferredGroup = extractFormFields(semanticSection)[0];
  assert(inferredGroup?.label === 'Which statements are correct?' && inferredGroup.options.length === 2,
    'Accessible question context infers a group when controls omit an explicit group role');

  const nptelCard = new MockElement('div', { class: 'p-3 sm:p-5 w-full' });
  const nptelQuestion = new MockElement('div', { class: 'flex items-start justify-between' });
  nptelQuestion.textContent = '1. Based on Lecture 37, which statements are correct? 1 Point';
  const nptelOptions = new MockElement('div', { class: 'space-y-3 mt-4' });
  nptelCard.appendChild(nptelQuestion);
  nptelCard.appendChild(nptelOptions);
  const nptelChoices = ['Gestures regulate interaction', 'Words are always required', 'Silence communicates'];
  nptelChoices.forEach(text => {
    const label = new MockElement('label');
    const input = new MockElement('input', { type: 'checkbox', name: 'rFpvLxQt025v_6672786799460352' });
    const caption = new MockElement('span');
    caption.textContent = text;
    label.appendChild(input);
    label.appendChild(caption);
    nptelOptions.appendChild(label);
  });
  const nptelField = extractFormFields(nptelCard)[0];
  assert(nptelField?.label === '1. Based on Lecture 37, which statements are correct?' &&
    nptelField.options.length === 3 && nptelField.qualityValid,
  'NPTEL-style randomized groups use the preceding rendered question instead of the machine name');

  console.log(`\nDOM tests: ${passed} passed, ${failed} failed\n`);
  if (failed) process.exit(1);
}

runTests();

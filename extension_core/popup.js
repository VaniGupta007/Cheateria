import { MESSAGE_TYPES } from '../shared_config/settings.js';
import { selectBestFrame } from './frame_selector.js';

const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const statusDetail = document.getElementById('statusDetail');
const fieldStatus = document.getElementById('fieldStatus');
const instructionForm = document.getElementById('instructionForm');
const instructionInput = document.getElementById('instructionInput');
const submitButton = document.getElementById('submitButton');

let requestInFlight = false;

function renderFieldStatus(report) {
  fieldStatus.replaceChildren();
  if (!report?.detected) {
    fieldStatus.hidden = true;
    return;
  }

  const categories = [
    ['text', 'Text'],
    ['radio', 'Radio'],
    ['checkbox', 'Checkbox'],
    ['select', 'Select']
  ];

  categories.forEach(([key, label]) => {
    const detected = Number(report.detected[key] || 0);
    if (detected === 0) return;
    const filled = Number(report.filled?.[key] || 0);
    const preserved = Number(report.preserved?.[key] || 0);
    const invalid = Number(report.invalid?.[key] || 0);
    const item = document.createElement('div');
    item.className = 'field-status-item';
    item.title = `${detected} detected, ${filled} completed, ${preserved} preserved, ${invalid} skipped as ambiguous`;

    const name = document.createElement('span');
    name.textContent = label;
    const count = document.createElement('strong');
    count.textContent = `${filled}/${detected}`;
    item.append(name, count);
    fieldStatus.appendChild(item);
  });
  fieldStatus.hidden = fieldStatus.childElementCount === 0;
}

function setStatus(state, text, detail = '', report = null) {
  statusIndicator.className = `status-indicator ${state}`;
  statusText.className = `status-text ${state}`;
  statusText.textContent = text;
  statusDetail.textContent = detail;
  renderFieldStatus(report);
}

function isRestrictedUrl(url = '') {
  return /^(chrome|edge|about|devtools|view-source):/i.test(url) ||
    /^https:\/\/chromewebstore\.google\.com\//i.test(url);
}

async function scanFrames(tabId) {
  const scan = async () => chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      const api = globalThis.__AIAutoFiller;
      if (!api?.extractFormFields) return null;
      const fields = api.extractFormFields();
      const fingerprint = JSON.stringify(fields.map(field => ({
        type: field.type,
        label: field.label,
        options: field.options?.map(option => [option.value, option.text]) || [],
        hasExistingValue: field.hasExistingValue,
        qualityValid: field.qualityValid
      })));
      return {
        fields,
        fingerprint,
        url: globalThis.location?.href || '',
        title: globalThis.document?.title || ''
      };
    }
  });

  let results = await scan();
  if (!results.some(item => item.result)) {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['extension_core/content_script.js']
    });
    results = await scan();
  }

  return results
    .filter(item => item.result)
    .map(item => ({ frameId: item.frameId, ...item.result }));
}

async function injectIntoFrame(tabId, frameId, expectedFingerprint, answers) {
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    func: (fingerprint, generatedAnswers) => {
      const api = globalThis.__AIAutoFiller;
      if (!api?.extractFormFields || !api?.injectAnswersWithReport) {
        return { success: false, error: 'The form helper is no longer available in this frame.' };
      }
      const currentFields = api.extractFormFields();
      const currentFingerprint = JSON.stringify(currentFields.map(field => ({
        type: field.type,
        label: field.label,
        options: field.options?.map(option => [option.value, option.text]) || [],
        hasExistingValue: field.hasExistingValue,
        qualityValid: field.qualityValid
      })));
      if (currentFingerprint !== fingerprint) {
        return { success: false, error: 'The form changed while answers were being generated. Run the extension again.' };
      }
      return { success: true, report: api.injectAnswersWithReport(generatedAnswers) };
    },
    args: [expectedFingerprint, answers]
  });
  return execution?.result || { success: false, error: 'The form frame did not return an injection result.' };
}

async function fillCurrentForm(instruction = '') {
  if (requestInFlight) return;
  requestInFlight = true;
  submitButton.disabled = true;
  instructionInput.disabled = true;
  setStatus('loading', 'Working', instruction ? 'Understanding your request' : 'Reading the current form');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab is available.');
    if (isRestrictedUrl(tab.url)) throw new Error('Chrome does not allow extensions to edit this page.');

    const selectedFrame = selectBestFrame(await scanFrames(tab.id));
    if (!selectedFrame) {
      throw new Error('No trustworthy form fields were found in this page or its frames.');
    }

    const response = await chrome.runtime.sendMessage({
      action: MESSAGE_TYPES.PROCESS_FORM,
      fields: selectedFrame.fields,
      instruction
    });
    if (!response?.success) throw new Error(response?.error || 'The form could not be filled.');

    const injection = await injectIntoFrame(
      tab.id,
      selectedFrame.frameId,
      selectedFrame.fingerprint,
      response.answers
    );
    if (!injection.success) throw new Error(injection.error || 'The generated answers could not be applied.');

    const report = injection.report;
    const count = Number(report?.filledCount || 0);
    const choiceDetected = Number(report?.detected?.radio || 0) +
      Number(report?.detected?.checkbox || 0);
    const detail = report?.blockedUntilContentChanges
      ? 'Waiting for the quiz content to change'
      : count === 1
      ? '1 empty field completed'
      : count > 1
        ? `${count} empty fields completed`
        : choiceDetected > 0
          ? `${choiceDetected} choice question${choiceDetected === 1 ? '' : 's'} detected; no answer was applied`
          : 'No eligible empty fields needed changes';
    setStatus('success', 'Successful', detail, report);
    if (instruction) instructionInput.value = '';
  } catch (error) {
    console.error('Form fill failed:', error);
    setStatus('error', 'Could not complete', error.message || 'Please refresh the page and try again.');
  } finally {
    requestInFlight = false;
    submitButton.disabled = false;
    instructionInput.disabled = false;
  }
}

instructionForm.addEventListener('submit', event => {
  event.preventDefault();
  const instruction = instructionInput.value.trim();
  if (!instruction) {
    instructionInput.focus();
    return;
  }
  fillCurrentForm(instruction);
});

document.addEventListener('DOMContentLoaded', () => {
  fillCurrentForm();
});

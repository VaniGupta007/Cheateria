/**
 * Content Script - DOM Interaction & Form Extraction / Injection
 * Manifest V3 classic content script for scanning forms, extracting field questions,
 * and injecting AI-generated answers with synthetic reactive events.
 */

console.log('[AI Auto-Filler Content] Script loaded on:', window.location.href);

// Supported input types to include
const SUPPORTED_INPUT_TYPES = new Set([
  'text', 'email', 'tel', 'number', 'url', 'search',
  'password', 'date', 'datetime-local', 'time', 'month', 'week',
  'checkbox', 'radio'
]);

// Ignored input types
const IGNORED_INPUT_TYPES = new Set([
  'hidden', 'submit', 'button', 'reset', 'image', 'file'
]);

/**
 * Finds the most descriptive label or question text for a form element.
 *
 * @param {HTMLElement} element - The form control element.
 * @returns {string} The resolved label / question text.
 */
function findLabelForElement(element) {
  if (!element) return '';

  // 1. Direct label via `for` attribute
  if (element.id) {
    const explicitLabel = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    if (explicitLabel && explicitLabel.textContent.trim()) {
      return explicitLabel.textContent.trim();
    }
  }

  // 2. Enclosing parent <label>
  const parentLabel = element.closest('label');
  if (parentLabel && parentLabel.textContent.trim()) {
    const clone = parentLabel.cloneNode(true);
    const nestedInput = clone.querySelector('input, textarea, select');
    if (nestedInput) nestedInput.remove();
    const text = clone.textContent.trim();
    if (text) return text;
  }

  // 3. aria-labelledby
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl && labelEl.textContent.trim()) {
      return labelEl.textContent.trim();
    }
  }

  // 4. aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) {
    return ariaLabel.trim();
  }

  // 5. Placeholder
  const placeholder = element.getAttribute('placeholder');
  if (placeholder && placeholder.trim()) {
    return placeholder.trim();
  }

  // 6. Preceding sibling label or title text
  let prev = element.previousElementSibling;
  while (prev) {
    if (['LABEL', 'SPAN', 'P', 'H4', 'H5', 'STRONG', 'B'].includes(prev.tagName) && prev.textContent.trim()) {
      return prev.textContent.trim();
    }
    prev = prev.previousElementSibling;
  }

  // 7. Fallback to name or id formatted cleanly
  const rawIdentifier = element.getAttribute('name') || element.id || '';
  if (rawIdentifier) {
    return rawIdentifier.replace(/[-_]/g, ' ').replace(/([A-Z])/g, ' $1').trim();
  }

  return '';
}

/**
 * Scans a DOM container for form fields and extracts a structured schema.
 *
 * @param {Document|HTMLElement} container - DOM node to scan (default: document)
 * @returns {Array<Object>} List of field descriptors
 */
function extractFormFields(container = document) {
  console.log('[AI Auto-Filler Content] Scanning DOM container for fillable fields...');
  const elements = container.querySelectorAll('input, textarea, select');
  const fields = [];
  let fieldCounter = 0;

  elements.forEach((el) => {
    const tagName = el.tagName.toLowerCase();
    const inputType = (el.getAttribute('type') || 'text').toLowerCase();

    // Skip ignored types and non-visible/disabled elements
    if (tagName === 'input' && IGNORED_INPUT_TYPES.has(inputType)) {
      return;
    }
    if (el.disabled || el.readOnly) {
      return;
    }

    fieldCounter++;
    const elementId = el.id || '';
    const elementName = el.getAttribute('name') || '';
    const trackingId = el.getAttribute('data-autofill-id') || `af_${fieldCounter}_${Date.now()}`;
    el.setAttribute('data-autofill-id', trackingId);

    const label = findLabelForElement(el);
    const placeholder = el.getAttribute('placeholder') || '';

    const fieldData = {
      trackingId,
      id: elementId,
      name: elementName,
      key: elementId || elementName || trackingId,
      type: tagName === 'input' ? inputType : tagName,
      label,
      placeholder,
      value: el.value || ''
    };

    if (tagName === 'select') {
      fieldData.options = Array.from(el.options).map(opt => ({
        value: opt.value,
        text: opt.textContent.trim()
      })).filter(opt => opt.text || opt.value);
    }

    console.log(`[AI Auto-Filler Content] Detected field #${fieldCounter}:`, {
      id: fieldData.id,
      name: fieldData.name,
      type: fieldData.type,
      label: fieldData.label
    });

    fields.push(fieldData);
  });

  console.log(`[AI Auto-Filler Content] Total fields extracted: ${fields.length}`);
  return fields;
}

/**
 * Dispatches synthetic input, change, and blur events to trigger framework reactive bindings.
 *
 * @param {HTMLElement} element - Target form control.
 */
function dispatchInputEvents(element) {
  try {
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
  } catch (err) {
    console.warn('[AI Auto-Filler Content] Failed to dispatch synthetic event:', err);
  }
}

/**
 * Injects answer values back into matching DOM fields.
 *
 * @param {Record<string, any>} answers - Map of field identifier/key to answer value.
 * @param {Document|HTMLElement} container - Container to inject into.
 * @returns {number} Number of successfully injected fields.
 */
function injectAnswers(answers, container = document) {
  console.log('[AI Auto-Filler Content] Starting DOM injection with answers:', answers);

  if (!answers || typeof answers !== 'object') {
    console.error('[AI Auto-Filler Content] Invalid answers object received:', answers);
    return 0;
  }

  let filledCount = 0;
  const elements = container.querySelectorAll('input, textarea, select');

  elements.forEach((el) => {
    const trackingId = el.getAttribute('data-autofill-id');
    const id = el.id;
    const name = el.getAttribute('name');

    // Look up answer by trackingId, id, or name
    let answer = undefined;
    if (trackingId && answers[trackingId] !== undefined) {
      answer = answers[trackingId];
    } else if (id && answers[id] !== undefined) {
      answer = answers[id];
    } else if (name && answers[name] !== undefined) {
      answer = answers[name];
    } else {
      const foundKey = Object.keys(answers).find(k =>
        (id && k.toLowerCase() === id.toLowerCase()) ||
        (name && k.toLowerCase() === name.toLowerCase())
      );
      if (foundKey) {
        answer = answers[foundKey];
      }
    }

    if (answer === undefined || answer === null) {
      return;
    }

    const tagName = el.tagName.toLowerCase();
    const inputType = (el.getAttribute('type') || 'text').toLowerCase();
    const identifier = id || name || trackingId;

    console.log(`[AI Auto-Filler Content] Injecting answer into [${identifier}] (${tagName}/${inputType}):`, answer);

    // 1. Textarea & standard text-like inputs
    if (tagName === 'textarea' || (tagName === 'input' && !['checkbox', 'radio'].includes(inputType))) {
      const valStr = String(answer);

      // Prototype setter bypass for React/Vue reactive state tracking
      const proto = tagName === 'textarea' ? window.HTMLTextAreaElement?.prototype : window.HTMLInputElement?.prototype;
      const nativeSetter = proto ? Object.getOwnPropertyDescriptor(proto, 'value')?.set : null;
      if (nativeSetter) {
        nativeSetter.call(el, valStr);
      } else {
        el.value = valStr;
      }

      dispatchInputEvents(el);
      filledCount++;
      highlightField(el);
    }
    // 2. Checkboxes
    else if (tagName === 'input' && inputType === 'checkbox') {
      const shouldCheck = Boolean(answer === true || answer === 'true' || answer === el.value || answer === '1');
      if (el.checked !== shouldCheck) {
        el.checked = shouldCheck;
        dispatchInputEvents(el);
        filledCount++;
        highlightField(el);
      }
    }
    // 3. Radio buttons
    else if (tagName === 'input' && inputType === 'radio') {
      const isMatch = (el.value && String(el.value).toLowerCase() === String(answer).toLowerCase()) ||
                      (findLabelForElement(el).toLowerCase() === String(answer).toLowerCase());
      if (isMatch) {
        el.checked = true;
        dispatchInputEvents(el);
        filledCount++;
        highlightField(el);
      }
    }
    // 4. Select dropdowns
    else if (tagName === 'select') {
      const ansStr = String(answer).toLowerCase().trim();
      let matchedIndex = -1;

      for (let i = 0; i < el.options.length; i++) {
        const opt = el.options[i];
        if (opt.value.toLowerCase() === ansStr || opt.textContent.trim().toLowerCase() === ansStr) {
          matchedIndex = i;
          break;
        }
      }

      if (matchedIndex !== -1) {
        for (let i = 0; i < el.options.length; i++) {
          const opt = el.options[i];
          if (opt.textContent.trim().toLowerCase().includes(ansStr) || ansStr.includes(opt.textContent.trim().toLowerCase())) {
            matchedIndex = i;
            break;
          }
        }
      }

      if (matchedIndex !== -1) {
        el.selectedIndex = matchedIndex;
        dispatchInputEvents(el);
        filledCount++;
        highlightField(el);
      }
    }
  });

  console.log(`[AI Auto-Filler Content] Injected answers into ${filledCount} fields.`);
  return filledCount;
}

/**
 * Adds a subtle visual highlight animation to indicate the field was filled by AI.
 *
 * @param {HTMLElement} element
 */
function highlightField(element) {
  if (!element || !element.style) return;
  const originalOutline = element.style.outline;
  const originalTransition = element.style.transition;

  element.style.transition = 'outline 0.3s ease-in-out';
  element.style.outline = '2px solid #4f46e5';

  setTimeout(() => {
    element.style.outline = originalOutline;
    element.style.transition = originalTransition;
  }, 1200);
}

// Expose API on global scope for environment and testing access
const autoFillerApi = {
  findLabelForElement,
  extractFormFields,
  injectAnswers,
  dispatchInputEvents
};

if (typeof globalThis !== 'undefined') {
  globalThis.__AIAutoFiller = autoFillerApi;
}
if (typeof window !== 'undefined') {
  window.__AIAutoFiller = autoFillerApi;
}

// Register Chrome runtime message passing listener
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  console.log('[AI Auto-Filler Content] Registering chrome.runtime.onMessage listener...');

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[AI Auto-Filler Content] Received message from:', sender?.id ? 'extension' : sender, request);

    if (request.action === 'PING') {
      console.log('[AI Auto-Filler Content] Received PING. Responding PONG.');
      sendResponse({ status: 'PONG', active: true });
      return true;
    }

    if (request.action === 'FILL_FORM') {
      console.log('[AI Auto-Filler Content] Initiating form extraction and fill workflow...');
      const fields = extractFormFields();

      if (fields.length === 0) {
        console.warn('[AI Auto-Filler Content] No fillable fields detected on page.');
        sendResponse({ success: false, error: 'No fillable form fields found on this page.' });
        return true;
      }

      console.log(`[AI Auto-Filler Content] Sending ${fields.length} fields to background service worker...`);

      chrome.runtime.sendMessage({
        action: 'PROCESS_FORM',
        fields
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[AI Auto-Filler Content] Error from background service worker:', chrome.runtime.lastError.message);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
          return;
        }

        console.log('[AI Auto-Filler Content] Background response received:', response);

        if (response && response.success && response.answers) {
          const filledCount = injectAnswers(response.answers);
          console.log(`[AI Auto-Filler Content] Completed fill process. Fields populated: ${filledCount}`);
          sendResponse({ success: true, filledCount });
        } else {
          console.error('[AI Auto-Filler Content] AI processing failed:', response?.error);
          sendResponse({ success: false, error: response?.error || 'Unknown error during AI processing.' });
        }
      });

      return true; // Keep message channel open for async response
    }
  });

  console.log('[AI Auto-Filler Content] Message listener successfully registered.');
}

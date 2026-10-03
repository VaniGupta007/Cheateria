/**
 * Classic Manifest V3 content script for safe form extraction and injection.
 */

(() => {
  if (globalThis.__CHEATERIA_CONTENT_SCRIPT_READY__) return;
  globalThis.__CHEATERIA_CONTENT_SCRIPT_READY__ = true;

  const CONTROL_SELECTOR = 'input, textarea, select, button, [role="radio"], [role="checkbox"]';
  const IGNORED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file']);
  const NON_CHOICE_BUTTON_PATTERN = /\b(submit|next|previous|back|continue|start|restart|retry|share|menu|navigation|close|cancel|save|sign\s*in|log\s*in|subscribe|newsletter|learn\s+more|search|account|settings)\b/i;
  const choiceInteractionState = globalThis.__CHEATERIA_CHOICE_STATE__ || { completed: new Set() };
  globalThis.__CHEATERIA_CHOICE_STATE__ = choiceInteractionState;

  function getDocument(element) {
    return element?.ownerDocument || globalThis.document;
  }

  function getComposedParent(element) {
    if (element?.parentElement) return element.parentElement;
    const root = element?.getRootNode?.();
    return root?.host || null;
  }

  function closestComposed(element, selector) {
    let current = element;
    while (current) {
      const match = current.closest?.(selector);
      if (match) return match;
      const root = current.getRootNode?.();
      current = root?.host || null;
    }
    return null;
  }

  function queryAllDeep(container, selector) {
    const results = [];
    const roots = [container];
    const seenRoots = new Set();
    while (roots.length > 0) {
      const root = roots.shift();
      if (!root || seenRoots.has(root)) continue;
      seenRoots.add(root);
      results.push(...Array.from(root.querySelectorAll?.(selector) || []));
      for (const element of Array.from(root.querySelectorAll?.('*') || [])) {
        if (element.shadowRoot) roots.push(element.shadowRoot);
      }
    }
    return [...new Set(results)];
  }

  function findByIdNearElement(element, id) {
    const root = element?.getRootNode?.();
    const localMatch = root?.getElementById?.(id) ||
      root?.querySelector?.(`[id="${globalThis.CSS?.escape ? CSS.escape(id) : id}"]`);
    return localMatch || getDocument(element)?.getElementById?.(id) || null;
  }

  function getLabelledByText(element) {
    const labelledBy = element?.getAttribute?.('aria-labelledby');
    if (!labelledBy) return '';
    return labelledBy.split(/\s+/)
      .map(id => findByIdNearElement(element, id)?.textContent?.trim() || '')
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  function findLabelForElement(element) {
    if (!element) return '';
    const ownerDocument = getDocument(element);

    const labelledText = getLabelledByText(element);
    if (labelledText) return labelledText;

    const ariaLabel = element.getAttribute?.('aria-label');
    if (ariaLabel?.trim()) return ariaLabel.trim();

    const associatedLabel = Array.from(element.labels || [])
      .map(label => label.textContent?.trim() || '')
      .find(Boolean);
    if (associatedLabel) return associatedLabel;

    if (element.id && typeof ownerDocument?.querySelector === 'function') {
      const escapedId = globalThis.CSS?.escape ? CSS.escape(element.id) : element.id;
      const root = element.getRootNode?.();
      const label = root?.querySelector?.(`label[for="${escapedId}"]`) ||
        ownerDocument.querySelector(`label[for="${escapedId}"]`);
      if (label?.textContent?.trim()) return label.textContent.trim();
    }

    const parentLabel = closestComposed(element, 'label');
    if (parentLabel?.textContent?.trim()) {
      const clone = parentLabel.cloneNode(true);
      clone.querySelector?.(CONTROL_SELECTOR)?.remove?.();
      if (clone.textContent?.trim()) return clone.textContent.trim();
    }

    for (const attribute of ['alt', 'data-value', 'placeholder', 'title']) {
      const value = element.getAttribute?.(attribute);
      if (value?.trim()) return value.trim();
    }

    let previous = element.previousElementSibling;
    while (previous) {
      if (['LABEL', 'SPAN', 'P', 'H4', 'H5', 'STRONG', 'B', 'LEGEND'].includes(previous.tagName) && previous.textContent?.trim()) {
        return previous.textContent.trim();
      }
      previous = previous.previousElementSibling;
    }

    const identifier = element.getAttribute?.('name') || element.id || '';
    return identifier.replace(/[-_]/g, ' ').replace(/([A-Z])/g, ' $1').trim();
  }

  function getControlKind(element) {
    const role = (element.getAttribute?.('role') || '').toLowerCase();
    if (role === 'radio' || role === 'checkbox') return role;
    const tagName = element.tagName?.toLowerCase();
    if (tagName === 'textarea' || tagName === 'select') return tagName;
    if (tagName === 'button') {
      return element.getAttribute?.('aria-pressed') !== null ? 'checkbox' : 'button-choice';
    }
    return (element.getAttribute?.('type') || 'text').toLowerCase();
  }

  function isControlSelected(element) {
    const role = (element.getAttribute?.('role') || '').toLowerCase();
    if (role === 'radio' || role === 'checkbox') {
      return element.getAttribute('aria-checked') === 'true';
    }
    if (element.tagName?.toLowerCase() === 'button') {
      const classes = String(element.className || element.getAttribute?.('class') || '');
      return element.getAttribute?.('aria-pressed') === 'true' ||
        element.getAttribute?.('data-selected') === 'true' ||
        /\b(selected|checked|active|chosen)\b/i.test(classes);
    }
    return Boolean(element.checked);
  }

  function hasExistingValue(element, relatedControls = [element]) {
    const kind = getControlKind(element);
    if (kind === 'radio' || kind === 'checkbox' || kind === 'button-choice') {
      return relatedControls.some(isControlSelected);
    }
    return String(element.value ?? '').trim() !== '';
  }

  function findInferredChoiceContainer(control, kind) {
    const selector = kind === 'radio'
      ? 'input[type="radio"], [role="radio"]'
      : 'input[type="checkbox"], [role="checkbox"]';
    let ancestor = getComposedParent(control);
    for (let level = 0; ancestor && level < 6; level++, ancestor = getComposedParent(ancestor)) {
      const tagName = ancestor.tagName?.toLowerCase();
      if (['body', 'html', 'main', 'form'].includes(tagName)) continue;
      const peers = Array.from(ancestor.querySelectorAll?.(selector) || [])
        .filter(candidate => getControlKind(candidate) === kind);
      if (peers.length < 2 || peers.length > 20 || !peers.includes(control)) continue;
      const hasQuestionSemantics = Boolean(
        getLabelledByText(ancestor) ||
        ancestor.getAttribute?.('aria-label')?.trim() ||
        ancestor.querySelector?.('legend, [role="heading"], h1, h2, h3, h4, h5, h6, p, [data-question-title], [data-question-text]')
      );
      if (hasQuestionSemantics) return ancestor;
    }
    return null;
  }

  function getChoiceGroupIdentity(control, kind) {
    const role = (control.getAttribute?.('role') || '').toLowerCase();
    if (role) {
      const explicitGroup = closestComposed(control, kind === 'radio'
        ? '[role="radiogroup"], fieldset'
        : '[role="group"], fieldset');
      return explicitGroup || findInferredChoiceContainer(control, kind) || control.parentElement || control;
    }
    const name = control.getAttribute?.('name');
    if (name) return `native:${kind}:${name}`;
    return closestComposed(control, 'fieldset, [role="group"]') ||
      findInferredChoiceContainer(control, kind) || control;
  }

  function isPotentialChoiceButton(button) {
    if (button.tagName?.toLowerCase() !== 'button' || button.disabled ||
        button.getAttribute?.('aria-disabled') === 'true' ||
        (button.getAttribute?.('type') || '').toLowerCase() === 'submit' ||
        button.getAttribute?.('aria-haspopup') ||
        button.getAttribute?.('aria-expanded') !== null ||
        button.getAttribute?.('aria-controls')) return false;
    const text = button.textContent?.trim() || button.getAttribute?.('aria-label')?.trim() || '';
    const descriptor = [
      text,
      button.getAttribute?.('aria-label'),
      button.getAttribute?.('title'),
      button.id,
      button.getAttribute?.('class')
    ].filter(Boolean).join(' ');
    return text.length > 0 && text.length <= 160 && !NON_CHOICE_BUTTON_PATTERN.test(descriptor);
  }

  function hasNavigationContext(button) {
    let ancestor = button;
    for (let level = 0; ancestor && level < 7; level++, ancestor = getComposedParent(ancestor)) {
      const tagName = ancestor.tagName?.toLowerCase();
      const role = (ancestor.getAttribute?.('role') || '').toLowerCase();
      const descriptor = [ancestor.id, ancestor.getAttribute?.('class')].filter(Boolean).join(' ');
      if (['header', 'nav', 'footer'].includes(tagName) ||
          ['navigation', 'menu', 'menubar'].includes(role) ||
          /\b(menu|navbar|navigation|site-header|site-footer|hamburger)\b/i.test(descriptor)) return true;
    }
    return false;
  }

  function findCustomButtonGroup(button) {
    if (!isPotentialChoiceButton(button) || hasNavigationContext(button)) return null;
    const isQuizPage = /\b(quiz|question|trivia|test)\b/i.test(
      `${globalThis.location?.pathname || ''} ${globalThis.location?.hostname || ''}`
    );
    let ancestor = getComposedParent(button);
    let bestMatch = null;
    let bestScore = -1;

    for (let level = 0; ancestor && level < 6; level++, ancestor = getComposedParent(ancestor)) {
      if (['body', 'html', 'header', 'nav', 'main', 'footer'].includes(ancestor.tagName?.toLowerCase())) continue;
      const candidates = Array.from(ancestor.querySelectorAll?.('button') || [])
        .filter(candidate => isPotentialChoiceButton(candidate) && !hasNavigationContext(candidate));
      if (candidates.length < 2 || candidates.length > 12 || !candidates.includes(button)) continue;

      const hint = [
        ancestor.id,
        ancestor.getAttribute?.('class'),
        ancestor.getAttribute?.('data-question'),
        ancestor.getAttribute?.('data-quiz')
      ].filter(Boolean).join(' ');
      const heading = ancestor.querySelector?.('[role="heading"], h1, h2, h3, h4, legend, [data-question-title]');
      const headingText = heading?.textContent?.trim() || '';
      const hasHint = /\b(quiz|question|answer|choice|option)\b/i.test(hint);
      const hasQuestionContext = hasHint || headingText.endsWith('?') ||
        (isQuizPage && /\b(quiz|question|trivia|guess)\b/i.test(headingText));
      if (!hasQuestionContext) continue;

      const score = candidates.length + (hasHint ? 30 : 0) +
        (headingText ? 10 : 0) + (headingText.endsWith('?') ? 30 : 0);
      if (score > bestScore) {
        bestMatch = ancestor;
        bestScore = score;
      }
    }
    return bestMatch;
  }

  function findChoiceQuestionLabel(groupIdentity, controls) {
    if (typeof groupIdentity !== 'string') {
      const labelledText = getLabelledByText(groupIdentity);
      if (labelledText) return labelledText;
      const ariaLabel = groupIdentity.getAttribute?.('aria-label');
      if (ariaLabel?.trim()) return ariaLabel.trim();
      const heading = groupIdentity.querySelector?.('[role="heading"], h1, h2, h3, h4, h5, h6, legend, p, [data-question-title], [data-question-text]');
      if (heading?.textContent?.trim()) return heading.textContent.trim();
      let previous = groupIdentity.previousElementSibling;
      while (previous) {
        if (previous.textContent?.trim()) return previous.textContent.trim();
        previous = previous.previousElementSibling;
      }
    }

    const first = controls[0];
    const fieldset = closestComposed(first, 'fieldset');
    const legend = fieldset?.querySelector?.('legend');
    if (legend?.textContent?.trim()) return legend.textContent.trim();

    const contextualLabel = findQuestionContextForControls(controls);
    if (contextualLabel) return contextualLabel;

    const groupName = first?.getAttribute?.('name') || '';
    return groupName ? groupName.replace(/[-_]/g, ' ').replace(/([A-Z])/g, ' $1').trim() : '';
  }

  function containsComposed(ancestor, element) {
    if (ancestor?.contains?.(element)) return true;
    let current = element;
    while (current) {
      if (current === ancestor) return true;
      current = getComposedParent(current);
    }
    return false;
  }

  function findCommonAncestor(elements) {
    if (!elements.length) return null;
    let candidate = elements[0];
    while (candidate && !elements.every(element => containsComposed(candidate, element))) {
      candidate = getComposedParent(candidate);
    }
    return candidate;
  }

  function cleanQuestionText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/\s+\d+\s*Points?\s*$/i, '')
      .trim();
  }

  function findQuestionContextForControls(controls) {
    let branch = findCommonAncestor(controls);
    for (let level = 0; branch && level < 6; level++, branch = getComposedParent(branch)) {
      let previous = branch.previousElementSibling;
      for (let siblingCount = 0; previous && siblingCount < 3; siblingCount++, previous = previous.previousElementSibling) {
        const text = cleanQuestionText(previous.innerText || previous.textContent);
        if (text.length >= 8) return text;
      }
    }
    return '';
  }

  function getChoiceOption(control) {
    const ownText = control.tagName?.toLowerCase() === 'button' ? control.textContent?.trim() : '';
    const label = ownText || findLabelForElement(control);
    const value = control.getAttribute?.('data-value') || control.value || control.getAttribute?.('value') || label;
    return {
      value: String(value || label).trim(),
      text: String(label || value).trim()
    };
  }

  function assessFieldQuality(field) {
    const issues = [];
    const label = String(field.label || field.placeholder || '').trim();
    if (!label) issues.push('missing-question');
    if (/^(q|question|answer|option|field|input|choice)(?:\s*\d+)?$/i.test(label)) {
      issues.push('generic-question');
    }
    if (/^[a-z0-9]{8,}\s+\d{6,}$/i.test(label)) issues.push('machine-generated-question');

    if (['radio', 'checkbox', 'select'].includes(field.type)) {
      const options = Array.isArray(field.options) ? field.options : [];
      const normalizedLabels = options.map(option => normalizeChoiceValue(option.text || option.value));
      const normalizedValues = options.map(option => normalizeChoiceValue(option.value || option.text));
      if (options.some((option, index) => !normalizedLabels[index] || !normalizedValues[index])) {
        issues.push('empty-option');
      }
      if (new Set(normalizedLabels).size !== normalizedLabels.length ||
          new Set(normalizedValues).size !== normalizedValues.length) {
        issues.push('duplicate-options');
      }
      if (field.type === 'radio' && options.length < 2) issues.push('too-few-options');
      if ((field.type === 'checkbox' || field.type === 'select') && options.length < 1) {
        issues.push('too-few-options');
      }
      if (normalizedLabels.includes(normalizeChoiceValue(label))) issues.push('question-equals-option');
    }

    return { qualityValid: issues.length === 0, qualityIssues: issues };
  }

  function scanFields(container = document) {
    const controls = queryAllDeep(container, CONTROL_SELECTOR);
    const descriptors = [];
    const handled = new Set();
    const choiceGroups = [];

    controls.forEach((control, index) => {
      if (handled.has(control)) return;
      const kind = getControlKind(control);
      const tagName = control.tagName?.toLowerCase();
      if ((tagName === 'input' && IGNORED_INPUT_TYPES.has(kind)) ||
          control.disabled || control.readOnly || control.getAttribute?.('aria-disabled') === 'true') return;

      if (kind === 'radio' || kind === 'checkbox' || kind === 'button-choice') {
        const isButton = tagName === 'button';
        const choiceKind = kind === 'button-choice' ? 'radio' : kind;
        const identity = isButton ? findCustomButtonGroup(control) : getChoiceGroupIdentity(control, choiceKind);
        if (!identity) return;
        let group = choiceGroups.find(candidate => candidate.kind === choiceKind && candidate.identity === identity);
        if (!group) {
          group = { kind: choiceKind, identity, controls: [], customButton: isButton };
          choiceGroups.push(group);
        }
        group.controls.push(control);
        return;
      }

      handled.add(control);
      const trackingId = control.getAttribute('data-autofill-id') || `af_${index + 1}_${Date.now()}`;
      control.setAttribute('data-autofill-id', trackingId);
      const label = findLabelForElement(control);
      const field = {
        trackingId,
        key: trackingId,
        id: control.id || '',
        name: control.getAttribute('name') || '',
        type: kind,
        label,
        placeholder: control.getAttribute('placeholder') || '',
        hasExistingValue: hasExistingValue(control)
      };
      if (kind === 'select') {
        field.options = Array.from(control.options).map(option => ({
          value: option.value,
          text: option.textContent.trim()
        })).filter(option => option.text || option.value);
      }
      Object.assign(field, assessFieldQuality(field));
      descriptors.push({ field, controls: [control] });
    });

    choiceGroups.forEach((group, groupIndex) => {
      group.controls.forEach(control => handled.add(control));
      const first = group.controls[0];
      const existingTrackingId = group.controls
        .map(control => control.getAttribute('data-autofill-group-id'))
        .find(Boolean);
      const trackingId = existingTrackingId || `af_group_${groupIndex + 1}_${Date.now()}`;
      group.controls.forEach(control => control.setAttribute('data-autofill-group-id', trackingId));
      const label = findChoiceQuestionLabel(group.identity, group.controls);
      let options = group.controls.map(getChoiceOption);
      const normalizedOptionValues = options.map(option => normalizeChoiceValue(option.value));
      if (new Set(normalizedOptionValues).size !== normalizedOptionValues.length) {
        options = options.map(option => ({ ...option, value: option.text }));
      }
      const fingerprint = [label, ...options.map(option => `${option.value}:${option.text}`)]
        .map(value => normalizeChoiceValue(value))
        .join('|');
      const field = {
          trackingId,
          key: trackingId,
          id: first.id || '',
          name: first.getAttribute('name') || '',
          type: group.kind,
          label,
          placeholder: '',
          options,
          hasExistingValue: hasExistingValue(first, group.controls) ||
            (group.customButton && choiceInteractionState.completed.has(fingerprint))
      };
      Object.assign(field, assessFieldQuality(field));
      descriptors.push({
        field,
        controls: group.controls,
        interactionMode: group.customButton ? 'custom-button' : 'standard',
        fingerprint
      });
    });

    return descriptors;
  }

  function extractFormFields(container = document) {
    return scanFields(container).map(descriptor => descriptor.field);
  }

  function dispatchInputEvents(element) {
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
  }

  function setNativeValue(element, value) {
    const tagName = element.tagName.toLowerCase();
    const prototype = tagName === 'textarea'
      ? window.HTMLTextAreaElement?.prototype
      : window.HTMLInputElement?.prototype;
    const setter = prototype && Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
  }

  function normalizeChoiceValue(value) {
    return String(value ?? '').trim().toLowerCase();
  }

  function controlMatchesAnswer(control, answer) {
    const option = getChoiceOption(control);
    const normalized = normalizeChoiceValue(answer);
    return normalizeChoiceValue(option.value) === normalized || normalizeChoiceValue(option.text) === normalized;
  }

  function activateChoice(control) {
    if (isControlSelected(control)) return false;
    if (typeof control.click === 'function') {
      control.click();
      if (control.tagName?.toLowerCase() === 'button') return true;
      if (isControlSelected(control)) return true;
    }

    const role = (control.getAttribute?.('role') || '').toLowerCase();
    if (role === 'radio' || role === 'checkbox') control.setAttribute('aria-checked', 'true');
    else control.checked = true;
    dispatchInputEvents(control);
    return true;
  }

  function findAnswer(answers, field) {
    const identifiers = [field.trackingId, field.key, field.id, field.name]
      .filter(Boolean).map(value => value.toLowerCase());
    const match = Object.entries(answers).find(([key]) => identifiers.includes(key.toLowerCase()));
    return match ? match[1] : undefined;
  }

  function injectChoiceAnswer(descriptor, answer) {
    const { field, controls } = descriptor;
    if (field.type === 'radio') {
      const target = controls.find(control => controlMatchesAnswer(control, answer));
      if (!target || !activateChoice(target)) return false;
      highlightField(target);
      return true;
    }

    const desiredValues = Array.isArray(answer) ? answer : [answer];
    let changed = false;
    desiredValues.forEach(value => {
      if (typeof value === 'boolean') {
        if (value && controls.length === 1 && activateChoice(controls[0])) {
          highlightField(controls[0]);
          changed = true;
        }
        return;
      }
      const target = controls.find(control => controlMatchesAnswer(control, value));
      if (target && activateChoice(target)) {
        highlightField(target);
        changed = true;
      }
    });
    return changed;
  }

  function emptyTypeCounts() {
    return { text: 0, radio: 0, checkbox: 0, select: 0 };
  }

  function statusType(fieldType) {
    if (fieldType === 'radio' || fieldType === 'checkbox' || fieldType === 'select') return fieldType;
    return 'text';
  }

  function isScreenInteractionLocked(descriptors) {
    const lockedFingerprint = choiceInteractionState.screenLock;
    if (!lockedFingerprint) return false;
    const unchanged = descriptors.some(descriptor =>
      descriptor.interactionMode === 'custom-button' && descriptor.fingerprint === lockedFingerprint
    );
    if (!unchanged) choiceInteractionState.screenLock = '';
    return unchanged;
  }

  function injectAnswersWithReport(answers, container = document) {
    const safeAnswers = answers && typeof answers === 'object' ? answers : {};
    const report = {
      filledCount: 0,
      detected: emptyTypeCounts(),
      eligible: emptyTypeCounts(),
      filled: emptyTypeCounts(),
      preserved: emptyTypeCounts(),
      invalid: emptyTypeCounts(),
      blockedUntilContentChanges: false
    };

    const descriptors = scanFields(container);
    for (const descriptor of descriptors) {
      const { field, controls } = descriptor;
      const type = statusType(field.type);
      report.detected[type]++;
      if (field.qualityValid === false) {
        report.invalid[type]++;
        continue;
      }
      if (field.hasExistingValue) {
        report.preserved[type]++;
        continue;
      }
      report.eligible[type]++;
    }

    if (isScreenInteractionLocked(descriptors)) {
      report.blockedUntilContentChanges = true;
      return report;
    }

    for (const descriptor of descriptors) {
      const { field, controls } = descriptor;
      const type = statusType(field.type);
      if (field.qualityValid === false || field.hasExistingValue) continue;
      const answer = findAnswer(safeAnswers, field);
      if (answer === undefined || answer === null || String(answer).trim() === '') continue;

      if (field.type === 'radio' || field.type === 'checkbox') {
        if (injectChoiceAnswer(descriptor, answer)) {
          report.filledCount++;
          report.filled[type]++;
          if (descriptor.interactionMode === 'custom-button') {
            choiceInteractionState.completed.add(descriptor.fingerprint);
            choiceInteractionState.screenLock = descriptor.fingerprint;
            while (choiceInteractionState.completed.size > 100) {
              choiceInteractionState.completed.delete(choiceInteractionState.completed.values().next().value);
            }
            break;
          }
        }
        continue;
      }

      const control = controls[0];
      if (field.type === 'textarea' || (control.tagName.toLowerCase() === 'input')) {
        setNativeValue(control, String(answer));
      } else if (field.type === 'select') {
        const normalized = normalizeChoiceValue(answer);
        const optionIndex = Array.from(control.options).findIndex(option =>
          normalizeChoiceValue(option.value) === normalized ||
          normalizeChoiceValue(option.textContent) === normalized
        );
        if (optionIndex < 0) continue;
        control.selectedIndex = optionIndex;
      } else {
        continue;
      }

      dispatchInputEvents(control);
      highlightField(control);
      report.filledCount++;
      report.filled[type]++;
    }

    return report;
  }

  function injectAnswers(answers, container = document) {
    return injectAnswersWithReport(answers, container).filledCount;
  }

  function highlightField(element) {
    const originalOutline = element.style.outline;
    const originalTransition = element.style.transition;
    element.style.transition = 'outline 0.2s ease-in-out';
    element.style.outline = '2px solid #16a34a';
    setTimeout(() => {
      element.style.outline = originalOutline;
      element.style.transition = originalTransition;
    }, 1200);
  }

  const api = {
    extractFormFields,
    findLabelForElement,
    hasExistingValue,
    injectAnswers,
    injectAnswersWithReport,
    dispatchInputEvents
  };
  globalThis.__AIAutoFiller = api;
  if (typeof window !== 'undefined') window.__AIAutoFiller = api;

})();

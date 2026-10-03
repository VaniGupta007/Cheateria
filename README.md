# AI Auto-Filler Extension

A Manifest V3 Chrome extension that fills empty form fields with OpenRouter-generated content. It sends every valid empty field schema to the model and never overwrites a value already present in the page.

## Project structure

```text
Cheateria/
|-- ai_module/                 OpenRouter client, prompts, and response parsing
|-- extension_core/            Popup, service worker, content script, and icons
|-- shared_config/             Shared constants and build-time config placeholder
|-- scripts/                   Build tooling
|-- tests/                     AI and DOM safety tests
|-- manifest.json              The single extension manifest
|-- .env.example              Required environment variable names
`-- product_requirements_document.md
```

The repository root is the source package. `npm run build` creates the loadable Chrome extension in `dist/`; redundant module and manifest copies are intentionally not kept under `extension_core/`.

## Configure and build

Create `.env` from `.env.example` and set both variables:

```dotenv
OPENROUTER_API_KEY=sk-or-v1-your-key
OPENROUTER_MODEL=openrouter/free
```

Then build:

```powershell
npm run build
```

The build validates both values, copies only extension runtime files to `dist/`, and generates `dist/shared_config/runtime_config.js`. The API key and model are not shown in the popup and are not saved in `chrome.storage`.

Chrome extensions execute on the user's machine, so a credential bundled into an extension can be inspected by a determined user. For a public release, route OpenRouter requests through a server-side API and keep the key there. The current build-time configuration is suitable for this private tool and matches the direct-OpenRouter architecture in the PRD.

## Load in Chrome

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Choose **Load unpacked** and select the generated `dist` folder.

Opening the popup immediately scans the active page. The circular loader becomes a green **Successful** state when processing finishes. Entering a natural-language request in the field runs a two-step flow: OpenRouter first maps the request to an eligible field, then generates that field's content using the form schema.

Each AI stage is quality-gated before the next one runs. The extension requests JSON mode, safely recovers fenced or concatenated objects and trailing commas, validates the expected schema and field keys, and makes one corrective retry when an output cannot be accepted. Invalid, prefilled, unknown, nested, or option-mismatched answers are rejected before DOM injection.

The popup scans every permitted frame and targets the strongest form candidate by frame ID. Extraction uses live runtime DOM semantics, including accessible names, ARIA roles and checked states, grouped controls, and recursively accessible open shadow roots. Missing questions, empty or duplicate option labels, invalid groups, and model answers below the confidence threshold fail closed without a click. Closed shadow roots remain inaccessible by design.

Radio buttons and checkboxes are grouped by question and sent to the model with their allowed options. Native HTML controls, ARIA controls used by applications such as Google Forms, and guarded quiz-button groups are supported. Multi-option checkbox answers must be arrays; every returned option is independently matched and selected. The popup reports detected and completed totals separately for text, radio, checkbox, and select fields.

For component-based assessments such as NPTEL, controls sharing a randomized `name` are grouped first, then their rendered question is recovered from the nearest preceding context around their common options container. Machine-generated identifiers are rejected as question text when that context is unavailable.

Custom quiz choices exclude menu, navigation, newsletter, and command buttons. After a quiz option is clicked, that question is interaction-locked so repeated popup runs cannot click again; the lock automatically clears when the question text or options change.

No screenshot capture, OCR, or vision fallback is included. The extension stops when permitted runtime DOM and accessibility semantics do not provide enough trustworthy context.

Chrome blocks script injection on internal pages such as `chrome://` and on the Chrome Web Store. Use the extension on a normal `http` or `https` page.

## Test

```powershell
npm test
npm run verify
```

The tests cover prompt construction, two-step field targeting, response parsing, OpenRouter request construction, all-field inclusion, existing-value preservation, multi-checkbox injection, DOM injection, and synthetic events.

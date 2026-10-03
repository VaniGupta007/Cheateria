import { scoreFrame, selectBestFrame } from '../extension_core/frame_selector.js';

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  PASS: ${name}`);
    passed++;
  } else {
    console.error(`  FAIL: ${name}`);
    failed++;
  }
}

console.log('\n--- Frame selection ---');

const topFrame = {
  frameId: 0,
  fields: [{ type: 'email', label: 'Email', isPersonal: true, qualityValid: true }]
};
const assessmentFrame = {
  frameId: 4,
  fields: [
    { type: 'radio', label: 'Question one', qualityValid: true },
    { type: 'checkbox', label: 'Question two', qualityValid: true }
  ]
};
const ambiguousFrame = {
  frameId: 2,
  fields: [{ type: 'radio', label: '', qualityValid: false }]
};

assert(selectBestFrame([topFrame, ambiguousFrame, assessmentFrame])?.frameId === 4,
  'Assessment iframe outranks a top-level text form');
assert(selectBestFrame([ambiguousFrame]) === null,
  'A frame containing only ambiguous fields is rejected');
assert(scoreFrame(assessmentFrame).eligibleCount === 2,
  'Eligible choice groups contribute to frame scoring');
assert(selectBestFrame([{ ...assessmentFrame, frameId: 5 }, assessmentFrame])?.frameId === 4,
  'Equal frame scores resolve deterministically');
assert(selectBestFrame([
  { frameId: 0, fields: Array.from({ length: 5 }, (_, index) => ({ type: 'text', label: `Field ${index}`, qualityValid: true })) },
  { frameId: 8, fields: [{ type: 'radio', label: 'Answered question', qualityValid: true, hasExistingValue: true }] }
])?.frameId === 8, 'An assessment frame remains selected after an answer is preserved');

console.log(`\nFrame tests: ${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);

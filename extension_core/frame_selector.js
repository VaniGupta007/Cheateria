function isEligible(field) {
  return field && field.qualityValid !== false && !field.hasExistingValue;
}

function fieldWeight(field) {
  return ['radio', 'checkbox', 'select'].includes(field.type) ? 3 : 1;
}

export function scoreFrame(frame) {
  const fields = Array.isArray(frame?.fields) ? frame.fields : [];
  const validFields = fields.filter(field => field?.qualityValid !== false);
  const eligibleFields = validFields.filter(isEligible);
  const choiceCount = validFields.filter(field =>
    ['radio', 'checkbox', 'select'].includes(field.type)
  ).length;
  const choiceWeight = eligibleFields.reduce((total, field) => total + fieldWeight(field), 0);

  return {
    eligibleCount: eligibleFields.length,
    validCount: validFields.length,
    choiceCount,
    score: choiceCount * 10_000 + eligibleFields.length * 100 + choiceWeight * 10 + validFields.length
  };
}

export function selectBestFrame(frames) {
  const candidates = (Array.isArray(frames) ? frames : [])
    .filter(frame => Number.isInteger(frame?.frameId) && Array.isArray(frame.fields))
    .map(frame => ({ ...frame, ...scoreFrame(frame) }))
    .filter(frame => frame.validCount > 0)
    .sort((left, right) =>
      right.score - left.score ||
      right.eligibleCount - left.eligibleCount ||
      left.frameId - right.frameId
    );

  return candidates[0] || null;
}

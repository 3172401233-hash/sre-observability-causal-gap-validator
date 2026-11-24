export function makeEvidence(kind, supports, detail) {
  return {
    kind,
    supports,
    detail,
  };
}

export function supportsHypothesis(evidenceList, hypothesis) {
  return evidenceList.some(
    (evidence) => evidence.supports === hypothesis,
  );
}

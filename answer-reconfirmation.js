/** Explicitly reuse existing self-assessment answers after their review was reopened. */
import { COMPONENTS, answerFinding, questionAnswerIsSelected } from './catalogs.js';
import { allQuestions } from './scoring.js';

const answers = new Set(['yes', 'partial', 'no', 'unknown']);
const answerCounts = () => ({ yes: 0, partial: 0, no: 0, unknown: 0 });
const canConfirm = (row, ui) => Boolean(ui?.selfAssessment !== false && row &&
  row.review_status === 'pending' && answers.has(row.answer) && questionAnswerIsSelected(row, ui));

/** No response is created, and an explicit unknown stays an open finding. */
export function resubmitSimpleAnswer(record, questionId, ui = {}) {
  const rows = (record?.responses || []).filter(row => row?.question_id === questionId);
  if (rows.length !== 1 || !canConfirm(rows[0], ui)) return null;
  const row = rows[0];
  row.finding = answerFinding(row.answer);
  row.review_status = 'approved';
  row.evidence_status = 'not_checked';
  row.reviewer_id = null;
  row.reviewed_at = null;
  return row;
}

/** Includes retained answers of unselected Practices without changing their selection. */
export function listPendingAnswerConfirmations(payload, catalogs, ui = {}) {
  if (ui?.selfAssessment === false) return [];
  const raw = catalogs?.raw || catalogs || {};
  const included = new Set((payload?.assessments?.practices?.extensions?.scope_decisions || [])
    .filter(row => row.selection_status === 'included').map(row => row.practice_id));
  const candidates = [];
  for (const [componentId, record] of Object.entries(payload?.assessments || {})) {
    const catalog = raw[componentId];
    if (!catalog || record?.catalog_id !== catalog.catalog_id || record?.catalog_version !== catalog.catalog_version) continue;
    const known = new Map(allQuestions(catalog).filter(question => question.collection_mode === 'direct')
      .map(question => [question.id, question]));
    const practiceByQuestion = new Map((catalog.assessment_modules || []).flatMap(module =>
      module.questions.map(question => [question.id, module.practice_id])));
    const rows = Array.isArray(record.responses) ? record.responses : [];
    const occurrences = new Map();
    for (const row of rows) occurrences.set(row?.question_id, (occurrences.get(row?.question_id) || 0) + 1);
    for (const row of rows) {
      const question = known.get(row?.question_id);
      if (!question || occurrences.get(row.question_id) !== 1 || !canConfirm(row, ui)) continue;
      const practiceId = practiceByQuestion.get(row.question_id) || null;
      candidates.push({ componentId, componentLabel: COMPONENTS.find(component => component.id === componentId)?.label || componentId,
        questionId: row.question_id, text: question.text || question.question || row.question_id,
        answer: row.answer, practiceId, inSelectedScope: !practiceId || included.has(practiceId) });
    }
  }
  return candidates;
}

const summarize = candidates => {
  const byAnswer = answerCounts(), byComponent = {};
  let outsideSelectedPracticeCount = 0;
  for (const row of candidates) {
    byAnswer[row.answer]++;
    byComponent[row.componentId] = (byComponent[row.componentId] || 0) + 1;
    if (!row.inSelectedScope) outsideSelectedPracticeCount++;
  }
  return { total: candidates.length, byAnswer, byComponent, outsideSelectedPracticeCount };
};

export function summarizePendingAnswerConfirmations(payload, catalogs, ui = {}) {
  return summarize(listPendingAnswerConfirmations(payload, catalogs, ui));
}

/** Recheck eligibility at confirmation time; flags and non-answer approvals stay untouched. */
export function confirmPendingAnswers(payload, catalogs, ui = {}, options = {}) {
  const candidates = listPendingAnswerConfirmations(payload, catalogs, ui);
  const requested = options.questionIds == null ? null : new Set(options.questionIds);
  const knownCandidateIds = new Set(candidates.map(row => row.questionId));
  const confirmed = [];
  for (const candidate of candidates) {
    if (requested && !requested.has(candidate.questionId)) continue;
    if (resubmitSimpleAnswer(payload.assessments[candidate.componentId], candidate.questionId, ui)) confirmed.push(candidate);
  }
  const counts = summarize(confirmed);
  return { confirmedCount: confirmed.length, confirmedQuestionIds: confirmed.map(row => row.questionId),
    byAnswer: counts.byAnswer, byComponent: counts.byComponent,
    candidateCount: candidates.length, skippedCount: candidates.length - confirmed.length,
    remainingCount: listPendingAnswerConfirmations(payload, catalogs, ui).length,
    ignoredQuestionIds: requested ? [...requested].filter(id => !knownCandidateIds.has(id)) : [] };
}

/** Read-only display adapters for the supplied V5 catalogs. Canonical records stay separate. */
import {getAssessmentDepth} from './assessment-modes.js';
export const POLICY_ID = 'GOEK-SVS-LOCAL-MEAN-COMPONENT-GATES-SVS-MIN-V5';
export const COMPONENTS = [
  { id: 'guiding_principles', label: 'Guiding Principles', shortLabel: 'Leitprinzipien', file: 'GP_Fragenkatalog_V5.json' },
  { id: 'governance', label: 'Governance', shortLabel: 'Governance', file: 'SVS_Governance_Fragenkatalog_V5.json' },
  { id: 'service_value_chain', label: 'Service Value Chain', shortLabel: 'Wertschöpfung', file: 'SVS_Service_Value_Chain_Fragenkatalog_V5.json' },
  { id: 'practices', label: 'Practices', shortLabel: 'Practices', file: 'SVS_Practices_Fragenkatalog_V5.json' },
  { id: 'continual_improvement', label: 'Continual Improvement', shortLabel: 'Verbesserung', file: 'CI_Fragenkatalog_V5.json' },
];

const clone = value => JSON.parse(JSON.stringify(value));
const levelOf = q => q.component_level ?? q.level ?? null;
const idOf = value => value.id ?? value.criterion_id;
const normalizePracticeSearch=value=>value.toLocaleLowerCase('de-DE').normalize('NFKD').replace(/\p{M}/gu,'').replace(/ß/g,'ss').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
/** Search the existing bilingual catalog metadata while keeping German labels. */
export function practiceMatchesSearch(practice,query=''){
  if(!practice||typeof practice!=='object')return false;
  const terms=normalizePracticeSearch(String(query??'')).split(' ').filter(Boolean);
  if(!terms.length)return true;
  const fields=[practice.id,practice.name_en,practice.name_de,practice.label,practice.name,practice.slug]
    .filter(value=>typeof value==='string').flatMap(value=>{
      const germanAscii=value.toLocaleLowerCase('de-DE').replace(/[äöü]/g,letter=>({ä:'ae',ö:'oe',ü:'ue'}[letter]));
      return [normalizePracticeSearch(value),normalizePracticeSearch(germanAscii)].flatMap(field=>[field,field.replace(/ /g,'')]);
    });
  return terms.every(term=>fields.some(field=>field.includes(term)));
}
export const INITIAL_STATE_LABELS={yes:'Anfangszustand trifft zu',partial:'Anfangszustand trifft teilweise zu',no:'Anfangszustand trifft nicht zu',unknown:'Anfangszustand unklar'};
export function questionAnswerLabel(question,answer){return question?.kind==='initial_classification'?INITIAL_STATE_LABELS[answer]||'Noch nicht beantwortet':({yes:'Ja',partial:'Teilweise',no:'Nein',unknown:'Unklar'}[answer]||'Noch nicht beantwortet');}
export function questionAnswerHelp(question){return question?.kind==='initial_classification'?'Diese Auswahl ordnet den beschriebenen Anfangszustand ein. „Trifft zu“ beschreibt Stufe 1; es bestätigt keine positive Reifeanforderung. Höhere Stufen werden unabhängig davon anhand ihrer positiven Voraussetzungen bewertet.':'„Ja“ bedeutet: Alle zutreffenden Anforderungen dieser Frage sind erfüllt. Die Antwort zählt sofort.';}
export function questionAnswerStatus(question,answer){if(question?.kind==='initial_classification')return {yes:'Beschriebener Anfangszustand als zutreffend erfasst.',partial:'Anfangszustand trifft teilweise zu; keine vollständige Zuordnung.',no:'Der beschriebene Anfangszustand trifft nicht zu. Höhere Stufen werden separat anhand ihrer positiven Voraussetzungen bestimmt.',unknown:'Anfangszustand unklar; die Einordnung bleibt offen.'}[answer]||'Noch keine Antwort gewählt.';return answer==='yes'?'Als erfüllt erfasst.':answer==='unknown'?'Als unklar erfasst; die Anforderung bleibt offen.':'Als nicht vollständig erfüllt erfasst; dies kann eine Stufe begrenzen.';}


export async function loadCatalogs(baseUrl = './data/') {
  const files = [...COMPONENTS.map(c => c.file), 'SVS_Bewertungsregeln_V5.json'];
  const values = await Promise.all(files.map(async file => {
    const response = await fetch(new URL(file, new URL(baseUrl, import.meta.url)));
    if (!response.ok) throw new Error(`Katalog konnte nicht geladen werden: ${file} (${response.status}).`);
    return response.json();
  }));
  return normalizeCatalogs(Object.fromEntries(COMPONENTS.map((c, i) => [c.id, values[i]])), values.at(-1));
}

export function normalizeCatalogs(raw, rules = {}) {
  const questionsById = new Map();
  const components = COMPONENTS.map(definition => {
    const catalog = raw[definition.id];
    if (!catalog) throw new Error(`Katalog fehlt: ${definition.label}.`);
    if (catalog.catalog_version !== '5.0.0') throw new Error(`Nicht unterstützte Katalogversion: ${definition.label}.`);
    if (catalog.common_assessment_policy?.policy_id !== POLICY_ID) throw new Error(`Abweichende Bewertungsregel: ${definition.label}.`);
    const groups = [];
    const questions = [];
    const add = (source, module = null) => {
      const category = source.kind === 'component_requirement' || source.kind === 'initial_classification';
      const groupId = module ? source.criterion_id : category ? `${definition.id}:category` : source.criterion_id || `${definition.id}:application`;
      const criteria = module?.criteria || catalog.criteria || [];
      const criterion = criteria.find(c => idOf(c) === source.criterion_id);
      const q = {
        ...source, original: source, id: source.id, componentId: definition.id,
        practiceId: module?.practice_id || null, moduleId: module?.module_id || null,
        moduleVersion: module?.module_version || null,
        catalogId: catalog.catalog_id, catalogVersion: catalog.catalog_version,
        groupId, groupTitle: category ? 'Kategorie-Voraussetzungen' : criterion?.name || criterion?.title || 'Anwendung der Leitprinzipien',
        criterionTitle: criterion?.name || criterion?.title || '',
        level: levelOf(source), categoryRequirement: category,
        optionalDetail: !module && !category, evidenceHelper: source.kind === 'principle_application_evidence_helper',
        answerMeaning: source.kind==='initial_classification'?'initial_state':'positive_requirement',
        answerOptions: (catalog.option_sets[source.answer_option_set] || []).map(option=>source.kind==='initial_classification'?{...option,label:INITIAL_STATE_LABELS[option.id]||option.label}:{...option}),
        evidenceExamples: source.evidence_examples || [],
        evidenceHelp: source.evidence_focus || source.evidence_examples_text || '',
        order: source.display_order ?? source.order ?? questions.length + 1,
      };
      if (!groups.some(g => g.id === groupId)) groups.push({ id: groupId, title: q.groupTitle, criterionId: source.criterion_id, practiceId: q.practiceId, categoryRequirement: category });
      questions.push(q); questionsById.set(q.id, q);
    };
    if (definition.id === 'practices') {
      // Module contents are adapted only when selected; the registry remains available in full.
    } else (catalog.questions || []).forEach(q => add(q));
    return { ...definition, catalogId: catalog.catalog_id, version: catalog.catalog_version, catalog, groups, questions, addQuestion: add };
  });
  const practiceComponent = components.find(c => c.id === 'practices');
  const practices = raw.practices.practice_registry.map(entry => {
    const module = raw.practices.assessment_modules.find(m => m.practice_id === entry.id);
    return {
      ...entry, label: entry.name_de, name: entry.name_de, module,
      moduleId: module.module_id, moduleVersion: module.module_version,
      dependencies: raw.practices.dependency_hints.filter(d => d.from_practice_id === entry.id),
      screeningQuestions: raw.practices.screening_questions.filter(q => q.practice_id === entry.id),
      mandatory: raw.practices.selection_policy.mandatory_practices.svs_maturity.includes(entry.id),
    };
  });
  const adaptPractice = practiceId => {
    const practice = practices.find(p => p.id === practiceId);
    if (!practice) return [];
    if (!practiceComponent.questions.some(q => q.practiceId === practiceId)) practice.module.questions.forEach(q => practiceComponent.addQuestion(q, practice.module));
    return practiceComponent.questions.filter(q => q.practiceId === practiceId);
  };
  return { raw, rules, components, practices, questionsById, adaptPractice,
    dependencyHints: raw.practices.dependency_hints, screeningQuestions: raw.practices.screening_questions,
    versions: Object.fromEntries(components.map(c => [c.id, c.version])) };
}

export function createEmptyPayload(catalogs, context = {}) {
  const identifier = globalThis.crypto?.randomUUID?.() || `SVS-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const assessments = {};
  for (const component of catalogs.components) {
    const record = clone(component.catalog.input_defaults.template);
    record.assessment_id = `ASSESSMENT-${identifier}`;
    record.assessment_unit_id = `UNIT-${identifier}`;
    record.catalog_id = component.catalogId;
    record.catalog_version = component.version;
    record.context.scope_id = `SCOPE-${identifier}`;
    for (const key of Object.keys(record.context)) if (Object.hasOwn(context, key)) record.context[key] = clone(context[key]);
    assessments[component.id] = record;
  }
  assessments.practices.extensions.scope_decisions = catalogs.practices.map(practice => ({
    practice_id: practice.id, selection_status: 'pending', scope_role: null,
    implementation_presence: 'unknown', objective_ids: [], value_stream_ids: [],
    rationale: '', evidence_ids: [], reviewed: false,
  }));
  return { assessments };
}

export function selectedPracticeIds(payload) {
  return (payload.assessments?.practices?.extensions?.scope_decisions || [])
    .filter(row => row.selection_status === 'included').map(row => row.practice_id);
}

export function getAssessmentQuestions(catalogs, payload, ui = {}, result = null) {
  const componentId = ui.componentId || 'guiding_principles';
  const component = catalogs.components.find(c => c.id === componentId);
  if (!component) return [];
  let questions;
  if (componentId === 'practices') {
    const selected = selectedPracticeIds(payload);
    const ids = ui.practiceId ? selected.filter(id => id === ui.practiceId) : selected;
    questions = ids.flatMap(catalogs.adaptPractice);
  } else questions = component.questions;
  const depth = getAssessmentDepth(payload);
  const mode = depth === 'quick' ? 'required' : ui.mode === 'all' ? 'all' : 'required';
  // Detail scores come from the actual local aspects, not the separate category gates.
  const base = questions.filter(q => depth === 'detailed'
    ? !q.categoryRequirement && !q.evidenceHelper
    : q.categoryRequirement || Boolean(q.practiceId));
  const record = payload.assessments?.[componentId];
  return base.map(question => {
    const unit = componentId === 'practices' ? result?.practice_results?.[question.practiceId] : result?.component_results?.[componentId];
    const ladder = question.categoryRequirement ? unit : unit?.unit_results?.find(row => row.unit_id === question.criterion_id);
    const closed = ladder && (ladder.status === 'confirmed' || ladder.status === 'below_baseline');
    const boundary = closed ? ladder.possible_upper_level : null;
    const initialSatisfiedByPositive = question.kind === 'initial_classification' && unit?.assessed_level >= 2;
    const higherThanBoundary = closed && !ladder.blocking_question_ids?.includes(question.id) &&
      (ladder.status === 'below_baseline' || (boundary != null && question.level > boundary));
    const certifiedRating = ['reviewed_criterion_rating','self_assessed_criterion_rating'].includes(ladder?.rating_source) && ladder.assessed_level != null;
    const practiceComponent = result?.component_results?.practices;
    const role = record?.extensions?.scope_decisions?.find(row => row.practice_id === question.practiceId)?.scope_role;
    const quickPracticeNotNeeded = depth === 'quick' && question.practiceId !== 'PR02' && role === 'supporting' &&
      practiceComponent?.possible_upper_level != null && practiceComponent.possible_upper_level < 3;
    const quickPracticeResolved = depth === 'quick' && practiceComponent?.status === 'confirmed' &&
      (question.practiceId !== 'PR02' || result?.component_results?.continual_improvement?.status === 'confirmed');
    const determinedMean = depth === 'quick' && componentId === 'practices' &&
      (unit?.status === 'confirmed' || quickPracticeResolved) && unit?.open_question_ids?.includes(question.id);
    const optional = initialSatisfiedByPositive || higherThanBoundary || determinedMean || certifiedRating || quickPracticeNotNeeded;
    return { ...question, workflowOptional: optional,
      optionalReason: initialSatisfiedByPositive ? 'Die Anfangsklassifikation ist keine Voraussetzung höherer Levels.' : certifiedRating ? 'Für diesen Einzelaspekt wurde bereits eine direkte Einzelnote gewählt. Die zugehörigen Fragen bleiben zur Orientierung und Entwicklung erreichbar.' : optional ? 'Für die aktuelle Ergebniszahl nicht erforderlich; freiwillig für Verbesserungen untersuchbar.' : '',
    };
  }).filter(q => mode === 'all' || !q.workflowOptional)
    .sort((a, b) => {
      if (a.practiceId !== b.practiceId) return (a.practiceId || '').localeCompare(b.practiceId || '');
      if (componentId === 'practices' && a.groupId !== b.groupId) return a.groupId.localeCompare(b.groupId);
      if (a.categoryRequirement && b.categoryRequirement && a.kind !== b.kind) {
        if (a.kind === 'initial_classification') return 1;
        if (b.kind === 'initial_classification') return -1;
      }
      return (a.level || 0) - (b.level || 0) || a.order - b.order;
    });
}

export function makePendingResponse(questionId) {
  return { question_id: questionId, answer: 'unknown', finding: 'open', review_status: 'pending',
    evidence_status: 'not_checked', evidence_ids: [], check_results: [], assessor_rationale: '',
    reviewer_id: null, reviewed_at: null };
}

export function invalidateResponse(response) {
  response.review_status = 'pending';
  response.reviewed_at = null;
  return response;
}

export function answerFinding(answer) {
  return { yes: 'fulfilled', partial: 'partial', no: 'not_fulfilled', unknown: 'open' }[answer] || 'open';
}

export function usableEvidence(evidence, scopeId) {
  return Boolean(evidence?.source_locator && evidence?.title && Array.isArray(evidence.scope_ids) && evidence.scope_ids.includes(scopeId));
}

export function questionAnswerIsSelected(response, ui = null) {
  return Boolean(response && !ui?.unselectedQuestionIds?.includes(response.question_id));
}

export function markQuestionAnswerSelection(ui, questionId, selected) {
  const identifiers = new Set(Array.isArray(ui.unselectedQuestionIds) ? ui.unselectedQuestionIds : []);
  if (selected) identifiers.delete(questionId); else identifiers.add(questionId);
  ui.unselectedQuestionIds = [...identifiers];
}

export function responseOpenReason(response, record, ui = null) {
  if (!questionAnswerIsSelected(response, ui)) return 'Antwort fehlt';
  // This separate application defaults to the explicitly labelled self-assessment workflow.
  if (ui?.selfAssessment !== false) {
    if (response.review_status !== 'approved') return 'Erneut beantworten';
    if (response.answer === 'unknown' || response.finding === 'open') return 'Aussage unklar';
    return null;
  }
  if (response.evidence_status === 'conflicting') return 'Quellen widersprechen sich';
  if (!response.evidence_ids?.length) return 'Nachweis fehlt';
  if (!response.evidence_ids.every(id => usableEvidence(record.evidence_register.find(e => e.evidence_id === id), record.context.scope_id))) return 'Nachweis passt nicht zum Umfang';
  if (response.evidence_status === 'insufficient') return 'Nachweis reicht nicht aus';
  if (!response.assessor_rationale?.trim()) return 'Begründung fehlt';
  if (response.review_status !== 'approved' || response.evidence_status !== 'sufficient') return 'Prüfung offen';
  if (!response.reviewer_id || !response.reviewed_at) return 'Prüfende Person oder Prüfzeitpunkt fehlt';
  if (response.answer === 'unknown' || response.finding === 'open') return 'Aussage ungeklärt';
  return null;
}

export function allSelectedQuestions(catalogs, payload) {
  return [...catalogs.components.filter(c => c.id !== 'practices').flatMap(c => c.questions),
    ...selectedPracticeIds(payload).flatMap(catalogs.adaptPractice)];
}

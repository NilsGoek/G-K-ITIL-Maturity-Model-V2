/** Faithful browser port of the supplied V5 reference engine (svs_scoring.py).
 * Local details use floored means; component requirements are cumulative;
 * only the complete SVS uses a minimum. Open facts never become zero.
 */
export const POLICY_ID = 'GOEK-SVS-LOCAL-MEAN-COMPONENT-GATES-SVS-MIN-V5';
export const SIMPLIFIED_MODE = 'simplified_self_assessment';
export const SIMPLIFIED_POLICY_ID = 'GOEK-SVS-SELF-ASSESSMENT-LOCAL-MEAN-COMPONENT-GATES-SVS-MIN-V5-R01-INFO-V3';
export const VERSION = '5.0.0';
export const FILES = Object.freeze({
  governance: 'SVS_Governance_Fragenkatalog_V5.json',
  service_value_chain: 'SVS_Service_Value_Chain_Fragenkatalog_V5.json',
  guiding_principles: 'GP_Fragenkatalog_V5.json',
  continual_improvement: 'CI_Fragenkatalog_V5.json',
  practices: 'SVS_Practices_Fragenkatalog_V5.json',
});
const FIELDS = ['question_id','answer','finding','review_status','evidence_status','evidence_ids','check_results','assessor_rationale','reviewer_id','reviewed_at'];
const ANSWERS = ['yes','partial','no','unknown'];
const FINDINGS = ['fulfilled','not_fulfilled','partial','open','not_applicable'];
const REVIEW = ['pending','approved'];
const EVIDENCE = ['not_checked','sufficient','insufficient','conflicting'];
export class InputError extends Error { constructor(message) { super(message); this.name = 'InputError'; } }
const fail = message => { throw new InputError(message); };
const clone = value => JSON.parse(JSON.stringify(value));
const keys = Object.keys;
const values = Object.values;
const truth = value => Array.isArray(value) ? value.length > 0 : value && typeof value === 'object' ? keys(value).length > 0 : Boolean(value);
const uniqueSorted = items => [...new Set(items)].sort();
const sameKeys = (obj, expected) => keys(obj).length === expected.length && expected.every(k => Object.hasOwn(obj,k));
const missingKeys = (obj, allowed) => keys(obj).filter(k => !allowed.includes(k));
const state = (states,qid) => states[qid] ?? 'open';
const tier = question => question.component_level ?? question.level;
const levels = () => [1,2,3,4,5];
const simplified = options => options.mode === SIMPLIFIED_MODE;
const assuranceMetadata = () => ({
  assessment_mode:SIMPLIFIED_MODE,assurance_level:'self_assessment',
  policy_id:SIMPLIFIED_POLICY_ID,aggregation_policy_id:POLICY_ID,
  classification_policy:'initial_classification_informational_for_higher_levels',
  score_semantics:'Selbsteinschätzung anhand expliziter Antworten. Die V5-Aggregation bleibt unverändert; Nachweise, Begründungen und externe Freigaben sind optional.',
  status_semantics:'confirmed bezeichnet gleiche rechnerische Unter- und Obergrenzen der Selbsteinschätzung, keine externe Nachweisprüfung.',
});
function unique(items,key,label) {
  const indexed = Object.create(null);
  for (const item of items) {
    const id = item[key];
    if (!truth(id) || Object.hasOwn(indexed,id)) fail(`${label}: missing or duplicate ${key}: ${JSON.stringify(id)}`);
    indexed[id] = item;
  }
  return indexed;
}
export function allQuestions(catalog) {
  return catalog.metadata.component_id === 'practices' ? catalog.assessment_modules.flatMap(m => m.questions) : catalog.questions;
}
function level(value) {
  if (value !== null && (!Number.isInteger(value) || value < 1 || value > 5)) fail(`Invalid level: ${JSON.stringify(value)}`);
  return value;
}
function stateStatus(lower,upper,below=false) {
  if (below) return 'below_baseline';
  if (lower === null) return 'open';
  return lower === upper ? 'confirmed' : 'provisional';
}
export function ladder(unitId,requirements,states,questions,startLevel=1) {
  const cumulative = []; let lower = null, upper = null;
  for (let n=startLevel;n<=5;n++) {
    cumulative.push(...(requirements[n] ?? []));
    if (!cumulative.length) fail(`${unitId}: no requirements at level ${n}`);
    if (cumulative.every(q => state(states,q) === 'fulfilled')) lower = n;
    if (cumulative.every(q => state(states,q) !== 'not_fulfilled')) upper = n;
  }
  const below = startLevel === 1 && (requirements[startLevel] ?? []).some(q => states[q] === 'not_fulfilled');
  const used = uniqueSorted(cumulative);
  return {unit_id:unitId,assessed_level:lower,possible_upper_level:upper,status:stateStatus(lower,upper,below),
    blocking_question_ids:used.filter(q => states[q] === 'not_fulfilled'),
    open_question_ids:used.filter(q => state(states,q) === 'open'),
    higher_level_strength_question_ids:used.filter(q => states[q] === 'fulfilled' && tier(questions[q]) > (lower ?? 0)),
    fulfilled_question_levels:Object.fromEntries(used.filter(q => states[q] === 'fulfilled').map(q => [q,tier(questions[q])]))};
}
export function minimum(unitId,units) {
  if (unitId !== 'svs') fail('The minimum rule is permitted only for the whole SVS');
  if (!units.length) fail(`${unitId}: no required units`);
  for (const u of units) { level(u.assessed_level); level(u.possible_upper_level); if (u.assessed_level !== null && u.possible_upper_level !== null && u.assessed_level > u.possible_upper_level) fail('Invalid minimum input bounds'); }
  const blocked = units.filter(u => ['partial_scope','needs_reconciliation','not_classifiable'].includes(u.status));
  const below = units.filter(u => u.status === 'below_baseline');
  let lower=null,upper=null,status,limiting;
  if (blocked.length) { status=blocked[0].status; limiting=blocked.map(u=>u.unit_id); }
  else if (below.length) { status='below_baseline'; limiting=below.map(u=>u.unit_id); }
  else {
    lower=units.every(u=>u.assessed_level !== null) ? Math.min(...units.map(u=>u.assessed_level)) : null;
    upper=Math.min(...units.map(u=>u.possible_upper_level ?? 5)); status=stateStatus(lower,upper);
    limiting=units.filter(u=>lower === null ? u.assessed_level === null : u.assessed_level === lower).map(u=>u.unit_id);
  }
  const joined = field => uniqueSorted(units.flatMap(u=>u[field] ?? []));
  const fulfilled = Object.assign({},...units.map(u=>u.fulfilled_question_levels ?? {}));
  return {unit_id:unitId,assessed_level:lower,possible_upper_level:upper,status,limiting_unit_ids:limiting,unit_results:clone(units),
    blocking_question_ids:joined('blocking_question_ids'),open_question_ids:joined('open_question_ids'),
    higher_level_strength_question_ids:keys(fulfilled).filter(q=>fulfilled[q]>(lower ?? 0)).sort(),fulfilled_question_levels:fulfilled,
    aggregation_method:'minimum',unrounded_mean:null,unrounded_upper_mean:null,weaker_criterion_ids:[]};
}
function thresholdState(unit,threshold) {
  if (!unit) return 'open';
  const lower=level(unit.assessed_level ?? null),upper=level(unit.possible_upper_level ?? null);
  if (unit.status === 'below_baseline') return 'not_fulfilled';
  if (['partial_scope','needs_reconciliation','not_classifiable'].includes(unit.status)) return 'open';
  if (lower !== null && lower >= threshold) return 'fulfilled';
  if (upper !== null && upper < threshold) return 'not_fulfilled';
  return 'open';
}
export function componentEligibility(unitId,requirements,states,questions,initial=null,dependencies={}) {
  const cumulative=[],evaluations=[]; let lower=null,upper=null;
  for (let n=initial ? 2 : 1;n<=5;n++) {
    cumulative.push(...(requirements[n] ?? []));
    if (!cumulative.length) fail(`${unitId}: empty component level ${n}`);
    const qStates=Object.fromEntries(cumulative.map(q=>[q,state(states,q)]));
    const deps=(dependencies[n] ?? []).map(([id,threshold,source])=>({source_id:id,minimum_level:threshold,state:thresholdState(source,threshold)}));
    const checks=[...values(qStates),...deps.map(d=>d.state)];
    const fulfilled=checks.every(s=>s === 'fulfilled'),possible=checks.every(s=>s !== 'not_fulfilled');
    if (fulfilled) lower=n; if (possible) upper=n;
    evaluations.push({level:n,fulfilled,possible,required_question_ids:[...cumulative],requirement_states:qStates,dependency_requirements:deps});
  }
  if (initial) {
    const initialState=state(states,initial);
    evaluations.unshift({level:1,fulfilled:initialState === 'fulfilled',possible:initialState !== 'not_fulfilled',required_question_ids:[initial],requirement_states:{[initial]:initialState},dependency_requirements:[],initial_classification_only:true});
    if (lower === null && initialState === 'fulfilled') lower=1;
    if (upper === null && initialState !== 'not_fulfilled') upper=1;
  }
  let status=stateStatus(lower,upper);
  if (lower === null && upper === null) status=initial ? 'not_classifiable' : 'below_baseline';
  const used=uniqueSorted([...cumulative,...(initial && (lower === null || lower === 1) ? [initial] : [])]);
  return {unit_id:unitId,assessed_level:lower,possible_upper_level:upper,status,
    aggregation_method:'highest_fully_eligible_component_level',category_level_source:'binding_component_maturity_criteria',component_level_evaluations:evaluations,unit_results:[],
    blocking_question_ids:used.filter(q=>states[q] === 'not_fulfilled'),open_question_ids:used.filter(q=>state(states,q) === 'open'),
    higher_level_strength_question_ids:used.filter(q=>states[q] === 'fulfilled' && tier(questions[q])>(lower ?? 0)),
    fulfilled_question_levels:Object.fromEntries(used.filter(q=>states[q] === 'fulfilled').map(q=>[q,tier(questions[q])]))};
}
function componentFeatures(catalog,questions,states,dependencies={}) {
  const cfg=catalog.component_maturity_criteria;
  return componentEligibility(catalog.metadata.component_id,cfg.requirements_introduced_by_level,states,questions,cfg.initial_classification_question_id,dependencies);
}
export function practiceComponentEligibility(practiceResults,keyIds,supportingIds) {
  if (!keyIds.length) return {unit_id:'practices',assessed_level:null,possible_upper_level:null,status:'partial_scope',aggregation_method:'explicit_role_thresholds',component_level_evaluations:[],limitations:['Mindestens eine fachlich bestätigte Schlüssel-Practice ist erforderlich.']};
  let lower=null,upper=null; const rows=[];
  for (const n of levels()) {
    const supportThreshold=n<3 ? null : n-2;
    const requirements=keyIds.map(pid=>({practice_id:pid,scope_role:'primary',minimum_level:n,state:thresholdState(practiceResults[pid],n)}));
    if (supportThreshold !== null) requirements.push(...supportingIds.map(pid=>({practice_id:pid,scope_role:'supporting',minimum_level:supportThreshold,state:thresholdState(practiceResults[pid],supportThreshold)})));
    const fulfilled=requirements.every(r=>r.state === 'fulfilled'),possible=requirements.every(r=>r.state !== 'not_fulfilled');
    if (fulfilled) lower=n; if (possible) upper=n;
    rows.push({level:n,fulfilled,possible,key_minimum:n,supporting_minimum:supportThreshold,practice_requirements:requirements});
  }
  return {unit_id:'practices',assessed_level:lower,possible_upper_level:upper,status:stateStatus(lower,upper,lower === null && upper === null),aggregation_method:'explicit_role_thresholds',component_level_evaluations:rows,category_level_source:'binding_component_maturity_criteria',unit_results:values(practiceResults),higher_level_unit_ids:keys(practiceResults).filter(pid=>lower !== null && practiceResults[pid].assessed_level !== null && practiceResults[pid].assessed_level>lower),limiting_unit_ids:rows.filter(row=>row.level === (lower ?? 0)+1).flatMap(row=>row.practice_requirements.filter(r=>r.state !== 'fulfilled').map(r=>r.practice_id))};
}
export function meanFloor(unitId,units) {
  if (!units.length) fail(`${unitId}: no required criteria`);
  for (const u of units) { level(u.assessed_level);level(u.possible_upper_level);if (u.assessed_level !== null && u.possible_upper_level !== null && u.assessed_level>u.possible_upper_level) fail('Invalid mean input bounds'); }
  const blocked=units.filter(u=>['partial_scope','needs_reconciliation','not_classifiable','below_baseline'].includes(u.status));
  const known=units.every(u=>u.assessed_level !== null),total=known ? units.reduce((s,u)=>s+u.assessed_level,0) : null;
  const upperTotal=units.reduce((s,u)=>s+(u.possible_upper_level ?? 5),0);
  let rawMean=known ? total/units.length : null,rawUpper=upperTotal/units.length,lower=known ? Math.floor(total/units.length) : null,upper=Math.floor(upperTotal/units.length),status=stateStatus(lower,upper);
  if (blocked.length) { lower=upper=rawMean=rawUpper=null;status=blocked[0].status; }
  const fulfilled=Object.assign({},...units.map(u=>u.fulfilled_question_levels ?? {})),union=field=>uniqueSorted(units.flatMap(u=>u[field] ?? []));
  return {unit_id:unitId,assessed_level:lower,possible_upper_level:upper,status,aggregation_method:'arithmetic_mean_floor',unrounded_mean:rawMean,unrounded_upper_mean:rawUpper,unit_results:clone(units),limiting_unit_ids:[],weaker_criterion_ids:units.filter(u=>rawMean !== null && u.assessed_level<rawMean).map(u=>u.unit_id),higher_level_unit_ids:units.filter(u=>lower !== null && u.assessed_level>lower).map(u=>u.unit_id),blocking_question_ids:union('blocking_question_ids'),open_question_ids:union('open_question_ids'),higher_level_strength_question_ids:keys(fulfilled).filter(q=>fulfilled[q]>(lower ?? 0)).sort(),fulfilled_question_levels:fulfilled};
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y,m,d]=value.split('-').map(Number),date=new Date(Date.UTC(y,m-1,d));
  if (y<100) date.setUTCFullYear(y);
  return y>=1 && date.getUTCFullYear()===y && date.getUTCMonth()===m-1 && date.getUTCDate()===d;
}
function validDatetime(value) { return typeof value === 'string' && validDate(value.slice(0,10)) && Number.isFinite(Date.parse(value)); }
function evidenceUsable(ids,register,scopeId) { return ids.length>0 && ids.every(id=>Object.hasOwn(register,id) && register[id].scope_ids.includes(scopeId)); }
function ratingRecords(catalog,record,register,options={}) {
  const rows=unique(record.extensions.criterion_ratings ?? [],'criterion_id','Criterion ratings');
  const allowed=[...(catalog.rating_units ?? []),...(catalog.assessment_modules ?? []).flatMap(m=>m.rating_units)].map(c=>c.criterion_id);
  if (missingKeys(rows,allowed).length) fail('Unknown or excluded baseline criterion rating');
  const fields=['criterion_id','assessed_level','possible_upper_level','review_status','evidence_status','evidence_ids','assessor_rationale','reviewer_id','reviewed_at'],result={};
  for (const [cid,row] of Object.entries(rows)) {
    if (!sameKeys(row,fields)) fail(`${cid}: noncanonical criterion rating fields`);
    const lower=level(row.assessed_level),upper=level(row.possible_upper_level);
    if (lower !== null && (upper === null || lower>upper)) fail('Invalid criterion rating bounds');
    if (!REVIEW.includes(row.review_status) || !EVIDENCE.includes(row.evidence_status)) fail('Invalid criterion rating review state');
    for (const id of row.evidence_ids) if (!Object.hasOwn(register,id)) fail('Dangling criterion rating evidence');
    if (row.reviewed_at !== null && !validDatetime(row.reviewed_at)) fail('Invalid criterion rating review date');
    const approved=row.review_status === 'approved' && (simplified(options) || (row.evidence_status === 'sufficient' && truth(row.reviewer_id) && truth(row.reviewed_at) && Boolean(row.assessor_rationale.trim()) && evidenceUsable(row.evidence_ids,register,record.context.scope_id)));
    result[cid]={unit_id:cid,assessed_level:approved ? lower : null,possible_upper_level:approved && upper !== null ? upper : 5,status:approved ? stateStatus(lower,upper) : 'open',evidence_ids:approved ? row.evidence_ids : [],rating_source:simplified(options)?'self_assessed_criterion_rating':'reviewed_criterion_rating'};
  }
  return result;
}
function chooseRating(cid,native,ratings) {
  if (!Object.hasOwn(ratings,cid)) return native ?? {unit_id:cid,assessed_level:null,possible_upper_level:5,status:'open'};
  const selected=clone(ratings[cid]);
  if (native && selected.assessed_level !== null) {
    if (['below_baseline','needs_reconciliation'].includes(native.status)) fail('Criterion rating conflicts with confirmed baseline finding');
    if (native.possible_upper_level !== null && selected.assessed_level>native.possible_upper_level) fail('Criterion rating exceeds a confirmed requirement gap');
    if (native.assessed_level !== null && selected.possible_upper_level<native.assessed_level) fail('Criterion rating contradicts a higher proven level');
  }
  return selected;
}
function contextStatus(record,options={}) {
  if(simplified(options)){
    const c=record.context??{};
    return truth(c.scope_id)&&truth(c.scope_description)&&Array.isArray(c.services_in_scope)&&c.services_in_scope.some(service=>typeof service==='string'&&service.trim())&&c.scope_reviewed===true?'complete':'scope_pending';
  }
  const c=record.context ?? {},required=['organization','scope_id','scope_description','services_in_scope','criticality','assessment_period','assessment_date','assessors'];
  if (required.some(k=>!truth(c[k])) || !c.scope_reviewed) return 'context_incomplete';
  if (!truth(c.assessment_period.start) || !truth(c.assessment_period.end)) return 'context_incomplete';
  return c.evidence_reviewed ? 'complete' : 'evidence_review_pending';
}
function validateRecord(catalog,record) {
  const allowed=keys(catalog.assessment_input_schema.properties);
  if (missingKeys(record,allowed).length) fail(`Non-canonical root fields: ${missingKeys(record,allowed).sort().join(', ')}`);
  for (const key of catalog.assessment_input_schema.required) if (!Object.hasOwn(record,key)) fail(`Missing input field ${key}`);
  if (record.catalog_id !== catalog.catalog_id || record.catalog_version !== VERSION) fail('Catalog/version mismatch; migrate answers explicitly');
  if (!truth(record.assessment_id) || !truth(record.assessment_unit_id)) fail('Missing assessment identity');
  const mode=record.assessment_execution_mode;
  if (!['draft_preview','pilot','regular'].includes(mode)) fail('Invalid execution mode');
  if (mode === 'regular' && !catalog.metadata.model_validation_completed) fail('regular mode requires a validated catalog; use explicit draft_preview');
  if (mode === 'pilot' && catalog.metadata.status !== 'validated_for_internal_use' && !catalog.metadata.pilot_ready) fail('pilot mode requires documented pilot readiness');
  const context=record.context,contextSchema=catalog.assessment_input_schema.properties.context;
  if (missingKeys(context,keys(contextSchema.properties)).length) fail('Non-canonical context field');
  for (const key of contextSchema.required) if (!Object.hasOwn(context,key)) fail(`Missing context field ${key}`);
  const period=context.assessment_period;
  if (!period || typeof period !== 'object' || Array.isArray(period) || !sameKeys(period,['start','end'])) fail('assessment_period must contain start/end');
  for (const date of [period.start,period.end,context.assessment_date]) if (date !== null && !validDate(date)) fail('Invalid assessment date');
  if (period.start && period.end && period.start>period.end) fail('Reversed period');
  for (const k of ['scope_reviewed','evidence_reviewed']) if (typeof context[k] !== 'boolean') fail(`${k} must be boolean`);
  if (!Array.isArray(context.services_in_scope) || !Array.isArray(context.assessors)) fail('services_in_scope and assessors must be arrays');
  for (const field of catalog.component_extension_schema.required ?? []) if (!Object.hasOwn(record.extensions,field)) fail(`Missing component extension ${field}`);
  const register=unique(record.evidence_register,'evidence_id','Evidence register');
  for (const evidence of values(register)) if (!truth(evidence.source_locator) || !truth(evidence.title) || !Array.isArray(evidence.scope_ids)) fail('Unresolved evidence source or missing scope_ids');
  const questions=Object.fromEntries(allQuestions(catalog).map(q=>[q.id,q])),responses=unique(record.responses,'question_id','Responses');
  for (const [qid,response] of Object.entries(responses)) {
    if (!Object.hasOwn(questions,qid)) fail(`Unknown question ${qid}`);
    if (questions[qid].collection_mode === 'derived') fail(`${qid} is a derived view; answer the source question`);
    if (!sameKeys(response,FIELDS)) fail(`${qid}: non-canonical or missing response fields`);
    if (!ANSWERS.includes(response.answer) || !FINDINGS.includes(response.finding)) fail(`${qid}: invalid answer/finding`);
    if (!REVIEW.includes(response.review_status) || !EVIDENCE.includes(response.evidence_status)) fail(`${qid}: invalid review/evidence state`);
    for (const id of response.evidence_ids) if (!Object.hasOwn(register,id)) fail(`${qid}: dangling evidence ${id}`);
    const checks=unique(response.check_results,'check_id',`${qid} checks`),allowedChecks=questions[qid].checks.map(c=>c.id);
    if (missingKeys(checks,allowedChecks).length) fail(`${qid}: unknown check`);
    for (const check of values(checks)) {
      if (!FINDINGS.includes(check.finding)) fail(`${qid}: invalid check finding`);
      for (const id of check.evidence_ids) if (!Object.hasOwn(register,id)) fail(`${qid}: dangling check evidence`);
    }
    if (response.reviewed_at !== null && !validDatetime(response.reviewed_at)) fail(`${qid}: invalid reviewed_at`);
  }
  return {questions,responses,register};
}
function questionState(question,response,record,register,options={}) {
  if (!response) return 'open';
  if (response.review_status !== 'approved') return 'open';
  if(simplified(options)&&response.answer==='unknown')return 'open';
  if (!simplified(options)&&(response.evidence_status !== 'sufficient' || !response.assessor_rationale.trim() || !truth(response.reviewer_id) || !truth(response.reviewed_at) || !evidenceUsable(response.evidence_ids,register,record.context.scope_id))) return 'open';
  const finding=simplified(options)?{yes:'fulfilled',partial:'partial',no:'not_fulfilled',unknown:'open'}[response.answer]:response.finding;
  if (finding === 'not_applicable') fail(`${question.id}: entire question cannot be not_applicable`);
  const checks=Object.fromEntries(response.check_results.map(c=>[c.check_id,c])),outcomes=[];
  for (const check of question.checks) {
    const applicability=check.applicability ?? {kind:'always'}; let outcome=checks[check.id]?.finding ?? 'open';
    if (applicability.kind === 'scope_flag_true') {
      const flag=applicability.flag,flags=record.extensions.scope_flags ?? {},decision=record.extensions.scope_flag_decisions?.[flag] ?? {};
      if (flags[flag] === false) {
        if (decision.review_status === 'approved' && (simplified(options)||(truth(decision.rationale) && evidenceUsable(decision.evidence_ids ?? [],register,record.context.scope_id)))) { outcomes.push('not_applicable');continue; }
        outcomes.push('open');continue;
      }
      if (flags[flag] !== true) { outcomes.push('open');continue; }
    }
    if (outcome === 'not_applicable') fail(`${question.id}: unapproved or unconditional exclusion`);
    if (keys(checks).length) {
      if (!simplified(options)&&!evidenceUsable(checks[check.id]?.evidence_ids ?? [],register,record.context.scope_id)) outcome='open';
      outcomes.push(outcome);
    } else outcomes.push(finding);
  }
  const hasFail=outcomes.some(x=>['not_fulfilled','partial'].includes(x));
  if (finding === 'fulfilled' && hasFail) fail(`${question.id}: fulfilled finding conflicts with failed check`);
  if (['not_fulfilled','partial'].includes(finding)) {
    if (hasFail) return 'not_fulfilled';
    if (outcomes.every(x=>['fulfilled','not_applicable'].includes(x))) fail(`${question.id}: negative finding conflicts with fulfilled checks`);
    return 'open';
  }
  return finding === 'fulfilled' && outcomes.every(x=>['fulfilled','not_applicable'].includes(x)) ? 'fulfilled' : 'open';
}
function computeStates(catalog,record,options={}) {
  const {questions,responses,register}=validateRecord(catalog,record),states={};
  if ((record.extensions.excluded_question_ids ?? []).some(id=>!Object.hasOwn(questions,id))) fail('Unknown excluded question');
  for (const [qid,q] of Object.entries(questions)) if (q.collection_mode === 'direct') states[qid]=questionState(q,responses[qid],record,register,options);
  for (const [qid,q] of Object.entries(questions)) if (q.collection_mode === 'derived') {
    if (!Object.hasOwn(states,q.answer_source_question_id)) fail('Invalid projection source');
    states[qid]=states[q.answer_source_question_id];
  }
  return {questions,states,register};
}
function finalize(catalog,record,raw,sourceResults=[],levelType='maturity',extraDraft=false,options={}) {
  const result=clone(raw),c=record.context;
  result.component_id=catalog.metadata.component_id;result.level_type=levelType;
  for (const key of ['assessment_id','assessment_unit_id','catalog_id','catalog_version']) result[key]=record[key];
  for (const key of ['scope_id','scope_description','assessment_period']) result[key]=clone(c[key]);
  result.policy_id=POLICY_ID;result.score_semantics=catalog.common_assessment_policy.score_semantics;
  result.aggregation_method ??= 'criterion_ladder';
  for (const key of ['unrounded_mean','unrounded_upper_mean']) result[key] ??= null;
  result.weaker_criterion_ids ??= [];result.context_status=contextStatus(record,options);
  const validated=Boolean(catalog.metadata.model_validation_completed && sourceResults.every(s=>s.model_validation_completed ?? false));
  result.model_validation_completed=validated && !extraDraft;
  const draft=!validated || ['draft_preview','pilot'].includes(record.assessment_execution_mode) || extraDraft || sourceResults.some(s=>s.result_is_draft ?? true);
  result.result_is_draft=draft;
  const closed=['confirmed','below_baseline'].includes(result.status);
  result.is_final=closed && result.context_status === 'complete' && !draft;
  result.release_status=draft ? 'draft' : result.context_status !== 'complete' ? 'context_pending' : closed ? 'released' : 'review_pending';
  const relevant=result.practice_id ? record.responses.filter(r=>r.question_id.startsWith(result.practice_id+'-')) : record.responses;
  result.evidence_ids=uniqueSorted([...relevant.flatMap(r=>r.evidence_ids),...sourceResults.flatMap(s=>s.evidence_ids ?? []),...(result.unit_results ?? []).flatMap(u=>u.evidence_ids ?? [])]);
  for (const key of ['blocking_question_ids','open_question_ids','higher_level_strength_question_ids','limiting_unit_ids','unit_results','limitations']) result[key] ??= [];
  result.fulfilled_question_levels ??= {};
  result.scope_qualification ??= 'Ergebnis ausschließlich für den angegebenen geprüften Umfang.';
  if (draft) result.limitations.push('Entwurfsbewertung: verwendetes Modell noch nicht fachlich validiert oder ausdrücklich im Entwurfs-/Pilotmodus.');
  if(simplified(options)){
    Object.assign(result,assuranceMetadata(),{model_validation_completed:false,result_is_draft:true,is_final:false,release_status:'draft'});
    result.scope_qualification=raw.scope_qualification??'Selbsteinschätzung für den angegebenen Umfang; keine externe Nachweisprüfung.';
    if(result.category_level_source)result.category_level_source='self_assessed_component_maturity_criteria';
    result.consistency_notes??=[];
    result.limitations.push('Selbsteinschätzung: Antworten gelten als eigene Angaben; Nachweise und Begründungen sind optional.');
    if(result.context_status!=='complete')result.limitations.push('Der gemeinsame Bewertungsumfang ist noch offen. Kategorieprofile bleiben sichtbar; ein Gesamt-SVS-Level benötigt einen bestätigten Umfang.');
  }
  return result;
}
function criterionResults(catalog,record,questions,states,register,options={}) {
  const units=[],ratings=ratingRecords(catalog,record,register,options),decisions=unique(record.extensions.criterion_applicability ?? [],'criterion_id','Applicability');
  if (missingKeys(decisions,['GV08']).length) fail('Only GV08 allows whole-criterion exclusion');
  for (const criterion of catalog.criteria) {
    const cid=criterion.id,decision=decisions[cid];
    if (decision && decision.applicable === false) {
      if (!(decision.review_status === 'approved' && (simplified(options)||(truth(decision.rationale) && evidenceUsable(decision.evidence_ids ?? [],register,record.context.scope_id))))) units.push({unit_id:cid,assessed_level:null,possible_upper_level:5,status:'open'});
      continue;
    }
    const requirements=Object.fromEntries(criterion.stages.map(stage=>[stage.level,stage.question_ids]));
    units.push(chooseRating(cid,ladder(cid,requirements,states,questions),ratings));
  }
  return units;
}
function svcScope(catalog,record,register,result,options={}) {
  const ext=record.extensions,rows=ext.value_stream_inventory ?? [];
  unique(rows,'id','Value streams');
  const mode=ext.coverage_mode,selected=rows.filter(r=>truth(r.assessed));
  let valid=Boolean(selected.length && ext.inventory_reviewed === true && (simplified(options)||evidenceUsable(ext.coverage_evidence_ids ?? [],register,record.context.scope_id)));
  if (mode === 'all_major_streams_in_scope') valid=valid && rows.every(r=>r.is_major != null) && rows.filter(r=>truth(r.is_major)).every(r=>truth(r.assessed));
  else if (mode === 'selected_streams') {
    valid=valid && (simplified(options)||(truth(ext.stream_selection_rationale) && rows.filter(r=>truth(r.is_major) && !truth(r.assessed)).every(r=>truth(r.excluded_reason))));
    Object.assign(result,{status:'partial_scope',assessed_level:null,possible_upper_level:null,scope_qualification:'Teilprofil der ausgewählten Wertströme; kein vollständiger SVC-Komponentenwert.'});
  } else valid=false;
  if (!valid) Object.assign(result,{status:'partial_scope',assessed_level:null,possible_upper_level:null,limitations:['Wertstromumfang oder Auswahl noch nicht vollständig geprüft.']});
  result.assessed_value_stream_ids=selected.map(r=>r.id); return result;
}
function guidingPrinciples(catalog,record,questions,states,register,options={}) {
  const ratings=ratingRecords(catalog,record,register,options),units=catalog.rating_units.map(u=>chooseRating(u.criterion_id,null,ratings)),raw=componentFeatures(catalog,questions,states);
  raw.detail_index=meanFloor('guiding_principles_details',units);raw.unit_results=units;
  if (states['GP-R01'] === 'fulfilled' && states['GP-R02'] === 'fulfilled' && states['GP-R03'] === 'fulfilled') {
    if(simplified(options))raw.consistency_notes=['GP-R01 beschreibt unterschiedliche Auffassungen, während GP-R02 und GP-R03 gemeinsame Werte und Prinzipien bestätigen. Bitte diese Antworten auf Konsistenz prüfen. Die Anfangsklassifikation GP-R01 begrenzt in Version 3 die höhere Kategorie-Stufe nicht.'];
    else Object.assign(raw,{status:'needs_reconciliation',assessed_level:null,possible_upper_level:null});
  }
  if (truth(record.extensions.excluded_question_ids)) Object.assign(raw,{status:'partial_scope',assessed_level:null,possible_upper_level:null});
  return raw;
}
function practiceScope(catalog,record,register,options={}) {
  const ext=record.extensions,registry=catalog.practice_registry.map(r=>r.id),rows=unique(ext.scope_decisions ?? [],'practice_id','Practice selection');
  if (missingKeys(rows,registry).length) fail('Unknown practice in selection');
  const selected=keys(rows).filter(pid=>rows[pid].selection_status === 'included'),mode=ext.assessment_mode ?? 'svs_maturity';
  if (!['svs_maturity','practice_capability_only'].includes(mode)) fail('Invalid practice assessment mode');
  let valid=Boolean(ext.scope_review_complete === true && sameKeys(rows,registry) && selected.length);
  const required=ext.confirmed_required_practice_ids ?? [];
  if (required.some(pid=>!registry.includes(pid))) fail('Unknown required practice');
  if (required.some(pid=>!selected.includes(pid))) valid=false;
  if (mode === 'svs_maturity' && !selected.includes('PR02')) valid=false;
  for (const row of values(rows)) {
    if (!['included','not_selected','not_applicable'].includes(row.selection_status) || (simplified(options)?row.reviewed!==true:!truth(row.reviewed)) || (!simplified(options)&&(!truth(row.rationale) || !evidenceUsable(row.evidence_ids ?? [],register,record.context.scope_id)))) valid=false;
    if (row.selection_status === 'included' && (!['primary','supporting'].includes(row.scope_role) || (!simplified(options)&&!(truth(row.objective_ids) || truth(row.value_stream_ids))))) valid=false;
  }
  const edges=Object.fromEntries(catalog.dependency_hints.map(e=>[e.id,e]));
  for (const edge of ext.custom_dependency_edges ?? []) {
    if (Object.hasOwn(edges,edge.id)) fail('Duplicate dependency edge');
    if (!registry.includes(edge.from_practice_id) || !registry.includes(edge.to_practice_id)) fail('Unknown dependency practice');
    edges[edge.id]=edge;
  }
  const decisions=unique(ext.dependency_decisions ?? [],'dependency_id','Dependencies');
  for (const [did,decision] of Object.entries(decisions)) {
    if (!Object.hasOwn(edges,did)) fail('Unknown dependency edge');
    if (!['needed','not_needed'].includes(decision.decision) || (simplified(options)?decision.reviewed!==true:!truth(decision.reviewed)) || (!simplified(options)&&(!truth(decision.rationale) || !evidenceUsable(decision.evidence_ids ?? [],register,record.context.scope_id)))) valid=false;
    const edge=edges[did];
    if (decision.decision === 'needed' && selected.includes(edge.from_practice_id) && !selected.includes(edge.to_practice_id)) valid=false;
  }
  return {selected,valid};
}
function practices(catalog,record,questions,states,register,options={}) {
  const {selected,valid:scopeValid}=practiceScope(catalog,record,register,options),modules=Object.fromEntries(catalog.assessment_modules.map(m=>[m.practice_id,m])),results={},ratings=ratingRecords(catalog,record,register,options);
  for (const pid of selected) {
    const module=modules[pid];
    if (!module.content_complete) fail(`${pid}: incomplete module`);
    if (record.assessment_execution_mode === 'regular' && !module.model_validation_completed) fail(`${pid}: regular mode requires validated module`);
    if (record.assessment_execution_mode === 'pilot' && !['pilot_ready','validated_for_internal_use'].includes(module.module_status)) fail(`${pid}: pilot not ready`);
    const criteria=Object.fromEntries(module.criteria.map(c=>[c.id,c])),base=module.criteria.find(c=>c.category_id === 'PC01'),baselineIds=base.level_requirements.flatMap(s=>s.question_ids),baseline=baselineIds[0],units=[];
    for (const criterion of module.criteria) {
      if (criterion.category_id === 'PC01') continue;
      const requirements=Object.fromEntries(criterion.level_requirements.map(s=>[s.level,s.question_ids]));requirements[1]=baselineIds;
      units.push(chooseRating(criterion.id,ladder(criterion.id,requirements,states,questions),ratings));
    }
    const raw=meanFloor(pid,units);
    if (states[baseline] === 'open') Object.assign(raw,{status:'open',assessed_level:null,possible_upper_level:5});
    if (states[baseline] === 'not_fulfilled') Object.assign(raw,{status:'below_baseline',assessed_level:null,possible_upper_level:null});
    const purposeQuestions=module.questions.filter(q=>criteria[q.criterion_id].category_id === 'PC06' && q.level === 2).map(q=>q.id);
    if (states[baseline] === 'not_fulfilled' && purposeQuestions.some(q=>states[q] === 'fulfilled')) Object.assign(raw,{status:'needs_reconciliation',assessed_level:null,possible_upper_level:null});
    Object.assign(raw,{practice_id:pid,module_id:module.module_id,module_version:module.module_version,scope_review_complete:scopeValid});
    results[pid]=finalize(catalog,record,raw,[],'capability',!module.model_validation_completed,options);
  }
  const rows=record.extensions.scope_decisions ?? [],keyIds=rows.filter(r=>r.selection_status === 'included' && r.scope_role === 'primary').map(r=>r.practice_id),supportIds=rows.filter(r=>r.selection_status === 'included' && r.scope_role === 'supporting').map(r=>r.practice_id),raw=practiceComponentEligibility(results,keyIds,supportIds);
  if (!scopeValid) Object.assign(raw,{status:'partial_scope',assessed_level:null,possible_upper_level:null});
  Object.assign(raw,{primary_practice_ids:keyIds,supporting_practice_ids:supportIds,scope_review_complete:scopeValid});
  return [finalize(catalog,record,raw,values(results),'maturity',false,options),results];
}
const equalPeriod=(a,b)=>a.start === b.start && a.end === b.end;
function continualImprovement(catalog,record,questions,states,practiceResult,options={}) {
  const register=Object.fromEntries(record.evidence_register.map(r=>[r.evidence_id,r]));let usable=false;
  if (practiceResult !== null) {
    for (const field of catalog.practice_dependency.required_fields) if (!Object.hasOwn(practiceResult,field)) fail(`PR02 import missing ${field}`);
    if (practiceResult.practice_id !== 'PR02' || practiceResult.module_id !== 'MOD-PR02' || practiceResult.catalog_id !== 'svs-practices' || practiceResult.catalog_version !== VERSION || practiceResult.policy_id !== (simplified(options)?SIMPLIFIED_POLICY_ID:POLICY_ID)) fail('Incompatible PR02 model or identifier');
    if(simplified(options)&&(practiceResult.assessment_mode!==SIMPLIFIED_MODE||practiceResult.assurance_level!=='self_assessment'))fail('PR02 source must be an explicit compatible self-assessment');
    for (const marker of ['result_is_draft','model_validation_completed','is_final']) if (typeof practiceResult[marker] !== 'boolean') fail('Invalid PR02 marker');
    if (!practiceResult.model_validation_completed && !practiceResult.result_is_draft) fail('Unvalidated PR02 result must remain draft');
    if (practiceResult.result_is_draft && (practiceResult.is_final || practiceResult.release_status !== 'draft')) fail('Draft PR02 result cannot be marked final or released');
    const lower=level(practiceResult.assessed_level),upper=level(practiceResult.possible_upper_level);
    if (lower !== null && (upper === null || upper<lower)) fail('Invalid PR02 bounds');
    if (practiceResult.status === 'confirmed' && (lower === null || lower !== upper)) fail('Confirmed PR02 requires equal proven bounds');
    if (practiceResult.status === 'provisional' && (lower === null || upper === null || lower>=upper)) fail('Provisional PR02 requires an unresolved upper bound');
    const same=practiceResult.assessment_unit_id === record.assessment_unit_id && practiceResult.scope_id === record.context.scope_id && equalPeriod(practiceResult.assessment_period,record.context.assessment_period);
    usable=Boolean(same && (simplified(options)||practiceResult.context_status === 'complete') && practiceResult.scope_review_complete === true && ['confirmed','provisional','open','below_baseline'].includes(practiceResult.status));
    if (practiceResult.aggregation_method !== 'arithmetic_mean_floor') fail('PR02 must use its local rounded mean');
    if (!simplified(options)&&lower !== null && !practiceResult.evidence_ids.length) fail('PR02 numeric result needs evidence');
    if (record.assessment_execution_mode === 'regular' && practiceResult.result_is_draft) fail('Draft PR02 cannot release regular CI result');
  }
  const source=usable ? practiceResult : null,ratings=ratingRecords(catalog,record,register,options);
  const units=catalog.criteria.map(c=>chooseRating(c.id,ladder(c.id,Object.fromEntries(c.stages.map(s=>[s.level,s.question_ids])),states,questions),ratings));
  const raw=componentFeatures(catalog,questions,states,Object.fromEntries(levels().map(n=>[n,[['PR02',n,source]]])));
  raw.detail_index=meanFloor('continual_improvement_details',units);raw.unit_results=units;raw.dependency_status=usable ? 'compatible' : 'pending';
  raw.diagnostic_profile_results=units.map(u=>({...u,profile_type:'individual_detail',influences_component_level:false}));
  if (!usable) raw.limitations=[simplified(options)?'Passende PR02-Selbsteinschätzung oder bestätigte Practice-Auswahl fehlt; die CI-Kategorie bleibt offen. Einzelprofil und erfüllte Kategorie-Merkmale werden separat angezeigt.':'Passender PR02-Nachweis fehlt; die CI-Kategorie bleibt offen. Einzelprofil und erfüllte Kategorie-Merkmale werden separat angezeigt.'];
  if (truth(record.extensions.excluded_question_ids)) Object.assign(raw,{status:'partial_scope',assessed_level:null,possible_upper_level:null});
  const result=finalize(catalog,record,raw,practiceResult ? [practiceResult] : [],'maturity',false,options);
  if (!usable) { result.is_final=false;if (!result.result_is_draft) result.release_status='dependency_pending'; }
  return result;
}
export function evaluate(catalog,record,practiceResult=null,options={}) {
  if(options.mode!==undefined&&options.mode!=='reviewed_assessment'&&!simplified(options))fail('Unknown evaluation mode');
  const {questions,states,register}=computeStates(catalog,record,options),component=catalog.metadata.component_id;
  if (component === 'practices') return practices(catalog,record,questions,states,register,options);
  if (component === 'continual_improvement') return continualImprovement(catalog,record,questions,states,practiceResult,options);
  let raw;
  if (component === 'guiding_principles') raw=guidingPrinciples(catalog,record,questions,states,register,options);
  else {
    const units=criterionResults(catalog,record,questions,states,register,options);raw=componentFeatures(catalog,questions,states);
    raw.unit_results=units;raw.detail_index=meanFloor(component+'_details',units);
    if (component === 'service_value_chain') raw=svcScope(catalog,record,register,raw,options);
  }
  return finalize(catalog,record,raw,[],'maturity',false,options);
}
export function collectionPlan(catalog,{includeDiagnostics=false,selectedPracticeIds=null}={}) {
  const all=allQuestions(catalog),isPractices=catalog.metadata.component_id === 'practices';
  const direct=all.filter(q=>q.collection_mode === 'direct' && (isPractices || includeDiagnostics || ['component_requirement','initial_classification'].includes(q.kind)) && (selectedPracticeIds === null || !isPractices || selectedPracticeIds.includes(q.evaluation_subject)));
  return {direct_question_ids:direct.map(q=>q.id),category_requirement_question_ids:direct.filter(q=>Object.hasOwn(q,'component_level') && q.kind !== 'principle_application_evidence_helper').map(q=>q.id),individual_question_ids:direct.filter(q=>Object.hasOwn(q,'level')).map(q=>q.id),derived_views:all.filter(q=>q.collection_mode === 'derived').map(q=>({question_id:q.id,source_question_id:q.answer_source_question_id})),shared_fact_bindings:Object.fromEntries(direct.map(q=>[q.id,{fact_ids:q.shared_fact_ids,subject_id:q.evaluation_subject}]))};
}
export function evaluateSvs(catalogs,records,options={}) {
  if(options.mode!==undefined&&options.mode!=='reviewed_assessment'&&!simplified(options))fail('Unknown evaluation mode');
  const unknown=missingKeys(records,keys(FILES));if (unknown.length) fail(`Unknown components ${unknown.join(', ')}`);
  const results={};let practiceResults={};
  if (Object.hasOwn(records,'practices')) [results.practices,practiceResults]=evaluate(catalogs.practices,records.practices,null,options);
  for (const component of keys(FILES)) if (!['practices','continual_improvement'].includes(component) && Object.hasOwn(records,component)) results[component]=evaluate(catalogs[component],records[component],null,options);
  if (Object.hasOwn(records,'continual_improvement')) results.continual_improvement=evaluate(catalogs.continual_improvement,records.continual_improvement,practiceResults.PR02 ?? null,options);
  let total;
  if (!sameKeys(results,keys(FILES))) total={unit_id:'svs',assessed_level:null,possible_upper_level:5,status:'open',missing_component_ids:keys(FILES).filter(k=>!Object.hasOwn(results,k)).sort(),is_final:false,result_is_draft:true,model_validation_completed:false,release_status:'draft'};
  else {
    const units=values(results),sample=units[0];
    if (!units.every(r=>r.assessment_unit_id === sample.assessment_unit_id && r.scope_id === sample.scope_id && equalPeriod(r.assessment_period,sample.assessment_period))) fail('SVS aggregation requires identical assessment unit, scope_id and period');
    total=minimum('svs',units);
    if (units.some(r=>r.context_status !== 'complete')) Object.assign(total,{status:'open',assessed_level:null,possible_upper_level:5});
    const validated=units.every(r=>r.model_validation_completed),draft=units.some(r=>r.result_is_draft) || !validated;
    Object.assign(total,{component_id:'svs',level_type:'maturity',policy_id:POLICY_ID,model_validation_completed:validated,result_is_draft:draft,is_final:!draft && ['confirmed','below_baseline'].includes(total.status)});
    total.release_status=draft ? 'draft' : total.is_final ? 'released' : 'review_pending';
    for (const key of ['assessment_id','assessment_unit_id','scope_id','scope_description','assessment_period']) total[key]=clone(sample[key]);
  }
  total.component_profile=Object.entries(results).map(([n,r])=>({component_id:n,assessed_level:r.assessed_level,possible_upper_level:r.possible_upper_level,status:r.status}));
  total.higher_scoring_component_ids=keys(results).filter(n=>total.assessed_level !== null && results[n].assessed_level !== null && results[n].assessed_level>total.assessed_level);
  total.graphic_rule='Show each actual component bar; show the SVS minimum as a separate number/reference line.';
  if(simplified(options)){
    Object.assign(total,assuranceMetadata(),{model_validation_completed:false,result_is_draft:true,is_final:false,release_status:'draft'});
    total.context_status=values(results).every(r=>r.context_status==='complete')?'complete':'scope_pending';
    total.limitations=[...(total.limitations??[]),'Selbsteinschätzung: Keine externe Nachweisprüfung.'];
    total.consistency_notes=uniqueSorted(values(results).flatMap(result=>result.consistency_notes??[]));
    if(total.context_status!=='complete')total.limitations.push('Ein Gesamt-SVS-Level benötigt einen gemeinsamen bestätigten Umfang mit mindestens einem Service.');
  }
  return {policy_id:simplified(options)?SIMPLIFIED_POLICY_ID:POLICY_ID,catalog_version:VERSION,component_results:results,practice_results:practiceResults,svs_result:total,...(simplified(options)?{...assuranceMetadata(),consistency_notes:[...total.consistency_notes]}:{})};
}
export function evaluateAssessment(input,catalogs,options={}) { return evaluateSvs(catalogs,input.assessments ?? input,options); }
export function evaluateSimplifiedAssessment(input,catalogs){return evaluateAssessment(input,catalogs,{mode:SIMPLIFIED_MODE});}
// Aliases keep the provided Python acceptance-test terminology easy to compare.
export const all_questions=allQuestions, mean_floor=meanFloor, evaluate_svs=evaluateSvs;
export const collection_plan=(catalog,include_diagnostics=false,selected_practice_ids=null)=>collectionPlan(catalog,{includeDiagnostics:include_diagnostics,selectedPracticeIds:selected_practice_ids});

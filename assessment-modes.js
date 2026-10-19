/** Explicit application policies layered over the unchanged V5 catalog validator.
 * Quick assigns category stages; detailed assesses every individual aspect.
 * Both use the same role thresholds for the Practices category stage and a
 * separate equal-weighted mean of all selected complete practice exact values.
 * Both retain the exact mean of five category values; the SVS stage is the
 * minimum of the five category stages. These are explicitly separate outputs.
 */
import {evaluateSimplifiedAssessment, InputError, FILES} from './scoring.js';

export const ASSESSMENT_DEPTHS = Object.freeze({
  quick: Object.freeze({id:'quick', label:'Schnellbewertung'}),
  detailed: Object.freeze({id:'detailed', label:'Detailbewertung'}),
});
export const ASSESSMENT_POLICY_REVISION = 3;
export const QUICK_POLICY_ID = 'GOEK-SVS-QUICK-PRACTICE-ROLE-STAGE-EQUAL-MEAN-SVS-MEAN-MIN-3';
export const DETAILED_POLICY_ID = 'GOEK-SVS-DETAILED-PRACTICE-ROLE-STAGE-EQUAL-MEAN-SVS-MEAN-MIN-3';
export const SVS_VALUE_AGGREGATION_METHOD = 'arithmetic_mean_of_five_component_exact_values';
export const SVS_LEVEL_AGGREGATION_METHOD = 'minimum_of_five_component_stages';
export const PRACTICES_VALUE_AGGREGATION_METHOD = 'arithmetic_mean_of_selected_practice_exact_values';
export const PRACTICES_LEVEL_AGGREGATION_METHOD = 'explicit_role_thresholds';
const componentIds = Object.keys(FILES);
const clone = value => structuredClone(value);
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const validStage = value => Number.isInteger(value) && value >= 1 && value <= 5;
const unique = values => [...new Set(values)];
const closed = unit => unit?.status === 'confirmed' && validStage(unit.assessed_level) && unit.assessed_level === unit.possible_upper_level;
const policyId = depth => depth === 'detailed' ? DETAILED_POLICY_ID : QUICK_POLICY_ID;
// Internal rational values retain the integer aspect stages and their exact
// denominators across every aggregation boundary. They never enter JSON output.
const fractions = new WeakMap();
const gcd = (a,b) => { while (b) [a,b] = [b,a%b]; return a; };
function fraction(n,d=1n) { const common=gcd(n,d); return {n:n/common,d:d/common}; }
function averageUnits(units) {
  if (!units.length) return null;
  let sum={n:0n,d:1n};
  for (const unit of units) {
    const value=fractions.get(unit) ?? (validStage(unit.exact_value) ? fraction(BigInt(unit.exact_value)) : null);
    if (!value) throw new InputError('Interner Bewertungswert besitzt keine eindeutige Aspektgrundlage.');
    sum=fraction(sum.n*value.d+value.n*sum.d,sum.d*value.d);
  }
  return fraction(sum.n,sum.d*BigInt(units.length));
}

/** Old payloads without a depth retain their category-stage interpretation. */
export function getAssessmentDepth(payload) {
  const depth = payload?.assessment_depth;
  if (depth === undefined || depth === null) return 'quick';
  if (!Object.hasOwn(ASSESSMENT_DEPTHS,depth)) throw new InputError('Unbekannte Bewertungstiefe; zulässig sind quick und detailed.');
  return depth;
}

function metadata(depth, method) {
  return {
    assessment_depth:depth, mode_label:ASSESSMENT_DEPTHS[depth].label,
    policy_id:policyId(depth), aggregation_policy_id:policyId(depth),
    policy_revision:ASSESSMENT_POLICY_REVISION,
    scoring_method:method, assessment_mode:'simplified_self_assessment', assurance_level:'self_assessment',
    model_validation_completed:false, result_is_draft:true, is_final:false, release_status:'draft',
    score_semantics:depth === 'detailed'
      ? 'Selbsteinschätzung: vollständig eingestufte Einzelaspekte werden gleichgewichtet gemittelt; Practice-Fähigkeitsstufen werden abgerundet. Der exakte Practices-Kategoriewert ist das gleichgewichtete Mittel aller ausgewählten vollständigen Practice-Werte, ohne Zwischenrundung und ohne Rollen-Gewichtung. Die finale Practices-Kategoriestufe folgt den Rollen-Schwellen und benötigt vollständige Detailbewertungen. Die anderen Kategorie-Stufen werden aus ihren vollständigen Aspektmitteln abgerundet. Der exakte SVS-Wert ist das Mittel der fünf vollständigen Kategorie-Werte; die SVS-Stufe ist das Minimum der fünf vollständig bestimmten Kategorie-Stufen. Wert und Stufe werden getrennt ausgewiesen.'
      : 'Selbsteinschätzung: Kategorie-Voraussetzungen und Practice-Rollenschwellen bestimmen die finalen Kategorie-Stufen. Der exakte Practices-Kategoriewert ist das gleichgewichtete Mittel aller ausgewählten vollständigen Practice-Werte, ohne Zwischenrundung und ohne Rollen-Gewichtung. Eine stabile Rollenstufe kann bereits feststehen, während dieser Mittelwert noch offen ist. Der exakte SVS-Wert benötigt alle fünf vollständigen Kategorie-Werte; die SVS-Stufe ist das Minimum der fünf vollständig bestimmten Kategorie-Stufen und kann unabhängig vom Mittelwert feststehen.',
    status_semantics:'confirmed bezeichnet eine vollständig bestimmte Stufe der Selbsteinschätzung, keine externe Nachweisprüfung. stage_complete und value_complete kennzeichnen Stufen- und Wertvollständigkeit getrennt; scoring_complete benötigt beides.',
  };
}

function attachValues(base, depth, method, {exact=null, partial=null, total=0, completed=0, scope=true, status=null, displayLevel=null}={}) {
  const complete = numeric(exact) && scope && total > 0 && completed === total;
  const stage = validStage(displayLevel) ? displayLevel : Math.floor(exact);
  return {
    ...base, ...metadata(depth,method),
    exact_value:complete ? exact : null,
    assessed_level:complete ? stage : null,
    possible_upper_level:complete ? stage : scope ? 5 : null,
    unrounded_mean:complete && method.includes('mean') ? exact : null,
    unrounded_upper_mean:complete && method.includes('mean') ? exact : null,
    partial_exact_value:complete ? null : numeric(partial) ? partial : null,
    completion:{total,completed}, value_complete:complete, stage_complete:complete,
    scoring_complete:complete, scope_complete:scope,
    status:complete ? 'confirmed' : status ?? (!scope ? 'partial_scope' : 'open'),
  };
}

function annotateAspect(unit, depth) {
  const complete = closed(unit), method = unit.rating_source
    ? 'explicit_anchored_criterion_rating' : 'highest_fully_fulfilled_cumulative_ladder';
  // Keep the source ladder's bounds and status for the question workflow. A
  // provisional lower stage is progress, never a completed aspect value.
  const result = {
    ...unit, ...metadata(depth,method),
    exact_value:complete ? unit.assessed_level : null,
    partial_exact_value:!complete && validStage(unit.assessed_level) ? unit.assessed_level : null,
    completion:{total:1,completed:Number(complete)}, value_complete:complete, stage_complete:complete, scoring_complete:complete,
  };
  if (complete) fractions.set(result,fraction(BigInt(unit.assessed_level)));
  return result;
}

function meanResult(base, units, depth, {scope=true, status=null, method='arithmetic_mean_of_completed_aspect_stages'}={}) {
  const completed = units.filter(unit=>numeric(unit.exact_value));
  const complete = units.length > 0 && completed.length === units.length;
  const rational = averageUnits(completed);
  const value = rational ? Number(rational.n)/Number(rational.d) : null;
  const result = {
    ...attachValues(base,depth,method,{
      exact:complete ? value : null,partial:value,total:units.length,completed:completed.length,scope,status,
      displayLevel:rational ? Number(rational.n/rational.d) : null,
    }),
    aggregation_method:'arithmetic_mean_without_intermediate_rounding',
    unit_results:units,
    partial_value_count:completed.length,
    partial_value_semantics:'Mittel ausschließlich der vollständig eingestuften Einheiten; kein vollständiger Ergebniswert.',
    weaker_criterion_ids:complete ? units.filter(unit=>unit.exact_value < value).map(unit=>unit.unit_id) : [],
    higher_level_unit_ids:complete ? units.filter(unit=>unit.exact_value > value).map(unit=>unit.unit_id) : [],
    limiting_unit_ids:units.filter(unit=>!numeric(unit.exact_value)).map(unit=>unit.unit_id),
    value_incomplete_unit_ids:units.filter(unit=>!numeric(unit.exact_value)).map(unit=>unit.unit_id),
    blocking_question_ids:unique(units.flatMap(unit=>unit.blocking_question_ids || [])),
    open_question_ids:unique(units.flatMap(unit=>unit.open_question_ids || [])),
    higher_level_strength_question_ids:unique(units.flatMap(unit=>unit.higher_level_strength_question_ids || [])),
    fulfilled_question_levels:Object.assign({},...units.map(unit=>unit.fulfilled_question_levels || {})),
  };
  if (numeric(result.exact_value)) fractions.set(result,rational);
  if (depth === 'detailed' && base.detail_index) result.detail_index = {
    unit_id:base.detail_index.unit_id, exact_value:result.exact_value,
    assessed_level:result.assessed_level, possible_upper_level:result.possible_upper_level,
    status:result.status, completion:clone(result.completion),
    unrounded_mean:result.exact_value, unrounded_upper_mean:result.exact_value,
    unit_results:units, aggregation_method:result.aggregation_method,
    scoring_method:result.scoring_method, influences_component_level:true,
  };
  return result;
}

function quickResult(base, depth, method) {
  const complete = closed(base);
  const result = {
    ...attachValues(base,depth,method,{
      exact:complete ? base.assessed_level : null,
      partial:validStage(base.assessed_level) ? base.assessed_level : null,
      total:1,completed:Number(complete),scope:base.status !== 'partial_scope',
      status:base.status === 'below_baseline' || base.status === 'needs_reconciliation' || base.status === 'not_classifiable' ? base.status : null,
    }),
    unit_results:(base.unit_results || []).map(unit=>annotateAspect(unit,depth)),
    source_detail_index:base.detail_index ?? (numeric(base.unrounded_mean) ? {unrounded_mean:base.unrounded_mean} : null),
    partial_value_semantics:'Bislang bestätigte Kategorie- oder Fähigkeitsstufe; höhere Stufen sind noch offen.',
  };
  if (complete) fractions.set(result,fraction(BigInt(base.assessed_level)));
  return result;
}

function quickPractice(base, rawCatalog, record, practiceId) {
  const units = base.unit_results.map(unit=>annotateAspect(unit,'quick'));
  const baseline = baselineConfirmed(rawCatalog,record,practiceId,base);
  const result = meanResult(base,units,'quick',{
    method:'practice_aspect_mean_with_quick_stage_thresholds',
  });
  result.baseline_complete = baseline;
  if (!baseline) {
    result.exact_value = result.unrounded_mean = result.unrounded_upper_mean = null;
    result.value_complete = false;
  }
  // A stable floored capability can satisfy a quick role threshold even when
  // its unresolved aspects do not yet determine an exact practice mean.
  result.assessed_level = base.assessed_level;
  result.possible_upper_level = base.possible_upper_level;
  result.status = base.status;
  result.stage_complete = baseline && closed(base);
  result.scoring_complete = result.value_complete && result.stage_complete;
  result.status_semantics = 'confirmed bezeichnet die stabile abgerundete Fähigkeitsstufe. Ein exakter Practice-Mittelwert benötigt zusätzlich alle abgeschlossenen Einzelaspekte.';
  result.partial_value_semantics = 'Mittel der vollständig eingestuften Aspekte; die stabile Quick-Fähigkeitsstufe kann bereits für Rollenschwellen ausreichen.';
  return result;
}

function baselineConfirmed(rawCatalog, record, practiceId, base) {
  const module = rawCatalog.assessment_modules.find(module=>module.practice_id === practiceId);
  const ids = module.criteria.find(criterion=>criterion.category_id === 'PC01').level_requirements.flatMap(stage=>stage.question_ids);
  const indexed = new Map(record.responses.map(response=>[response.question_id,response]));
  // Native practice evaluation checks the shared baseline separately even when
  // an assessor uses direct anchored ratings for the remaining criteria.
  return !['below_baseline','needs_reconciliation'].includes(base.status) && ids.every(id=>{
    const row = indexed.get(id);
    return row?.review_status === 'approved' && row.answer === 'yes';
  });
}

function detailedPractice(base, rawCatalog, record, practiceId) {
  const units = base.unit_results.map(unit=>annotateAspect(unit,'detailed'));
  const baseline = baselineConfirmed(rawCatalog,record,practiceId,base);
  const result = meanResult(base,units,'detailed',{
    scope:true,
    status:!baseline && ['below_baseline','needs_reconciliation'].includes(base.status) ? base.status : null,
  });
  result.baseline_complete = baseline;
  if (!baseline) {
    result.exact_value = result.assessed_level = result.unrounded_mean = result.unrounded_upper_mean = null;
    result.value_complete = result.stage_complete = result.scoring_complete = false;
    result.possible_upper_level = ['below_baseline','needs_reconciliation'].includes(base.status) ? null : 5;
    if (!['below_baseline','needs_reconciliation'].includes(result.status)) result.status = 'open';
  }
  return result;
}

function practicesCategory(base, practiceResults, depth) {
  const practices = Object.values(practiceResults);
  const scope = base.scope_review_complete === true && base.status !== 'partial_scope';
  const result = meanResult(base,practices,depth,{
    scope,method:PRACTICES_VALUE_AGGREGATION_METHOD,
  });
  // Keep the existing role algorithm and its requirement rows. The additional
  // mean neither weights primary practices twice nor replaces the role stage.
  const stageComplete = scope && closed(base) && (depth === 'quick' || result.value_complete);
  result.assessed_level = stageComplete ? base.assessed_level : null;
  result.possible_upper_level = stageComplete ? base.assessed_level : scope ? base.possible_upper_level : null;
  result.stage_complete = stageComplete;
  result.scoring_complete = result.value_complete && stageComplete;
  result.status = stageComplete ? 'confirmed' : !scope ? 'partial_scope' : ['confirmed','provisional'].includes(base.status) ? 'open' : base.status;
  result.scoring_method = 'practice_role_stage_with_equal_practice_mean';
  result.value_aggregation_method = PRACTICES_VALUE_AGGREGATION_METHOD;
  result.level_aggregation_method = PRACTICES_LEVEL_AGGREGATION_METHOD;
  result.category_level_source = 'practice_role_thresholds';
  result.component_level_evaluations = clone(base.component_level_evaluations || []);
  result.limiting_unit_ids = clone(base.limiting_unit_ids || []);
  result.role_stage_result = {
    assessed_level:base.assessed_level,possible_upper_level:base.possible_upper_level,status:base.status,
    aggregation_method:PRACTICES_LEVEL_AGGREGATION_METHOD,
    limiting_unit_ids:clone(base.limiting_unit_ids || []),
    scope_review_complete:base.scope_review_complete,
  };
  result.aspect_completion = {
    total:practices.reduce((sum,result)=>sum+result.completion.total,0),
    completed:practices.reduce((sum,result)=>sum+result.completion.completed,0),
  };
  return result;
}

function matchingScope(a,b) {
  return a && b && a.assessment_unit_id === b.assessment_unit_id &&
    a.context.scope_id === b.context.scope_id &&
    a.context.assessment_period.start === b.context.assessment_period.start &&
    a.context.assessment_period.end === b.context.assessment_period.end;
}

/** Evaluate a canonical assessment without mutating answers, source data or ratings.
 * catalogs may be the normalized catalogs.js result or its raw catalog map.
 */
export function evaluateModeAssessment(input, catalogs) {
  const depth = getAssessmentDepth(input), raw = catalogs?.raw ?? catalogs;
  if (!raw || typeof raw !== 'object') throw new InputError('Bewertungskataloge fehlen.');
  const records = input?.assessments ?? input;
  // The reference engine remains the single canonical input validator and the
  // source for actual question states, scope decisions and cumulative ladders.
  const source = evaluateSimplifiedAssessment({assessments:records},raw);
  const practiceResults = {};
  for (const [id,base] of Object.entries(source.practice_results)) {
    practiceResults[id] = depth === 'quick'
      ? quickPractice(base,raw.practices,records.practices,id)
      : detailedPractice(base,raw.practices,records.practices,id);
  }

  const results = {};
  for (const id of componentIds) {
    const base = source.component_results[id];
    if (!base) continue;
    if (id === 'practices') {
      results[id] = practicesCategory(base,practiceResults,depth);
      continue;
    }
    if (depth === 'quick') {
      results[id] = quickResult(base,depth,'category_requirement_level');
      continue;
    }
    const units = base.unit_results.map(unit=>annotateAspect(unit,depth));
    let scope = base.status !== 'partial_scope';
    if (id === 'continual_improvement') {
      const dependency = practiceResults.PR02;
      const compatible = Boolean(dependency?.scoring_complete && dependency.scope_review_complete === true &&
        matchingScope(records.practices,records.continual_improvement));
      scope = scope && compatible;
      results[id] = meanResult(base,units,depth,{scope});
      results[id].dependency_status = compatible ? 'compatible' : 'pending';
      results[id].dependency_source = dependency ? {
        practice_id:'PR02', assessment_depth:depth, policy_id:policyId(depth),
        exact_value:dependency.exact_value, assessed_level:dependency.assessed_level,
        scoring_complete:dependency.scoring_complete,
        scope_review_complete:dependency.scope_review_complete,
      } : null;
      // The old dependency warning described a category threshold gate. The
      // detailed policy instead requires a complete compatible PR02 detail mean.
      results[id].limitations = (base.limitations || []).filter(text=>!text.includes('Passende PR02-Selbsteinschätzung oder bestätigte Practice-Auswahl fehlt'));
      if (!compatible) results[id].limitations = unique([
        ...results[id].limitations,
        'Für den vollständigen CI-Detailwert fehlt eine vollständig eingestufte PR02-Detailbewertung im gleichen bestätigten Umfang.',
      ]);
      results[id].diagnostic_profile_results = units.map(unit=>({...unit,profile_type:'individual_detail',influences_component_level:true}));
    } else results[id] = meanResult(base,units,depth,{scope});
    // Category requirement levels remain source diagnostics, not a gate on the
    // new aspect mean. Negative initial-classification answers never enter it.
    results[id].category_requirement_result = {
      assessed_level:base.assessed_level, possible_upper_level:base.possible_upper_level,
      status:base.status, influences_exact_value:false,
    };
    results[id].category_level_source = 'complete_individual_aspect_values';
    results[id].component_level_evaluations = [];
  }

  const categoryUnits = componentIds.map(id=>results[id] ?? {unit_id:id,exact_value:null});
  const contextComplete = componentIds.every(id=>results[id]?.context_status === 'complete');
  const scopeComplete = contextComplete && componentIds.every(id=>results[id]?.scope_complete === true);
  const total = meanResult(source.svs_result,categoryUnits,depth,{
    scope:scopeComplete,
    status:contextComplete ? null : 'open',
    method:SVS_VALUE_AGGREGATION_METHOD,
  });
  total.value_aggregation_method = SVS_VALUE_AGGREGATION_METHOD;
  total.level_aggregation_method = SVS_LEVEL_AGGREGATION_METHOD;
  total.scoring_method = 'exact_component_mean_with_minimum_component_stage';
  // Exact values and stages have independent completeness. A quick stable role
  // stage can support the final SVS stage before every practice mean is known.
  total.stage_complete = scopeComplete && categoryUnits.every(unit=>unit.stage_complete === true && validStage(unit.assessed_level));
  total.stage_completion = {total:componentIds.length,completed:categoryUnits.filter(unit=>unit.stage_complete === true && validStage(unit.assessed_level)).length};
  total.scoring_complete = total.value_complete && total.stage_complete;
  if (total.stage_complete) {
    total.assessed_level = total.possible_upper_level = Math.min(...categoryUnits.map(unit=>unit.assessed_level));
    total.status = 'confirmed';
  } else {
    total.assessed_level = null;
  }
  total.context_status = contextComplete ? 'complete' : 'scope_pending';
  total.missing_component_ids = componentIds.filter(id=>!results[id]);
  total.component_profile = componentIds.filter(id=>results[id]).map(id=>({
    component_id:id, assessed_level:results[id].assessed_level,
    exact_value:results[id].exact_value, partial_exact_value:results[id].partial_exact_value,
    possible_upper_level:results[id].possible_upper_level, status:results[id].status,
    stage_complete:results[id].stage_complete,value_complete:results[id].value_complete,
    completion:clone(results[id].completion),
  }));
  total.stage_incomplete_unit_ids = categoryUnits.filter(unit=>unit.stage_complete !== true || !validStage(unit.assessed_level)).map(unit=>unit.unit_id);
  total.limiting_unit_ids = total.stage_complete
    ? categoryUnits.filter(unit=>unit.assessed_level === total.assessed_level).map(unit=>unit.unit_id)
    : [...total.stage_incomplete_unit_ids];
  total.higher_scoring_component_ids = numeric(total.exact_value)
    ? componentIds.filter(id=>results[id].exact_value > total.exact_value) : [];
  total.graphic_rule = 'Tatsächliche Kategorie-Werte darstellen. Den exakten SVS-Mittelwert aus den fünf vollständigen Kategorie-Werten und die SVS-Stufe als Minimum der fünf Kategorie-Stufen getrennt kennzeichnen. Alle Kategorien mit der niedrigsten Stufe begrenzen die SVS-Stufe, auch bei Gleichstand.';
  total.aggregation_method = 'arithmetic_mean_without_intermediate_rounding';
  const consistencyNotes = unique(Object.values(results).flatMap(result=>result.consistency_notes || []));
  total.consistency_notes = consistencyNotes;
  return {
    ...metadata(depth,total.scoring_method), catalog_version:source.catalog_version,
    value_aggregation_method:total.value_aggregation_method,
    level_aggregation_method:total.level_aggregation_method,
    component_results:results, practice_results:practiceResults, svs_result:total,
    exact_value:total.exact_value, partial_exact_value:total.partial_exact_value,
    stage_complete:total.stage_complete,value_complete:total.value_complete,
    stage_completion:clone(total.stage_completion),
    scoring_complete:total.scoring_complete, scope_complete:total.scope_complete,
    completion:clone(total.completion), consistency_notes:consistencyNotes,
  };
}

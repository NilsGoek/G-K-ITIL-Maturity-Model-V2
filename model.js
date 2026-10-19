import {allQuestions,evaluateAssessment} from './scoring.js';

export const COMPONENTS=[
{id:'guiding_principles',label:'Guiding Principles',short:'Leitprinzipien',color:'#606060'},
{id:'governance',label:'Governance',short:'Governance',color:'#601324'},
{id:'service_value_chain',label:'Service Value Chain',short:'Wertschöpfungskette',color:'#AF3147'},
{id:'practices',label:'Practices',short:'Management-Practices',color:'#951E38'},
{id:'continual_improvement',label:'Continual Improvement',short:'Kontinuierliche Verbesserung',color:'#EA4146'}];
export function reopenReviews(payload,evidenceId=null){
 let count=0;
 for(const record of Object.values(payload.assessments||{})){
 const ext=record.extensions||{};
 const affected=row=>evidenceId===null||(row.evidence_ids||[]).includes(evidenceId);
 const reopen=row=>{row.review_status='pending';if('reviewer_id' in row)row.reviewer_id=null;if('reviewed_at' in row)row.reviewed_at=null;if('evidence_status' in row)row.evidence_status='not_checked';};
 for(const response of record.responses||[])if(affected(response)||(response.check_results||[]).some(affected)){
  if(response.review_status==='approved')count++;
  reopen(response);
 }
 for(const rating of ext.criterion_ratings||[])if(affected(rating))reopen(rating);
 let scopeChanged=evidenceId===null;
 for(const key of ['scope_decisions','dependency_decisions'])for(const decision of ext[key]||[])if(affected(decision)){
  decision.reviewed=false;scopeChanged=true;
  if('scope_review_complete' in ext)ext.scope_review_complete=false;
 }
 for(const decision of [...Object.values(ext.scope_flag_decisions||{}),...(ext.criterion_applicability||[])])if(affected(decision)){
  reopen(decision);scopeChanged=true;
 }
 const coverageAffected=evidenceId===null||(ext.coverage_evidence_ids||[]).includes(evidenceId)||
  (ext.value_stream_inventory||[]).some(row=>(row.documentation_evidence_ids||[]).includes(evidenceId));
 if(coverageAffected&&'inventory_reviewed' in ext){ext.inventory_reviewed=false;scopeChanged=true;}
 if(evidenceId===null&&'scope_review_complete' in ext)ext.scope_review_complete=false;
 if(record.context){record.context.evidence_reviewed=false;if(scopeChanged)record.context.scope_reviewed=false;}
 }return count;
}
export function synchronizeEvidence(payload,register){for(const record of Object.values(payload.assessments||{}))record.evidence_register=structuredClone(register);}
export function applyContext(payload,context){
 const records=Object.values(payload.assessments||{});
 const relevant=['organization','scope_description','scope_id','services_in_scope','assessment_period'];
 const changed=records.some(record=>relevant.some(key=>JSON.stringify(record.context?.[key])!==JSON.stringify(context[key])));
 if(changed)reopenReviews(payload);
 for(const record of records){record.context=structuredClone(context);if(changed){record.context.scope_reviewed=false;record.context.evidence_reviewed=false;}}
 return changed;
}
export function chartProfile(result){return COMPONENTS.map(c=>{const r=result?.component_results?.[c.id];return {...c,level:r?.assessed_level??null,upper:r?.possible_upper_level??null,status:r?.status??'open',limiting:(result?.svs_result?.limiting_unit_ids||[]).includes(c.id)};});}
export function safeImport(data,catalogs){
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Die Datei enthält keinen gültigen Bewertungsdatensatz.');
 const state=data.project||null;const payload=structuredClone(state?.payload||data.payload||data);
 if(!payload.assessments||typeof payload.assessments!=='object'||Array.isArray(payload.assessments))throw new Error('Es fehlen die Bewertungsdatensätze unter „assessments“.');
 if(!Object.keys(payload.assessments).length)throw new Error('Die Datei enthält keine Bewertungsdatensätze.');
 let migrated=false;
 for(const [id,record] of Object.entries(payload.assessments)){
 const catalog=catalogs.raw[id];if(!catalog)throw new Error('Unbekannter Bewertungsbereich: '+id);
 if(!record||!Array.isArray(record.responses)||!Array.isArray(record.evidence_register)||!record.context||!record.extensions)throw new Error('Unvollständiger Datensatz in '+id+'.');
 if(record.catalog_id!==catalog.catalog_id)throw new Error('Der Katalog passt nicht zum Bereich '+id+'.');
 if(record.catalog_version!==catalog.catalog_version){if(String(record.catalog_version).startsWith('4.'))migrated=true;else throw new Error('Nicht unterstützte Katalogversion: '+record.catalog_version);}
 record.assessment_execution_mode='draft_preview';
 const known=new Set(allQuestions(catalog).filter(q=>q.collection_mode==='direct').map(q=>q.id));
 const ids=new Set();for(const r of record.responses){if(!r.question_id||ids.has(r.question_id))throw new Error('Fehlende oder doppelte Frage-ID in '+id+'.');ids.add(r.question_id);if(!['yes','partial','no','unknown'].includes(r.answer))throw new Error('Ungültige Antwort für '+r.question_id+'.');if(record.catalog_version===catalog.catalog_version&&!known.has(r.question_id))throw new Error('Unbekannte Frage-ID in '+id+': '+r.question_id+'.');}
 }
 const migrationArchive={};
 if(migrated){
  for(const [id,original] of Object.entries(payload.assessments)){
   const catalog=catalogs.raw[id],template=structuredClone(catalog.input_defaults.template);
   const archive={source_version:original.catalog_version,original_record:structuredClone(original),obsolete_responses:[],obsolete_checks:[],criterion_ratings:structuredClone(original.extensions.criterion_ratings||[])};
   const questions=new Map(allQuestions(catalog).filter(q=>q.collection_mode==='direct').map(q=>[q.id,q]));
   // Canonical fields are rebuilt against V5. The original record is archived
   // separately so obsolete semantics cannot enter the scoring engine.
   for(const key of Object.keys(template))if(key!=='responses'&&key!=='context'&&key!=='extensions'&&key in original)template[key]=structuredClone(original[key]);
   for(const key of Object.keys(template.context))if(key in original.context)template.context[key]=structuredClone(original.context[key]);
   template.extensions={...template.extensions,...structuredClone(original.extensions),criterion_ratings:[]};
   template.catalog_version=catalog.catalog_version;template.assessment_execution_mode='draft_preview';
   template.responses=[];
   for(const response of original.responses){
    const question=questions.get(response.question_id);
    if(!question){archive.obsolete_responses.push(structuredClone(response));continue;}
    const checks=new Set(question.checks.map(check=>check.id));
    const retainedChecks=[];
    for(const check of response.check_results||[]){
     if(!checks.has(check.check_id)){archive.obsolete_checks.push({question_id:response.question_id,...structuredClone(check)});continue;}
     retainedChecks.push({check_id:check.check_id,finding:['fulfilled','not_fulfilled','partial','open','not_applicable'].includes(check.finding)?check.finding:'open',evidence_ids:structuredClone(check.evidence_ids||[]),rationale:check.rationale||''});
    }
    template.responses.push({question_id:response.question_id,answer:response.answer,
     finding:['fulfilled','not_fulfilled','partial','open','not_applicable'].includes(response.finding)?response.finding:{yes:'fulfilled',no:'not_fulfilled',partial:'partial',unknown:'open'}[response.answer],
     review_status:'pending',evidence_status:'not_checked',evidence_ids:structuredClone(response.evidence_ids||[]),check_results:retainedChecks,
     assessor_rationale:response.assessor_rationale||'',reviewer_id:null,reviewed_at:null});
   }
   if(template.extensions.excluded_question_ids)template.extensions.excluded_question_ids=[];
   if(template.extensions.criterion_applicability)template.extensions.criterion_applicability=template.extensions.criterion_applicability.filter(row=>row.criterion_id==='GV08');
   if(id==='practices'){
    const registry=new Set(catalog.practice_registry.map(row=>row.id));
    template.extensions.scope_decisions=(template.extensions.scope_decisions||[]).filter(row=>registry.has(row.practice_id));
    template.extensions.confirmed_required_practice_ids=(template.extensions.confirmed_required_practice_ids||[]).filter(pid=>registry.has(pid));
    const custom=(template.extensions.custom_dependency_edges||[]).filter(row=>registry.has(row.from_practice_id)&&registry.has(row.to_practice_id)&&!catalog.dependency_hints.some(edge=>edge.id===row.id));
    template.extensions.custom_dependency_edges=custom;
    const edges=new Set([...catalog.dependency_hints,...custom].map(row=>row.id));
    template.extensions.dependency_decisions=(template.extensions.dependency_decisions||[]).filter(row=>edges.has(row.dependency_id));
   }
   payload.assessments[id]=template;migrationArchive[id]=archive;
  }
  reopenReviews(payload);
 }
 // Validate before replacing the user's working project. Open canonical drafts
 // are valid; unknown identifiers, malformed records and mismatched scopes are not.
 try{evaluateAssessment(payload,catalogs.raw,{mode:'simplified_self_assessment'});}catch(error){throw new Error('Import konnte nicht übernommen werden: '+error.message);}
 return {payload,state,migrated,migrationArchive};
}

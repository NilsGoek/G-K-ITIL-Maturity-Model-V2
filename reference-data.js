/** Reference values from the user-provided workbook. Source numbers stay exact.
 * This module never evaluates assessments, replaces answers or creates scores.
 */
export const REFERENCE_DATA_FILE='ITIL_Referenzwerte.json';
export const REFERENCE_COMPONENTS=Object.freeze([
  Object.freeze({id:'guiding_principles',label:'Leitprinzipien'}),
  Object.freeze({id:'governance',label:'Governance'}),
  Object.freeze({id:'service_value_chain',label:'Wertschöpfungskette'}),
  Object.freeze({id:'practices',label:'Management-Practices'}),
  Object.freeze({id:'continual_improvement',label:'Kontinuierliche Verbesserung'}),
]);
export class ReferenceDataError extends Error{constructor(message){super(message);this.name='ReferenceDataError';}}
const fail=message=>{throw new ReferenceDataError(message);};
const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const clone=value=>structuredClone(value);
const scale=value=>finite(value)&&value>=1&&value<=5;
const indexed=(items,key,label)=>{
  const map=new Map();
  for(const item of items){if(!object(item)||typeof item[key]!=='string'||!item[key]||map.has(item[key]))fail(`${label}: fehlende oder doppelte ${key}.`);map.set(item[key],item);}
  return map;
};
function validateValues(row){
  if(!scale(row.original_value))fail(`${row.id}: Der genaue Referenzwert fehlt oder liegt außerhalb der Skala 1–5.`);
  if(!Number.isInteger(row.floor_value)||!scale(row.floor_value)||row.floor_value!==Math.floor(row.original_value))fail(`${row.id}: Der abgerundete Wert passt nicht zum genauen Referenzwert.`);
  if(row.standard_deviation!=null&&(!finite(row.standard_deviation)||row.standard_deviation<0))fail(`${row.id}: Ungültige Standardabweichung.`);
  if(!object(row.source_cells)||typeof row.source_cells.label!=='string'||typeof row.source_cells.original!=='string'||typeof row.source_cells.floor!=='string')fail(`${row.id}: Die Excel-Fundstellen fehlen.`);
}
function normalizedRecord(row,source,entityType,label){
  return {...clone(row),source,sourceLabel:row.source_name,label,entityType,
    originalValue:row.original_value,floorValue:row.floor_value,
    originalKind:row.value_origin==='provided_integer_level'?'published_level':row.value_origin==='cached_workbook_formula'?'workbook_formula_value':'provided_reference_value',
    sourceCells:clone(row.source_cells),standardDeviation:row.standard_deviation??null,
    originalValueText:formatReferenceNumber(row.original_value),exactValueText:formatReferenceNumber(row.original_value,{exact:true}),
    comparisonValue:row.floor_value,comparisonEligible:true,currentModelVerified:false,
    provenanceNote:'Referenzwert aus der bereitgestellten Excel-Datei; keine Neuberechnung mit den Fragen dieses Tools.',
    comparisonReason:'Genauer und abgerundeter Referenzwert aus der bereitgestellten Datei.'};
}
/** Pure normalization; IDs map source rows to the existing canonical registry. */
export function normalizeReferenceData(raw,practiceRegistry){
  if(!object(raw)||raw.schema_version!=='2.0.0'||!object(raw.source))fail('Nicht unterstütztes Format der Excel-Referenzwerte.');
  const registry=Array.isArray(practiceRegistry)?practiceRegistry:practiceRegistry?.raw?.practices?.practice_registry??practiceRegistry?.practice_registry;
  if(!Array.isArray(registry)||registry.length!==34)fail('Das vollständige kanonische Verzeichnis mit 34 Practices fehlt.');
  const canonical=indexed(registry,'id','Practice-Verzeichnis');
  for(const key of ['practice_rows','component_rows','overall_rows'])if(!Array.isArray(raw[key]))fail(`Referenzwerte: ${key} muss eine Liste sein.`);
  if(raw.practice_rows.length!==34||raw.component_rows.length!==5||raw.overall_rows.length!==3)fail('Die Datei muss 34 Practices, fünf SVS-Komponenten und drei Gesamtbeispiele enthalten.');
  indexed([...raw.practice_rows,...raw.component_rows,...raw.overall_rows],'id','Referenzzeilen');
  const practiceRows=indexed(raw.practice_rows,'practice_id','Practice-Referenzwerte');
  if([...canonical.keys()].some(id=>!practiceRows.has(id))||[...practiceRows.keys()].some(id=>!canonical.has(id)))fail('Die Practice-Referenzen sind nicht vollständig den kanonischen IDs zugeordnet.');
  const componentRows=indexed(raw.component_rows,'component_id','Komponenten-Referenzwerte');
  if(REFERENCE_COMPONENTS.some(component=>!componentRows.has(component.id))||[...componentRows.keys()].some(id=>!REFERENCE_COMPONENTS.some(component=>component.id===id)))fail('Die fünf Komponenten-Referenzen sind nicht vollständig oder enthalten fremde IDs.');
  indexed(raw.overall_rows,'organization','SVS-Gesamtbeispiele');
  for(const row of [...raw.practice_rows,...raw.component_rows,...raw.overall_rows])validateValues(row);
  const original=clone(raw),source=original.source;
  const practiceRecords=original.practice_rows.map(row=>({...normalizedRecord(row,source,'practice',canonical.get(row.practice_id).name_de),practiceId:row.practice_id,mappingStatus:row.mapping_status,mappingNote:row.mapping_note??null}));
  const componentRecords=original.component_rows.map(row=>({...normalizedRecord(row,source,'component',REFERENCE_COMPONENTS.find(component=>component.id===row.component_id).label),componentId:row.component_id,sourceFormula:row.source_formula??null,valueOrigin:row.value_origin}));
  const overallRecords=original.overall_rows.map(row=>{
    if(!Number.isInteger(row.published_level)||row.published_level!==row.original_value||row.published_level!==row.floor_value||row.original_absolute_mean!==null)fail(`${row.id}: Ein veröffentlichter Gesamtlevel darf nicht als Dezimalmittel ausgegeben werden.`);
    return {...normalizedRecord(row,source,'svs',row.organization),organization:row.organization,publishedLevel:row.published_level,originalMean:null};
  });
  return {raw:original,title:original.title,source,sources:[source],practiceRecords,componentRecords,overallRecords,
    summary:{practiceCount:34,componentCount:5,overallCount:3,mappedPracticeCount:practiceRecords.length,referenceRowCount:42},
    provenance:source.provenance_note,sourceFile:source.file_name};
}
export async function loadReferenceData(practiceRegistry,{url=new URL('./data/'+REFERENCE_DATA_FILE,import.meta.url)}={}){
  const response=await fetch(url);
  if(!response.ok)fail(`Die Excel-Referenzwerte konnten nicht geladen werden (${response.status}).`);
  return normalizeReferenceData(await response.json(),practiceRegistry);
}
export function getComparisonRows(data,{entityType,entityId=null}={}){
  const rows=entityType==='practice'?data.practiceRecords:entityType==='component'?data.componentRecords:entityType==='svs'?data.overallRecords:[];
  return rows.filter(row=>row.comparisonEligible&&(entityId===null||(entityType==='svs'?entityId==='svs':(entityType==='practice'?row.practiceId:row.componentId)===entityId)));
}
export function getCaseReference(data,id){return data.overallRecords.find(row=>row.id===id||row.organization===id)??null;}
export function formatReferenceNumber(value,{exact=false,maximumFractionDigits=12}={}){
  if(value===null||value===undefined)return 'Nicht veröffentlicht';
  if(!finite(value))fail('Nur vorhandene endliche Referenzzahlen können formatiert werden.');
  if(exact)return String(value).replace('.',',');
  return new Intl.NumberFormat('de-DE',{maximumFractionDigits,useGrouping:false}).format(value);
}

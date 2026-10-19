import { formatReferenceNumber } from './reference-data.js';
import { selectedPracticeIds } from './catalogs.js';

const COMPONENTS = [
  {id:'guiding_principles',label:'Guiding Principles'}, {id:'governance',label:'Governance'},
  {id:'service_value_chain',label:'Service Value Chain'}, {id:'practices',label:'Practices'},
  {id:'continual_improvement',label:'Continual Improvement'},
];
const esc = value => String(value ?? '').replace(/[&<>"']/g,character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const number = value => formatReferenceNumber(value,{exact:true});
const exactNumber = value => new Intl.NumberFormat('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:false}).format(value);
const ownLabels = {confirmed:'Stufe bestimmt',provisional:'Vorläufige Untergrenze',open:'Noch offen',partial_scope:'Teilumfang',below_baseline:'Unter Ausgangsstufe',needs_reconciliation:'Klärung erforderlich',not_classifiable:'Noch nicht einstufbar'};
const practiceId = row => row?.practiceId || row?.practice_id || row?.id;

export function safeReferenceUrl(value) {
  try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

export function displayReferenceOriginal(row) {
  if (!row) return 'Keine Referenz vorhanden';
  if (numeric(row.original_range_lower) && numeric(row.original_range_upper)) return `${exactNumber(row.original_range_lower)}–${exactNumber(row.original_range_upper)}`;
  const value = row.originalValue ?? row.absoluteValue ?? row.original_numeric_value ?? row.original_mean;
  return numeric(value) ? exactNumber(value) : 'Keine Referenz vorhanden';
}

export function displayReferenceFloor(row) {
  if (!row) return '—';
  if (numeric(row.floor_range_lower) && numeric(row.floor_range_upper)) return `${number(row.floor_range_lower)}–${number(row.floor_range_upper)}`;
  const value = row.floorValue ?? row.floor_value ?? row.floor_of_original_mean;
  return numeric(value) ? number(value) : '—';
}

export function ownReferenceValue(unit) {
  const status = unit?.stage_complete === true ? 'confirmed' : unit?.status || 'open';
  const valid = numeric(unit?.assessed_level) && (unit.stage_complete === true || status === 'provisional' || (!Object.hasOwn(unit,'stage_complete') && status === 'confirmed'));
  return {value:valid ? unit.assessed_level : null,
    text:valid ? `${status === 'provisional' ? 'Mindestens ' : ''}${number(unit.assessed_level)}` : ownLabels[status] || 'Noch offen',status};
}

/** The project scope is authoritative; existing result rows never select a Practice. */
export function referencePracticeGroups({data,catalogs,project}) {
  const records = data?.practiceRecords || [];
  const registry = Array.isArray(catalogs?.practices) ? catalogs.practices : records.map(row => ({id:practiceId(row),name_de:row.labelGerman || row.label}));
  const included = new Set(selectedPracticeIds(project?.payload || {}));
  const seen = new Set();
  const entries = registry.filter(practice => practiceId(practice) && !seen.has(practiceId(practice)) && seen.add(practiceId(practice))).map(practice => {
    const id = practiceId(practice);
    const reference = records.find(row => practiceId(row) === id) || null;
    return {id,label:practice.name_de || practice.labelGerman || reference?.labelGerman || reference?.label || practice.label || id,reference};
  });
  return {selected:entries.filter(row => included.has(row.id)),remaining:entries.filter(row => !included.has(row.id))};
}

function originalCell(row,{fractionDigits = null} = {}) {
  const value = fractionDigits != null && numeric(row?.originalValue)
    ? new Intl.NumberFormat('de-DE',{minimumFractionDigits:fractionDigits,maximumFractionDigits:fractionDigits,useGrouping:false}).format(row.originalValue)
    : displayReferenceOriginal(row);
  const locator = row?.sourceCells?.original;
  return `<td data-reference-original${locator ? ` title="Excel: ${esc(locator)}"` : ''}><span class="reference-value${value === 'Keine Referenz vorhanden' ? ' reference-value--unknown' : ''}">${esc(value)}</span></td>`;
}

function floorCell(row) {
  return `<td class="reference-floor" data-reference-floor>${esc(displayReferenceFloor(row))}</td>`;
}

function ownLevelCell(unit) {
  const own = ownReferenceValue(unit);
  return `<td class="reference-own-level" data-own-level data-own-status="${esc(own.status)}"><strong class="reference-own-value">${esc(own.text)}</strong>${own.value != null ? `<small>${esc(ownLabels[own.status])}</small>` : ''}</td>`;
}

function ownRawCell(unit) {
  const own = ownReferenceValue(unit);
  const candidate = unit && Object.hasOwn(unit,'exact_value') ? unit.exact_value : unit?.unrounded_mean;
  const raw = numeric(candidate) && (Object.hasOwn(unit,'exact_value') || own.value != null) ? candidate : null;
  const formatted = raw != null ? exactNumber(raw) : null;
  return `<td class="reference-own-raw" data-own-original data-own-status="${esc(own.status)}">${formatted != null ? `<strong>${own.status === 'provisional' ? 'Mindestens ' : ''}${esc(formatted)}</strong>` : '—<small>Noch offen</small>'}</td>`;
}

function table(headers,rows,{className = '',attributes = '',caption} = {}) {
  return `<div class="reference-table-scroll"><table class="reference-table ${className}"${attributes}><caption class="reference-visually-hidden">${esc(caption)}</caption><thead><tr>${headers.map(label => `<th scope="col">${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function overallHtml({data,result,project}) {
  const rows = (data.overallRecords || []).map(row => {
    const level = row.publishedLevel ?? row.floorValue;
    return `<tr data-reference-id="${esc(row.id)}" data-reference-overall="${esc(row.id)}"><th scope="row">${esc(row.organization || row.labelGerman || row.label || row.name || row.id)}</th><td class="reference-floor" data-reference-floor data-reference-level>${numeric(level) ? esc(number(level)) : '—'}</td>${ownRawCell(result?.svs_result)}${ownLevelCell(result?.svs_result)}</tr>`;
  });
  return `<section class="reference-section" data-reference-section="overall" aria-labelledby="reference-overall-title"><h3 id="reference-overall-title">Service Value System</h3>${table(['Referenz','SVS-Level','Eigener SVS-Gesamtwert',`Finale eigene SVS-Stufe${project?.name ? ` · ${project.name}` : ''}`],rows,{className:'reference-overall-table',caption:'Drei SVS-Gesamtreferenzen im Vergleich zur eigenen SVS-Stufe'})}</section>`;
}

function componentsHtml({data,result}) {
  const rows = COMPONENTS.map(component => {
    const row = (data.componentRecords || []).find(row => row.componentId === component.id);
    const own = result?.component_results?.[component.id];
    return `<tr data-reference-id="${esc(row?.id || component.id)}" data-reference-component="${component.id}" data-own-component="${component.id}"><th scope="row">${component.label}</th>${originalCell(row,{fractionDigits:2})}${floorCell(row)}${ownRawCell(own)}${ownLevelCell(own)}</tr>`;
  });
  return `<section class="reference-section" data-reference-section="components" aria-labelledby="reference-components-title"><h3 id="reference-components-title">Kategorien des Service Value Systems</h3>${table(['Kategorie','Mittelwert Referenz','Referenzstufe','Eigener Exakter Wert','Eigene Kategorie-Stufe'],rows,{className:'reference-component-table',caption:'Kategorien des Service Value Systems im Vergleich zur eigenen Kategorie-Stufe'})}</section>`;
}

function practiceTable(entries,result,{selected = false} = {}) {
  const rows = entries.map(entry => `<tr data-reference-id="${esc(entry.reference?.id || entry.id)}" data-reference-practice="${esc(entry.id)}"><th scope="row">${esc(entry.label)}<small>${esc(entry.id)}</small></th>${originalCell(entry.reference)}${floorCell(entry.reference)}${selected ? `${ownRawCell(result?.practice_results?.[entry.id])}${ownLevelCell(result?.practice_results?.[entry.id])}` : ''}</tr>`);
  const group = selected ? 'selected' : 'remaining';
  return table(['Practice','Mittelwert Referenz','Referenzstufe',...(selected ? ['Eigener Exakter Wert','Eigene Stufe'] : [])],rows,{className:'reference-practice-table',attributes:` data-reference-practice-group="${group}"`,caption:selected ? 'Im Projekt einbezogene Practices im Vergleich zu Referenzwerten' : 'Weitere Practices mit Referenzwerten'});
}

function practicesHtml(options) {
  const {selected,remaining} = referencePracticeGroups(options);
  return `<section class="reference-section" data-reference-section="selected-practices" aria-labelledby="reference-practices-title"><h3 id="reference-practices-title">Einbezogene Practices <span class="reference-count">${selected.length}</span></h3>${selected.length ? practiceTable(selected,options.result,{selected:true}) : '<p class="reference-empty" data-reference-empty-selection>Im Projekt sind noch keine Practices einbezogen. Die Referenzwerte aller Practices stehen unten.</p>'}${remaining.length ? `<details class="reference-remaining" data-reference-remaining-practices><summary>Weitere ${remaining.length} Practices mit Referenzwerten</summary>${practiceTable(remaining,null)}</details>` : ''}</section>`;
}

/** Pure read-only projection of reference data, actual scope decisions and evaluated results. */
export function referenceViewHtml(options) {
  if (!options?.data) return '<div class="reference-view"><p class="reference-empty">Referenzdaten werden geladen …</p></div>';
  return `<div class="reference-view"><div class="reference-view-head"><h2>Referenzvergleich</h2><p class="muted">Referenzwerte und Stufen im Vergleich zur eigenen Bewertung. Der eigene SVS-Gesamtwert ist der Durchschnitt; die finale SVS-Stufe entspricht der niedrigsten Kategorie-Stufe.</p></div>${overallHtml(options)}${componentsHtml(options)}${practicesHtml(options)}</div>`;
}

/** The native disclosure changes only its DOM state; project data and storage remain untouched. */
export function renderReferenceView(host,options) {
  host.innerHTML = referenceViewHtml(options);
}

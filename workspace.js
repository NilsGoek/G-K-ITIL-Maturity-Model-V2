/** Lossless browser workspace backups and reversible project removal. */
import {getAssessmentDepth} from './assessment-modes.js';
export const WORKSPACE_BACKUP_FORMAT = 'goek-svs-workspace-backup';
export const WORKSPACE_BACKUP_VERSION = 1;

const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const clone = value => structuredClone(value);
const defaultId = () => globalThis.crypto?.randomUUID?.() || `project-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const nowValue = options => typeof options.now === 'function' ? options.now() : options.now || new Date().toISOString();
const identifier = value => typeof value === 'string' && Boolean(value.trim());
const stable = value => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const identical = (left, right) => stable(left) === stable(right);

function uniqueId(used, options = {}) {
  const createId = options.createId || defaultId;
  for (let attempt = 0; attempt < 32; attempt++) {
    const candidate = createId();
    if (identifier(candidate) && !used.has(candidate)) { used.add(candidate); return candidate; }
  }
  const prefix = defaultId();
  let candidate = prefix, suffix = 1;
  while (used.has(candidate)) candidate = `${prefix}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

function validateProject(project) {
  if (!object(project) || !identifier(project.id)) throw new Error('Ein Projekt benötigt eine eindeutige Projekt-ID.');
  if (typeof project.name !== 'string') throw new Error(`Projekt ${project.id}: Der Projektname muss Text sein.`);
  if (!object(project.payload) || !object(project.payload.assessments) || !Object.keys(project.payload.assessments).length) {
    throw new Error(`Projekt ${project.id}: Bewertungsdaten unter „payload.assessments“ fehlen.`);
  }
  getAssessmentDepth(project.payload);
  for (const key of ['tasks', 'actions', 'snapshots']) {
    if (project[key] != null && !Array.isArray(project[key])) throw new Error(`Projekt ${project.id}: ${key} muss eine Liste sein.`);
  }
  for (const key of ['ui', 'details', 'migrationArchive']) {
    if (project[key] != null && !object(project[key])) throw new Error(`Projekt ${project.id}: ${key} muss ein Objekt sein.`);
  }
  return project;
}

function validateWorkspace(workspace) {
  if (!object(workspace) || !Array.isArray(workspace.projects)) throw new Error('Der Arbeitsstand benötigt eine Projektliste.');
  if (workspace.deletedProjects != null && !Array.isArray(workspace.deletedProjects)) throw new Error('Der Papierkorb muss eine Liste sein.');
  const projectIds = new Set();
  for (const project of workspace.projects) {
    validateProject(project);
    if (projectIds.has(project.id)) throw new Error(`Doppelte Projekt-ID im Arbeitsstand: ${project.id}.`);
    projectIds.add(project.id);
  }
  const trashIds = new Set();
  for (const row of workspace.deletedProjects || []) {
    if (!object(row) || !identifier(row.trashId)) throw new Error('Ein Papierkorbeintrag benötigt eine eindeutige ID.');
    validateProject(row.project);
    if (trashIds.has(row.trashId)) throw new Error(`Doppelte Papierkorb-ID: ${row.trashId}.`);
    trashIds.add(row.trashId);
  }
  if (workspace.activeId != null && !identifier(workspace.activeId)) throw new Error('Die aktive Projekt-ID muss Text sein.');
  return workspace;
}

function normalizeProject(source, options = {}) {
  if (!object(source)) throw new Error('Die Datei enthält einen ungültigen Projekteintrag.');
  let project = clone(source);
  if (project.id == null) project.id = (options.createId || defaultId)();
  if (project.name == null) {
    project.name = Object.values(project.payload?.assessments || {})[0]?.context?.organization || 'Importierte Bewertung';
  }
  validateProject(project);
  if (options.normalizeProject) {
    const normalized = options.normalizeProject(clone(project));
    if (normalized && typeof normalized.then === 'function') throw new Error('Die Projektprüfung muss synchron erfolgen.');
    if (normalized != null) project = normalized;
    validateProject(project);
  }
  return clone(project);
}

/** Accepts old single-project exports, raw assessment files, and full backups. */
export function parseWorkspaceImport(data, options = {}) {
  if (!object(data)) throw new Error('Die Datei enthält keinen gültigen Arbeitsstand.');
  let source;
  if (data.format === WORKSPACE_BACKUP_FORMAT) {
    if (data.format_version != null && data.format_version !== WORKSPACE_BACKUP_VERSION) throw new Error('Diese Sicherungsversion wird noch nicht unterstützt.');
    source = data.workspace;
  } else if (object(data.workspace) && Array.isArray(data.workspace.projects)) source = data.workspace;
  else if (Array.isArray(data.projects)) source = data;
  else if (object(data.project)) source = { projects: [data.project], activeId: data.project.id ?? null };
  else if (object(data.payload?.assessments)) source = { projects: [{ ...clone(data), payload: clone(data.payload) }], activeId: data.id ?? null };
  else if (object(data.assessments)) source = { projects: [{ payload: clone(data) }], activeId: null };
  else throw new Error('Es fehlen Projekte oder Bewertungsdaten in der Sicherung.');
  if (!object(source) || !Array.isArray(source.projects)) throw new Error('Die Sicherung enthält keine gültige Projektliste.');
  if (source.deletedProjects != null && !Array.isArray(source.deletedProjects)) throw new Error('Der Papierkorb in der Sicherung muss eine Liste sein.');
  const workspace = clone(source);
  workspace.projects = source.projects.map(project => normalizeProject(project, options));
  workspace.deletedProjects = (source.deletedProjects || []).map(row => {
    if (!object(row)) throw new Error('Ungültiger Papierkorbeintrag in der Sicherung.');
    return { ...clone(row), trashId: row.trashId ?? (options.createId || defaultId)(),
      deletedAt: row.deletedAt ?? nowValue(options), project: normalizeProject(row.project, options) };
  });
  workspace.activeId = workspace.projects.some(project => project.id === source.activeId)
    ? source.activeId : workspace.projects[0]?.id || null;
  validateWorkspace(workspace);
  return workspace;
}

/** Includes active projects and complete recoverable deleted project records. */
export function createWorkspaceBackup(workspace, options = {}) {
  validateWorkspace(workspace);
  return { format: WORKSPACE_BACKUP_FORMAT, format_version: WORKSPACE_BACKUP_VERSION,
    exported_at: nowValue(options), workspace: clone({ ...workspace, deletedProjects: workspace.deletedProjects || [] }) };
}

/** Pure merge: identical IDs skip; differing IDs import as copies, never overwrite. */
export function mergeWorkspace(current, incoming, options = {}) {
  validateWorkspace(current);
  validateWorkspace(incoming);
  const workspace = { ...clone(incoming), ...clone(current), projects: clone(current.projects), deletedProjects: clone(current.deletedProjects || []) };
  const used = new Set([...workspace.projects, ...incoming.projects].map(project => project.id));
  const idMap = new Map();
  const addedProjectIds = [], skippedProjectIds = [], clonedProjectIds = [], collisions = [];
  for (const source of incoming.projects) {
    const existing = workspace.projects.find(project => project.id === source.id);
    if (existing && identical(existing, source)) { skippedProjectIds.push(source.id); idMap.set(source.id, source.id); continue; }
    const project = clone(source);
    if (existing) {
      project.id = uniqueId(used, options);
      clonedProjectIds.push(project.id);
      collisions.push({ sourceId: source.id, projectId: project.id });
    } else used.add(project.id);
    idMap.set(source.id, project.id);
    workspace.projects.push(project);
    addedProjectIds.push(project.id);
  }
  const trashUsed = new Set([...workspace.deletedProjects, ...(incoming.deletedProjects || [])].map(row => row.trashId));
  const addedTrashIds = [], skippedTrashIds = [];
  for (const source of incoming.deletedProjects || []) {
    const existing = workspace.deletedProjects.find(row => row.trashId === source.trashId);
    if (existing && identical(existing, source)) { skippedTrashIds.push(source.trashId); continue; }
    const row = clone(source);
    if (existing) row.trashId = uniqueId(trashUsed, options); else trashUsed.add(row.trashId);
    workspace.deletedProjects.push(row);
    addedTrashIds.push(row.trashId);
  }
  const incomingActive = idMap.get(incoming.activeId);
  workspace.activeId = options.activateImported && incomingActive ? incomingActive
    : workspace.projects.some(project => project.id === current.activeId) ? current.activeId
    : incomingActive || workspace.projects[0]?.id || null;
  validateWorkspace(workspace);
  return { workspace, addedProjectIds, skippedProjectIds, clonedProjectIds, collisions, addedTrashIds, skippedTrashIds };
}

/** Mutates only the supplied workspace after validation; the whole project is retained. */
export function moveToTrash(workspace, projectId, options = {}) {
  validateWorkspace(workspace);
  const index = workspace.projects.findIndex(project => project.id === projectId);
  if (index < 0) throw new Error('Dieses Projekt ist nicht mehr im Arbeitsstand vorhanden.');
  const project = clone(workspace.projects[index]);
  const used = new Set((workspace.deletedProjects || []).map(row => row.trashId));
  const row = { trashId: uniqueId(used, options), deletedAt: nowValue(options), project };
  workspace.deletedProjects ||= [];
  workspace.deletedProjects.push(row);
  workspace.projects.splice(index, 1);
  if (workspace.activeId === projectId || !workspace.projects.some(project => project.id === workspace.activeId)) workspace.activeId = workspace.projects[0]?.id || null;
  return { trashId: row.trashId, project: clone(project), activeId: workspace.activeId };
}

/** Restores a project as a new copy if its former ID is already in use. */
export function restoreFromTrash(workspace, trashId, options = {}) {
  validateWorkspace(workspace);
  const index = (workspace.deletedProjects || []).findIndex(row => row.trashId === trashId);
  if (index < 0) throw new Error('Dieser Papierkorbeintrag ist nicht mehr vorhanden.');
  const project = clone(workspace.deletedProjects[index].project);
  const sourceId = project.id;
  const used = new Set(workspace.projects.map(project => project.id));
  const cloned = used.has(project.id);
  if (cloned) project.id = uniqueId(used, options);
  workspace.projects.push(project);
  workspace.deletedProjects.splice(index, 1);
  workspace.activeId = project.id;
  return { project, cloned, sourceId };
}

export const ARCHIVE_TASKS = Object.freeze({
  recordEvidence: "Record verified implementation acceptance and merge evidence for archive preparation.",
  stageArchive: "Stage and verify delta synchronization and the archive move in an OpenSpec-only candidate.",
});
export const SHA = /^[a-f0-9]{40}$/;
export const CHANGE = /^(?=.{1,100}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TASK_ID = /^[1-9]\d*\.[1-9]\d*$/;
const MAX_TEXT = 256 * 1024;

export function archiveFailure(code, detail = "") {
  const error = new Error(code);
  error.archiveCode = code;
  // Security: callers supply only validated identifiers, never API exception bodies.
  error.archiveDetail = detail;
  return error;
}

function requireValue(condition, code) {
  if (!condition) throw archiveFailure(code);
}

function object(value, required, optional = []) {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value), "metadata-object");
  requireValue(required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key)), "metadata-fields");
}

function boundedText(value, limit = MAX_TEXT) {
  requireValue(typeof value === "string" && Buffer.byteLength(value) <= limit, "metadata-size");
}

export function metadataBlock(text, label) {
  boundedText(text);
  requireValue(["openspec-implementation", "openspec-acceptance", "openspec-archive", "openspec-acceptance-request", "openspec-acceptance-receipt", "openspec-delivery"].includes(label), "metadata-label");
  const blocks = [];
  let fence = null;
  let lines = [];
  for (const line of text.replaceAll("\r\n", "\n").split("\n")) {
    const opening = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(line);
    if (fence) {
      if (new RegExp(`^ {0,3}${fence.character}{${fence.length},}\\s*$`).test(line)) {
        if (fence.label === label) blocks.push(lines.join("\n"));
        fence = null;
      } else if (fence.label === label) lines.push(line);
    } else if (opening) {
      fence = { character: opening[1][0], length: opening[1].length, label: opening[2].trim() };
      lines = [];
    }
  }
  requireValue(fence?.label !== label, "metadata-unclosed");
  requireValue(blocks.length <= 1, "metadata-duplicate");
  if (!blocks.length) return null;
  return strictJson(blocks[0]);
}

/** Parse bounded JSON without silently accepting duplicate (including escaped) keys. */
export function strictJson(text, limit = 16 * 1024) {
  boundedText(text, limit);
  let value;
  try { value = JSON.parse(text); }
  catch { throw archiveFailure("metadata-json"); }
  const tokens = [...text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/g)].map(match => match[0]);
  const scopes = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "{" || token === "[") scopes.push(new Set());
    else if (token === "}" || token === "]") scopes.pop();
    else if (token.startsWith('"') && tokens[index + 1] === ":") {
      const key = JSON.parse(token);
      requireValue(!scopes.at(-1)?.has(key), "metadata-duplicate-key");
      scopes.at(-1)?.add(key);
    }
  }
  return value;
}

export function parseImplementation(text) {
  const value = metadataBlock(text, "openspec-implementation");
  if (value === null) return null;
  object(value, ["version", "change"], ["specificationPr", "archivePreparationTasks", "archive", "acceptanceManifest", "finalizedHead"]);
  requireValue([1, 2, 3].includes(value.version) && typeof value.change === "string" && CHANGE.test(value.change), "implementation-identity");
  if (value.version === 1) requireValue(Number.isSafeInteger(value.specificationPr) && value.specificationPr > 0, "specification-pr");
  else requireValue(!Object.hasOwn(value, "specificationPr"), "metadata-fields");
  if (value.version === 3) {
    requireValue(!Object.hasOwn(value, "archivePreparationTasks"), "metadata-fields");
    const finalized = Object.hasOwn(value, "archive") || Object.hasOwn(value, "acceptanceManifest") || Object.hasOwn(value, "finalizedHead");
    if (finalized) {
      requireValue(typeof value.archive === "string" && typeof value.acceptanceManifest === "string", "delivery-paths");
      requireValue(value.finalizedHead === undefined || typeof value.finalizedHead === "string" && SHA.test(value.finalizedHead), "delivery-head");
      assertRepositoryPath(value.archive.slice(0, -1));
      assertRepositoryPath(value.acceptanceManifest);
      const escaped = value.change.replaceAll("-", "\\-");
      requireValue(new RegExp(`^openspec/changes/archive/\\d{4}-\\d{2}-\\d{2}-${escaped}/$`).test(value.archive)
        && value.acceptanceManifest === `${value.archive}acceptance.md`, "delivery-paths");
    }
  } else {
    requireValue(!Object.hasOwn(value, "archive") && !Object.hasOwn(value, "acceptanceManifest")
      && !Object.hasOwn(value, "finalizedHead"), "metadata-fields");
    if (value.archivePreparationTasks !== undefined) {
      object(value.archivePreparationTasks, [], Object.keys(ARCHIVE_TASKS));
      const ids = Object.values(value.archivePreparationTasks);
      requireValue(ids.every(id => typeof id === "string" && TASK_ID.test(id)) && new Set(ids).size === ids.length, "archive-task-map");
    }
  }
  return value;
}

export function assertRepositoryPath(value) {
  requireValue(typeof value === "string" && value.length > 0 && value.length < 512
    && !/[\\\x00-\x1f\x7f:%]/.test(value)
    && value.split("/").every(part => part && part !== "." && part !== ".." && !part.endsWith(".") && !part.endsWith(" ")),
  "unsafe-path");
  return value;
}

export function inspectTasks(text, mapping = {}, { allowIncomplete = false } = {}) {
  boundedText(text);
  object(mapping, [], Object.keys(ARCHIVE_TASKS));
  const tasks = [];
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  let fence = null;
  let previous = null;
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (new RegExp(`^ {0,3}${fence.character}{${fence.length},}\\s*$`).test(line)) fence = null;
    } else if (marker) fence = { character: marker[0], length: marker.length };
    if (/^\s*[-*+]\s+\[/.test(line)) {
      requireValue(!fence, "task-in-fence");
      const match = /^- \[([ xX])\] ([1-9]\d*\.[1-9]\d*) (\S.*)$/.exec(line);
      requireValue(Boolean(match), "task-format");
      previous = { id: match[2], done: match[1] !== " ", text: match[3] };
      tasks.push(previous);
    } else if (line.trim() && !/^## /.test(line) && previous && Object.values(mapping).includes(previous.id)) {
      throw archiveFailure("task-designation-continuation");
    } else if (/^## /.test(line)) previous = null;
  }
  requireValue(tasks.length > 0 && new Set(tasks.map(task => task.id)).size === tasks.length, "task-identities");
  const allowed = new Set();
  for (const [kind, id] of Object.entries(mapping)) {
    const task = tasks.find(item => item.id === id);
    requireValue(task?.text === ARCHIVE_TASKS[kind] && !allowed.has(id), "task-designation");
    allowed.add(id);
  }
  const blocked = tasks.filter(task => !task.done && !allowed.has(task.id));
  if (blocked.length && !allowIncomplete) throw archiveFailure("tasks-incomplete", blocked.map(task => task.id).join(","));
  return tasks;
}

export function archivePaths(change, date, capabilities) {
  requireValue(CHANGE.test(change) && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && new Date(date).toISOString().slice(0, 10) === date, "archive-target");
  requireValue(Array.isArray(capabilities) && capabilities.every(value => typeof value === "string"
    && value.split("/").every(part => CHANGE.test(part))), "capability-path");
  const target = /^\d{4}-\d{2}-\d{2}-/.test(change) ? change : `${date}-${change}`;
  return {
    active: `openspec/changes/${change}/`, archive: `openspec/changes/archive/${target}/`,
    specs: capabilities.map(value => `openspec/specs/${value}/spec.md`),
    branch: `docs/archive-${change}`,
  };
}

/**
 * Whether a change retires a capability: its metadata declares `retire_capabilities: true` and its delta for the
 * capability only removes requirements. Archiving such a change deletes the capability's canonical spec.
 */
export function retiredCapability(metadataText, deltaText) {
  if (typeof metadataText !== "string" || typeof deltaText !== "string") return false;
  if (!/^retire_capabilities:[ \t]*true[ \t]*\r?$/m.test(metadataText)) return false;
  const sections = [...deltaText.matchAll(/^##[ \t]+(ADDED|MODIFIED|REMOVED|RENAMED)[ \t]+Requirements[ \t]*\r?$/gm)].map(match => match[1]);
  return sections.length > 0 && sections.every(section => section === "REMOVED");
}

export function assertArchiveDiff(files, paths) {
  requireValue(Array.isArray(files) && files.length > 0 && files.length <= 1000, "archive-diff");
  for (const file of files) {
    for (const value of [file.filename, ...(file.status === "renamed" ? [file.previous_filename] : [])]) {
      assertRepositoryPath(value);
      requireValue(value.startsWith(paths.active) || value.startsWith(paths.archive) || paths.specs.includes(value), "archive-diff-scope");
    }
  }
}

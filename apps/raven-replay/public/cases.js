// Saved-case page controller. Authored by Claude. Renders text only (textContent / Text nodes). Every request goes to
// the local wrapper, which re-checks everything; imported files are read as text, sent as data and never executed.
import { MAX_BATCH, MAX_TX_FILE_BYTES, describeCase, describeReport, describeFailure,
  addCase, runRequest, runProblem, detailedAvailability, caseFileName, caseFileText, caseKind, createRequest,
  parseAdapterList, importProblem, caseFileSizeProblem, reportFileName } from '/cases-view.mjs';

const $ = id => document.getElementById(id);
const TONES = ['MATCH', 'REGRESSION', 'INVALID_CASE', 'RUN_ERROR'];
let cases = [];          // { case, digest, source, reference, selected } — held in this tab only
let adapters = [];       // [{ id, label }] registered SDK adapters, as listed by the local server
let lastReport = null;
let working = false;

class Failure extends Error { constructor(title, detail) { super(detail); this.title = title; } }

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);   // strings become Text nodes, never markup
  return node;
}
const fact = (term, ...value) => el('div', {}, el('dt', { text: term }), el('dd', {}, ...value));

function setStatus(id, state, title, detail = '') {
  $(id).className = 'status ' + state;
  $(id).replaceChildren(el('strong', { text: title }), detail);
}
const clearStatus = id => { $(id).className = 'status'; $(id).replaceChildren(); };

async function api(action, route, body) {
  let response, data = null;
  try { response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { const f = describeFailure(action, 0, null); throw new Failure(f.title, f.detail); }
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok || data === null) {
    const f = describeFailure(action, response.status, data, response.headers.get('Retry-After'));
    throw new Failure(f.title, f.detail);
  }
  return data;
}

async function perform(statusId, fn) {
  if (working) return;
  working = true;
  document.body.setAttribute('aria-busy', 'true');
  for (const control of document.querySelectorAll('button, input[type=file], select, input[type=checkbox]')) control.disabled = true;
  try { await fn(); }
  catch (error) {
    if (error instanceof Failure) setStatus(statusId, 'error', error.title, error.message);
    else setStatus(statusId, 'error', 'Unexpected page error', 'Nothing was changed. ' + String(error?.message ?? error));
  } finally {
    working = false;
    document.body.removeAttribute('aria-busy');
    for (const control of document.querySelectorAll('button, input[type=file], select, input[type=checkbox]')) control.disabled = false;
    updateSelection();
  }
}

// ---------- 00 registered SDK adapters (GET /cases/adapters) ----------
// Only an id and a label are kept. If the local server has no adapter list, the page offers the legacy inspector alone.
async function loadAdapters() {
  let body = null;
  try {
    const response = await fetch('/cases/adapters');
    if (response.ok) body = await response.json();
  } catch { body = null; }
  const parsed = parseAdapterList(body);
  adapters = parsed.adapters;
  $('tool-sdk').replaceChildren(...adapters.map(a => el('option', { value: a.id, text: a.label + ' (' + a.id + ')' })));
  $('tool-sdk').disabled = adapters.length === 0;
  $('tool-note').textContent = parsed.problem ?? (adapters.length
    ? 'The bundled legacy inspector is the default. This local server also registers ' + adapters.length +
      (adapters.length === 1 ? ' SDK adapter' : ' SDK adapters') + '; entries labelled “Control” produce deliberate refusals or errors.'
    : 'This local server registers no SDK adapters, so only the bundled legacy inspector is offered.');
}
loadAdapters();

function add(entry) {
  try { cases = addCase(cases, { ...entry, reference: '', selected: false }); }
  catch (error) { throw new Failure('Not added', error.message); }
  renderCases();
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  el('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- 01 create ----------
$('create-form').addEventListener('submit', event => {
  event.preventDefault();
  perform('create-status', async () => {
    const name = $('case-name').value;
    const adapterId = $('case-tool').value;
    if (cases.some(e => e.case.name === name))
      throw new Failure('Not added', 'A case named "' + name + '" is already loaded. Choose another name or remove that case first. No case was created.');
    if (adapterId && !adapters.some(a => a.id === adapterId))
      throw new Failure('Not created', 'That SDK adapter is not in the list this local server registers. No case was created.');
    setStatus('create-status', 'working', adapterId ? 'Running SDK adapter ' + adapterId + ' once to record the expected result…'
      : 'Running the pinned tool once to record the expected execution…');
    const data = await api('create', '/cases/create', createRequest({ name, tx: $('case-tx').value, adapterId }));
    add({ case: data.case, digest: data.case_content_sha256, source: 'created' });
    setStatus('create-status', 'ok', 'Created case "' + data.case.name + '".', 'Content digest ' + data.case_content_sha256 +
      '. Keep this digest somewhere other than this browser if you want to detect a replaced case later.');
  });
});
$('create-sample').addEventListener('click', () => perform('create-status', async () => {
  const response = await fetch('/sample');
  if (!response.ok) throw new Failure('Example not loaded', 'The local server did not return the synthetic example.');
  $('case-tx').value = (await response.text()).trim();
  if (!$('case-name').value) $('case-name').value = 'synthetic-legacy-example';
  $('create-note').textContent = 'Synthetic Raven legacy fixture loaded. Not a live chain observation.';
  clearStatus('create-status');
}));
$('case-tx').addEventListener('input', () => { $('create-note').textContent = 'User-supplied bytes; origin not independently established.'; });
$('create-file').addEventListener('change', event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  perform('create-status', async () => {
    if (file.size > MAX_TX_FILE_BYTES) throw new Failure('Too large', 'Base64 files are at most ' + MAX_TX_FILE_BYTES + ' bytes. Nothing was loaded.');
    $('case-tx').value = (await file.text()).trim();
    $('create-note').textContent = 'Loaded from your file; origin not independently established.';
    clearStatus('create-status');
  });
});

// ---------- 02 import ----------
async function importText(text, origin) {
  setStatus('import-status', 'working', 'Checking the case with the local server…');
  const data = await api('import', '/cases/import', { case_text: text });
  add({ case: data.case, digest: data.case_content_sha256, source: 'imported' });
  setStatus('import-status', 'ok', 'Imported case "' + data.case.name + '" from ' + origin + '.', 'Content digest ' + data.case_content_sha256 +
    '. Compare it with a digest you kept elsewhere, or paste that digest as the reference before rerunning.');
}
$('import-file').addEventListener('change', event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  perform('import-status', async () => {
    if (!/\.json$/i.test(file.name)) throw new Failure('Not a case file', 'Only .json case files can be imported. Nothing was imported.');
    const tooLarge = caseFileSizeProblem(file.size);
    if (tooLarge) throw new Failure('Too large', tooLarge);
    const text = await file.text();
    const problem = importProblem(text);
    if (problem) throw new Failure(/at most/.test(problem) ? 'Too large' : 'Nothing to import', problem);
    await importText(text, 'file "' + file.name + '"');
  });
});
$('import-paste').addEventListener('click', () => perform('import-status', async () => {
  const text = $('import-text').value;
  const problem = importProblem(text);
  if (problem) throw new Failure(/at most/.test(problem) ? 'Too large' : 'Nothing to import', problem);
  await importText(text, 'pasted JSON');
}));

// ---------- 03 cases ----------
function updateSelection() {
  const selected = cases.filter(e => e.selected);
  const count = selected.length;
  const sdk = selected.filter(e => caseKind(e.case) === 'sdk').length;
  const mix = sdk > 0 && sdk < count ? ' (' + (count - sdk) + ' legacy, ' + sdk + ' SDK: mixed batches are refused)' : '';
  $('selection-count').textContent = count + ' selected' + mix + ' · at most ' + MAX_BATCH + ' per run';
  $('run-selected').disabled = working || count === 0;
  const detail = detailedAvailability(selected);
  if (!detail.available) $('run-detailed').checked = false;
  $('run-detailed').disabled = working || !detail.available;
  $('detailed-note').textContent = detail.available
    ? 'Off unless you tick it. Applies to the next “Rerun selected” only.' : detail.reason;
}

function renderCases() {
  $('cases-empty').hidden = cases.length > 0;
  $('case-list').replaceChildren(...cases.map((entry, index) => {
    const view = describeCase(entry);
    const id = 'case-' + index;
    const select = el('input', { type: 'checkbox', id: id + '-select' });
    select.checked = entry.selected;
    select.addEventListener('change', () => { entry.selected = select.checked; updateSelection(); });
    const reference = el('input', { id: id + '-reference', spellcheck: 'false', autocomplete: 'off',
      placeholder: '64-character lowercase digest you kept elsewhere' });
    reference.value = entry.reference;
    reference.addEventListener('input', () => { entry.reference = reference.value; });
    const rerun = el('button', { type: 'button', text: 'Rerun this case' });
    rerun.addEventListener('click', () => rerunEntries([entry]));
    const exportCase = el('button', { type: 'button', text: 'Export case' });
    exportCase.addEventListener('click', () => download(caseFileName(entry.case.name), caseFileText(entry.case)));
    const remove = el('button', { type: 'button', text: 'Remove' });
    remove.addEventListener('click', () => { cases = cases.filter(e => e !== entry); renderCases(); });
    const facts = view.kind === 'sdk'
      ? [fact('Adapter', el('code', { text: view.adapterId })),
        fact('Saved adapter decision', view.savedDecision + ' · version ' + String(view.savedVersion) + ' · reason text kept in the case file'),
        fact('Content digest (computed now)', el('code', { text: view.digest }))]
      : [fact('Saved parser decision', view.savedDecision + ' · ' + view.savedReason),
        fact('Content digest (computed now)', el('code', { text: view.digest }))];
    return el('li', { class: 'case kind-' + view.kind },
      el('div', { class: 'case-head' }, el('label', { for: select.id }, select, el('span', { text: view.name })),
        el('span', { class: 'chip kind-chip', text: view.kindLabel }), el('span', { class: 'chip', text: view.source })),
      el('dl', {}, ...facts),
      el('label', { for: reference.id, text: 'Separately retained reference (optional)' }), reference,
      el('div', { class: 'actions' }, rerun, exportCase, remove));
  }));
  updateSelection();
}
$('run-selected').addEventListener('click', () => rerunEntries(cases.filter(e => e.selected), { detailed: $('run-detailed').checked }));

// ---------- 04 results ----------
// Detailed output is sent only when the user ticked the opt-in for this run; the tick resets whatever happens.
function rerunEntries(entries, { detailed = false } = {}) {
  perform('run-status', async () => {
    try {
      const problem = runProblem(entries, { detailed });
      if (problem) throw new Failure('Nothing was run', problem);
      const sdk = caseKind(entries[0].case) === 'sdk';
      setStatus('run-status', 'working', 'Rerunning ' + entries.length + (entries.length === 1 ? ' case' : ' cases') +
        (sdk ? ' with ' + (entries.length === 1 ? 'its' : 'their') + ' pinned SDK adapter' + (detailed ? ', detailed output requested' : '') : ' with the pinned tool') + '…');
      lastReport = await api('run', '/cases/run', runRequest(entries, { detailed }));
      const view = describeReport(lastReport);
      renderReport(view);
      setStatus('run-status', view.exitCode === 0 ? 'ok' : 'attention', 'Run finished: batch exit code ' + view.exitCode + '.', view.exitMeaning + ' Details are under “Expected versus actual”.');
    } finally { $('run-detailed').checked = false; }
  });
}

function renderResult(r) {
  const tone = TONES.includes(r.outcome.code) ? r.outcome.code : 'UNKNOWN';
  const facts = [
    fact('Comparison outcome', el('span', { class: 'badge', text: r.outcome.label + ' · ' + r.outcome.code + ' · exit ' + r.outcome.exitCode }), r.outcome.detail),
    fact('Separately retained reference', r.reference.text),
    fact('Tool execution', r.execution),
    fact('Case content digest', el('code', { text: r.digest })),
  ];
  if (r.error) facts.push(fact('Error', el('span', { class: 'error-text', text: r.error })));
  if (r.detailedLabel) facts.push(fact('Detailed export', el('span', { class: 'detailed-text', text: r.detailedLabel })));
  const rows = r.parser.rows.map(row => el('tr', row.changed ? { class: 'changed' } : {},
    el('th', { scope: 'row', text: row.field }), el('td', { text: row.expected }), el('td', { text: row.actual })));
  const table = el('div', { class: 'table-wrap' }, el('table', { class: 'parser' }, el('caption', { text: r.parser.note }),
    el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: r.parser.fieldHeader }), el('th', { scope: 'col', text: 'Expected (saved)' }),
      el('th', { scope: 'col', text: 'Actual (this run)' }))), el('tbody', {}, ...rows)));
  const changed = r.changedFields.length
    ? el('ul', { class: 'changed-fields' }, ...r.changedFields.map(f => el('li', {}, el('code', { text: f.field }), ' — expected sha256 ',
        el('code', { title: f.expectedFull, text: f.expected }), ', actual sha256 ', el('code', { title: f.actualFull, text: f.actual }))))
    : el('p', { class: 'help', text: r.outcome.code === 'MATCH' ? 'No changed fields.' : 'No field comparison was made.' });
  const extra = [];
  if (r.changedNote) extra.push(el('p', { class: 'help', text: r.changedNote }));
  if (r.detailedPayload) extra.push(el('details', { class: 'detailed-payload' },
    el('summary', { text: 'Detailed parsed payload (opt-in; may contain reconstructible bytes)' }), el('pre', { text: r.detailedPayload })));
  return el('article', { class: 'result tone-' + tone }, el('h3', { text: r.name }), el('dl', {}, ...facts), table,
    el('h4', { text: 'Changed fields' }), changed, ...extra);
}

function renderReport(view) {
  $('results-empty').hidden = true;
  $('report').hidden = false;
  $('report-kind').textContent = view.kindLabel;
  $('report-detailed').hidden = !view.detailed;
  $('report-detailed').textContent = view.detailedWarning ?? '';
  $('report-summary').textContent = 'Batch exit code ' + view.exitCode + ' — ' + view.exitMeaning;
  $('report-counts').replaceChildren(...view.counts.map(c => el('li', { text: c.label + ' (' + c.code + '): ' + c.count })));
  $('results').replaceChildren(...view.results.map(renderResult));
  $('report-limits').replaceChildren(...view.limits.map(line => el('li', { text: line })));
  $('export-report').textContent = view.detailed ? 'Export report JSON (detailed, opt-in)' : 'Export report JSON';
  $('report-summary').focus();
}
$('export-report').addEventListener('click', () => { if (lastReport) download(reportFileName(lastReport), JSON.stringify(lastReport, null, 2) + '\n'); });

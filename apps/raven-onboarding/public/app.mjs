import { createRunState, decodeInput } from './state.mjs';

const $ = id => document.getElementById(id);
const state = createRunState();
let step = 'compare', worker = null, timer = null, setup = null, examples = {};
const copy = {
  compare: {
    title: 'Compare interpretations', type: 'Unsigned comparison report', action: 'Run comparison',
    description: 'Give the same bytes to three pinned Kit readers. See exactly where their decisions differ.',
    transition: 'This check uses the bytes below. It does not check signatures, safety or whether a transaction landed.',
  },
  conformance: {
    title: 'Test against a profile', type: 'Unsigned conformance report', action: 'Run profile check',
    description: 'Run the existing Conformance engine against a named, finite corpus and inspect each mismatch.',
    transition: 'Different evidence: this check switches to the retained 30-vector corpus. It does not reuse your comparison bytes.',
  },
  receipt: {
    title: 'Check a receipt before deciding', type: 'Signed retained receipt · unsigned exchange record', action: 'Check receipt',
    description: 'Raven checks receipt facts. Agent A then applies its existing policy to those facts.',
    transition: 'Different evidence: this check uses the retained BONK receipt fixture. Your comparison or Conformance report is not converted into a receipt.',
  },
};

function clear(message = 'Selection changed. Run again for a current result.') {
  state.invalidate(); worker?.terminate(); worker = null; clearTimeout(timer);
  $('result').hidden = true; $('download').disabled = true;
  $('facts').replaceChildren(); $('raw').textContent = '';
  $('run').disabled = step === 'conformance' && !setup;
  $('cancel').hidden = true; $('status').textContent = message;
}

function selectStep(next) {
  step = next;
  for (const button of document.querySelectorAll('[data-step]')) {
    if (button.dataset.step === step) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
  for (const name of Object.keys(copy)) $(`${name}-fields`).hidden = name !== step;
  $('step-title').textContent = copy[step].title;
  $('evidence-type').textContent = copy[step].type;
  $('step-description').textContent = copy[step].description;
  $('transition').textContent = copy[step].transition;
  $('run').textContent = copy[step].action;
  clear('Ready. Choose an example and run the check.');
}

function table(headings, rows) {
  const wrap = document.createElement('div'); wrap.className = 'table-wrap';
  const node = document.createElement('table');
  const head = node.createTHead().insertRow();
  for (const title of headings) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = title; head.append(th); }
  const body = node.createTBody();
  for (const values of rows) {
    const row = body.insertRow();
    for (const value of values) {
      const cell = row.insertCell(); cell.textContent = String(value ?? '—');
      if (['ACCEPT', 'REJECT'].includes(value)) cell.className = `decision ${value.toLowerCase()}`;
    }
  }
  wrap.append(node); return wrap;
}

function present(ticket, data, summary, facts, filename) {
  if (!state.current(ticket)) return;
  // Construct everything before accepting an exportable result. Rendering errors clear it.
  const raw = JSON.stringify(data, null, 2);
  $('facts').replaceChildren(...facts);
  for (const key of ['checked', 'found', 'unchecked', 'reproduce']) $(key).textContent = summary[key];
  $('result-title').textContent = summary.title;
  $('raw').textContent = raw;
  if (!state.accept(ticket, { data, filename })) return;
  $('download').textContent = step === 'receipt' ? 'Save exchange record' : 'Save unsigned report';
  $('download').disabled = false; $('result').hidden = false;
  $('next').hidden = step === 'receipt';
  $('next').textContent = step === 'compare' ? 'Next: test a profile with a different corpus →' : 'Next: check a different, retained receipt →';
  $('status').textContent = 'Check finished. Inspect the result and its limits below.';
}

async function compare(ticket) {
  const bytes = decodeInput($('bytes').value, $('encoding').value);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (!state.current(ticket)) return;
  const results = await new Promise((resolve, reject) => {
    worker = new Worker('/kit/_decoder-worker.js');
    timer = setTimeout(() => { worker?.terminate(); reject(Error('Comparison exceeded 8 seconds. No current report.')); }, 8000);
    worker.onerror = () => reject(Error('A Kit reader could not load or run. No current report.'));
    ticket.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    worker.onmessage = event => resolve(event.data);
    worker.postMessage(bytes.buffer);
  });
  if (!state.current(ticket)) return;
  worker?.terminate(); worker = null; clearTimeout(timer);
  if (!Array.isArray(results) || results.length !== 3 || results.some((r, i) => r.library !== '@solana/kit' || r.version !== ['3.0.3', '4.0.0', '8.3.0'][i] || !['ACCEPT', 'REJECT'].includes(r.decision))) throw Error('Reader output was incomplete. No current report.');
  const report = { schema: 'raven-browser-kit-comparison/v1', observedAt: new Date().toISOString(), inputHex: Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''), inputSha256: hash, byteLength: bytes.length, api: ['getTransactionDecoder().decode(bytes)', 'getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)'], scope: 'Local parse comparison only; unsigned; synthetic examples or user-supplied bytes; no signature or safety validation', results };
  const distinct = new Set(results.map(r => JSON.stringify([r.decision, r.decodedVersion]))).size;
  present(ticket, report, {
    title: distinct > 1 ? 'The readers disagree.' : 'The readers agree on decision and version.',
    checked: `${bytes.length} bytes using Kit 3.0.3, 4.0.0 and 8.3.0. Each adapter calls both decoders.`,
    found: results.map(r => `Kit ${r.version}: ${r.decision}${r.decision === 'ACCEPT' ? ` (${r.decodedVersion})` : ''}`).join('; '),
    unchecked: 'Signatures, signer trust, blockchain execution and safety. Version-3 admission differs because of a known upstream-fixed check; this is not a new vulnerability claim.',
    reproduce: `Input SHA-256: ${hash}. Save the exact bytes, API composition and raw reader errors below; rerun them in the existing Kit comparison.`,
  }, [table(['Reader', 'Decision', 'Decoded version', 'Details'], results.map(r => [`Kit ${r.version}`, r.decision, r.decodedVersion, r.decision === 'REJECT' ? `Could not decode. Raw error${r.code == null ? '' : ` #${r.code}`}: ${r.detail}` : r.detail]))], 'raven-kit-comparison.json');
}

async function request(ticket, endpoint, body) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ticket.signal });
  const data = await response.json();
  if (!response.ok) throw Error(data.message || data.error || 'The check could not finish.');
  return data;
}

async function conform(ticket) {
  const data = await request(ticket, '/api/conformance', { target: $('target').value });
  if (!state.current(ticket)) return;
  const { report, display } = data;
  if (!report?.summary || !Array.isArray(display?.results) || !display.counts) throw Error('Incomplete Conformance output. No current report.');
  const differences = display.results.filter(r => r.display.kind !== 'PASS');
  const facts = [];
  if (display.presentation_banner) { const p = document.createElement('p'); p.textContent = display.presentation_banner; facts.push(p); }
  const rows = items => items.map(r => [r.vector_id, r.display.label, r.expected?.decision, r.observed?.decision, r.display.plainLanguage]);
  if (differences.length) facts.push(table(['Vector', 'Status', 'Expected', 'Observed', 'Meaning'], rows(differences)));
  const all = document.createElement('details');
  const label = document.createElement('summary'); label.textContent = `Inspect all ${display.results.length} vector results`;
  all.append(label, table(['Vector', 'Status', 'Expected', 'Observed', 'Meaning'], rows(display.results))); facts.push(all);
  present(ticket, report, {
    title: `Engine result: ${report.summary.overall}`,
    checked: `${report.target.id} against ${report.claimed_profile.name}; ${display.results.length} retained vectors.`,
    found: `${display.counts.pass} matched; ${display.counts.behavioral_divergence} behavioral differences; ${display.results.length - display.counts.pass - display.counts.behavioral_divergence} other results. These are engine observations, not a security score.`,
    unchecked: 'Full Solana correctness, real chain execution, signatures and safety. Proposed v1 (SIMD-0385) is experimental. Execution errors and skipped vectors are not passes.',
    reproduce: `Profile and corpus identities are in the report. From this clone: npm --prefix apps/raven-conformance run conform -- --profile ${report.claimed_profile.name} --target ${report.target.id}`,
  }, facts, 'raven-conformance-report.json');
}

async function receipt(ticket) {
  const data = await request(ticket, '/api/receipt', { path: $('receipt-path').value });
  if (!state.current(ticket)) return;
  const a = data.agentA;
  if (!a || !['PROCEED', 'REFUSE'].includes(a.decision) || typeof a.reason !== 'string') throw Error('Incomplete agent response. No policy result was produced.');
  const axes = a.axes || {};
  const disclosure = a.disclosure || {};
  present(ticket, data, {
    title: `Agent A: ${a.decision}`,
    checked: 'The existing pinned verifier checks a retained BONK receipt and subject binding. Agent A applies its unchanged policy to the verifier response.',
    found: `Raven state: ${a.ravenState}. Agent A decision: ${a.decision}. Reason: ${a.reason}.`,
    unchecked: 'Fresh blockchain state, actual agent identity or a real transaction. liveAcquisition:false; the disclosed fixture evaluation clock is not current freshness. PROCEED is a policy decision, not permission to transact.',
    reproduce: `Selected path: ${data.path}. Save the unsigned exchange record, including the disclosed evidence source and verification axes. Existing terminal journey: npm run demo`,
  }, [table(['Verification fact', 'Returned value'], [['Receipt integrity (valid)', axes.valid], ['Configured signer trust (keyTrusted)', axes.keyTrusted], ['Stale at fixture clock', axes.stale], ['Subject matches', axes.subjectMatches], ['Policy reason', a.reason], ['Evidence source', disclosure.evidenceSource?.mode ?? 'See exact exchange'], ['Live acquisition', disclosure.liveAcquisition ?? false], ['Evaluation time', disclosure.evaluationTime ?? 'No receipt evaluation supplied'], ['Evaluation time kind', disclosure.evaluationTimeKind ?? 'See exact exchange'], ['Receipt identity', a.evidenceIdentity?.receiptId ?? 'No receipt identity supplied']])], 'raven-agent-exchange.json');
}

$('check-form').addEventListener('submit', async event => {
  event.preventDefault(); clear('Running the existing check…');
  const ticket = state.start(); $('run').disabled = true; $('cancel').hidden = false;
  try {
    await ({ compare, conformance: conform, receipt })[step](ticket);
  } catch (error) {
    if (state.current(ticket)) clear(`Check did not finish: ${error.message} No current result or download.`);
  } finally {
    if (state.current(ticket)) { worker?.terminate(); worker = null; clearTimeout(timer); $('run').disabled = false; $('cancel').hidden = true; }
  }
});
$('cancel').addEventListener('click', () => clear('Check cancelled. No current result or download.'));
document.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => selectStep(button.dataset.step)));
for (const id of ['bytes', 'encoding', 'target', 'receipt-path']) $(id).addEventListener(id === 'bytes' ? 'input' : 'change', () => clear());
$('example').addEventListener('change', () => { $('bytes').value = examples[$('example').value]; $('encoding').value = 'hex'; clear(); });
$('next').addEventListener('click', () => { selectStep(step === 'compare' ? 'conformance' : 'receipt'); $('workspace').focus(); });
$('download').addEventListener('click', () => {
  if (!state.result) return;
  const { data, filename } = state.result;
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

selectStep('compare');
Promise.all([
  fetch('/kit/decoder-cases.json').then(r => { if (!r.ok) throw Error('Examples could not load.'); return r.json(); }),
  fetch('/api/setup').then(r => { if (!r.ok) throw Error('Profile identities could not load.'); return r.json(); }),
]).then(([cases, metadata]) => {
  examples = cases; setup = metadata;
  for (const name of Object.keys(examples)) { const o = document.createElement('option'); o.value = name; o.textContent = name.replaceAll('_', ' '); $('example').append(o); }
  const initial = Object.keys(examples).find(k => k.startsWith('E_'));
  $('example').value = initial; $('bytes').value = examples[initial]; $('example').disabled = false;
  for (const target of setup.targets) { const o = document.createElement('option'); o.value = target.id; o.textContent = target.name; $('target').append(o); }
  $('target').value = 'SOL_BROKEN_SUBTLE'; $('target').disabled = false;
  $('profile-detail').textContent = `${setup.profile.id} · ${setup.corpus.count} vectors · profile SHA-256 ${setup.profile.sha256}`;
  clear('Ready. Results are calculated when you run; none are pre-filled.');
}).catch(error => clear(`${error.message} You can still enter public bytes for comparison.`));

/**
 * DCB-2 S1 regression tests (author-written; independence comes from separate review).
 *
 * D2-1 (CODEX): an installed optional-only dependency changed while replay still returned MATCH,
 *               because the guard permitted all of node_modules while the binding inventoried only
 *               the declared-dependency traversal. Now: optional/peer packages that are installed are
 *               part of the closure (inventoried), and the guard permits exactly the closure.
 * D2-2 (CODEX): NODE_OPTIONS preload broke for package paths containing spaces.
 *
 * Scratch SDK copies (src/adapters/fixtures/package.json, no node_modules) are placed under an
 * "anc" directory so ancestor node_modules can be planted above them. The tests never touch the
 * live node_modules except T10, which only reads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { POLICY, POLICY_SHA, resolveExecutionIdentity } from '../src/runner.mjs';
import { CHILD_RUNTIME_FILES, resolvePackageClosure, permittedExecutionRoots } from '../src/binding.mjs';
import { packageRoot } from '../src/registry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const OLD_POLICY_SHA_V1 = '868a5ee8110e6d7dbb2fbef3a5af439459190669fe1145ea5ab564ac8d150896'; // raven-replay-adapter-offline/1 (measured)

function scratchSdk({ spaces = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), spaces ? 'dcb2 sp ' : 'dcb2-'));
  const anc = path.join(base, 'anc');
  const sdk = path.join(anc, spaces ? 'sdk with spaces' : 'sdk');
  for (const d of ['src', 'adapters', 'fixtures']) fs.cpSync(path.join(root, d), path.join(sdk, d), { recursive: true });
  fs.copyFileSync(path.join(root, 'package.json'), path.join(sdk, 'package.json'));
  const marker = path.join(base, 'marker.txt');
  const readMarker = () => (fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : null);
  const pkg = (where, name, extra, code) => {
    const d = path.join(where, 'node_modules', ...name.split('/'));
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.cjs', ...extra }));
    fs.writeFileSync(path.join(d, 'index.cjs'), code);
  };
  const markerCode = (tag, rest = 'module.exports={};') => `require('node:fs').appendFileSync(${JSON.stringify(marker)},${JSON.stringify(tag + '\n')});${rest}`;
  const adapter = (id, body, deps = []) => {
    fs.writeFileSync(path.join(sdk, 'adapters', id + '.mjs'), body + `\nprocess.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({decision:'ACCEPT',version:'legacy',reason:'fx',decoded:{v:typeof v==='undefined'?null:v}})));\n`);
    const rp = path.join(sdk, 'adapters', 'registry.json');
    const reg = JSON.parse(fs.readFileSync(rp, 'utf8'));
    reg.adapters.push({ id, label: id, entrypoint: id + '.mjs', output_contract: 'fixture/1', dependency_packages: deps });
    fs.writeFileSync(rp, JSON.stringify(reg));
  };
  const cli = (args) => spawnSync(node, [path.join(sdk, 'src', 'cli.mjs'), ...args], { encoding: 'utf8', cwd: sdk });
  const fixture = path.join(sdk, 'fixtures', 'legacy-transaction.base64');
  const input = fs.readFileSync(fixture, 'utf8').trim();
  const runner = () => import(pathToFileURL(path.join(sdk, 'src', 'runner.mjs')).href);
  return { base, anc, sdk, marker, readMarker, pkg, markerCode, adapter, cli, fixture, input, runner };
}

// ---------- D2-1 ----------
test('D2-1 regression (CODEX control): installed optional-only dependency is inventoried; its mutation is refused before execution', async () => {
  const s = scratchSdk();
  s.pkg(s.sdk, 'review-root', { optionalDependencies: { 'review-leaf': '1.0.0' } }, "const v=require('review-leaf').v;module.exports={v};");
  s.pkg(s.sdk, 'review-leaf', {}, s.markerCode('ONE', 'module.exports={v:"ONE"};'));
  s.adapter('review', "import r from 'review-root';const v=r.v;", ['review-root']);
  const casePath = path.join(s.base, 'case.json');
  const created = s.cli(['create', '--adapter', 'review', '--name', 'review', s.fixture, casePath]);
  assert.equal(created.status, 0, created.stdout);
  const digest = JSON.parse(created.stdout).case_content_sha256;
  const { resolveExecutionIdentity: id } = await s.runner();
  const before = id('review');
  assert.deepEqual(before.closure_packages, ['review-leaf', 'review-root'], 'installed optional-only dependency must be in the closure');
  assert.ok(before.permitted_execution_roots.dirs.some((d) => d.endsWith(path.join('node_modules', 'review-leaf'))));
  // mutate only the optional leaf
  s.pkg(s.sdk, 'review-leaf', {}, s.markerCode('TWO', 'module.exports={v:"TWO"};'));
  const after = id('review');
  assert.notEqual(after.dependency_binding_sha256, before.dependency_binding_sha256, 'binding must change when the optional leaf changes');
  const rerun = s.cli(['rerun', '--expect-sha256', digest, casePath]);
  assert.equal(rerun.status, 3, rerun.stdout);
  const body = JSON.parse(rerun.stdout);
  assert.equal(body.results[0].status, 'RUN_ERROR');
  assert.match(body.results[0].error, /Dependency installed-file inventory differs/);
  assert.equal(body.results[0].execution, 'NOT_RUN');
  assert.equal(s.readMarker(), 'ONE\n', 'the mutated leaf (TWO) must never have executed');
});

test('D2-1: absent optional dependency is skipped at create; its later appearance is refused before execution (not silently accepted)', async () => {
  const s = scratchSdk();
  s.pkg(s.sdk, 'review-root', { optionalDependencies: { 'review-leaf': '1.0.0' } }, "let v='fallback';try{v=require('review-leaf').v}catch{}module.exports={v};");
  s.adapter('review', "import r from 'review-root';const v=r.v;", ['review-root']);
  const casePath = path.join(s.base, 'case.json');
  const created = s.cli(['create', '--adapter', 'review', '--name', 'review', s.fixture, casePath]);
  assert.equal(created.status, 0, created.stdout);
  const c = JSON.parse(fs.readFileSync(casePath, 'utf8'));
  assert.equal(c.expected_execution.parsed.decoded.v, 'fallback');
  const { resolveExecutionIdentity: id } = await s.runner();
  assert.deepEqual(id('review').closure_packages, ['review-root']);
  // the optional dependency appears later: closure grows, binding differs, replay refused before execution
  s.pkg(s.sdk, 'review-leaf', {}, s.markerCode('LATE', 'module.exports={v:"LATE"};'));
  assert.deepEqual(id('review').closure_packages, ['review-leaf', 'review-root']);
  const rerun = s.cli(['rerun', casePath]);
  assert.equal(rerun.status, 3, rerun.stdout);
  assert.match(JSON.parse(rerun.stdout).results[0].error, /Dependency installed-file inventory differs/);
  assert.equal(s.readMarker(), null, 'the late optional dependency must not have executed');
});

test('D2-1: optional-only dependency that resolves only from an ANCESTOR node_modules is refused at load (CLOSURE_ESCAPE)', async () => {
  const s = scratchSdk();
  s.pkg(s.sdk, 'review-root', { optionalDependencies: { 'review-leaf': '1.0.0' } }, "let v='fallback';try{v=require('review-leaf').v}catch{}module.exports={v};");
  s.pkg(s.anc, 'review-leaf', {}, s.markerCode('ANCESTOR', 'module.exports={v:"ANCESTOR"};'));
  s.adapter('review', "import r from 'review-root';const v=r.v;", ['review-root']);
  const { executeAdapter } = await s.runner();
  const r = executeAdapter('review', s.input);
  assert.equal(r.execution.complete, false);
  assert.equal(r.execution.error_code, 'CLOSURE_ESCAPE');
  const diag = Buffer.from(r.execution.stderr_base64, 'base64').toString('utf8');
  assert.match(diag, /"closure_guard":"REFUSED"/);
  assert.match(diag, /"reason":"outside_permitted_closure"/);
  assert.match(diag, /"specifier":"review-leaf"/);
  assert.equal(s.readMarker(), null, 'ancestor module must not execute');
  const created = s.cli(['create', '--adapter', 'review', '--name', 'review', s.fixture, path.join(s.base, 'c.json')]);
  assert.equal(created.status, 3, created.stdout);
});

test('D2-1: permitted == inventoried — a hoisted package that is NOT in the closure is refused; declaring it admits and binds it', async () => {
  const s = scratchSdk();
  s.pkg(s.sdk, 'phantom-pkg', {}, s.markerCode('PHANTOM', 'module.exports={v:"PHANTOM"};'));
  s.pkg(s.sdk, 'review-root', {}, 'module.exports={v:"root"};');
  s.adapter('review', "import p from 'phantom-pkg';const v=p.v;", ['review-root']);
  const { executeAdapter, resolveExecutionIdentity: id } = await s.runner();
  assert.deepEqual(id('review').closure_packages, ['review-root']);
  const refused = executeAdapter('review', s.input);
  assert.equal(refused.execution.error_code, 'CLOSURE_ESCAPE');
  assert.match(Buffer.from(refused.execution.stderr_base64, 'base64').toString('utf8'), /"specifier":"phantom-pkg"/);
  assert.equal(s.readMarker(), null);
  // positive control: declare it as a dependency of review-root → closure, inventoried, permitted
  s.pkg(s.sdk, 'review-root', { dependencies: { 'phantom-pkg': '1.0.0' } }, 'module.exports={v:"root"};');
  assert.deepEqual(id('review').closure_packages, ['phantom-pkg', 'review-root']);
  const ok = executeAdapter('review', s.input);
  assert.equal(ok.execution.complete, true, Buffer.from(ok.execution.stderr_base64, 'base64').toString('utf8'));
  assert.equal(ok.execution.parsed.decoded.v, 'PHANTOM');
  assert.equal(s.readMarker(), 'PHANTOM\n');
});

test('closure rule: required peer absent → refuse; optional peer absent → skipped; optional peer present → included and bound', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcb2-peer-'));
  const pkg = (name, extra) => { const d = path.join(tmp, 'node_modules', name); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...extra })); };
  pkg('root', { peerDependencies: { needed: '1.0.0' } });
  assert.throws(() => resolvePackageClosure(tmp, ['root']), /Missing declared transitive peer dependency: needed/);
  pkg('root', { peerDependencies: { maybe: '1.0.0' }, peerDependenciesMeta: { maybe: { optional: true } } });
  assert.deepEqual(resolvePackageClosure(tmp, ['root']), ['root']);
  pkg('maybe', {});
  assert.deepEqual(resolvePackageClosure(tmp, ['root']), ['maybe', 'root']);
  const roots = permittedExecutionRoots(tmp, ['maybe', 'root']);
  assert.deepEqual(roots.dirs, [path.join(tmp, 'node_modules', 'maybe'), path.join(tmp, 'node_modules', 'root')]);
  assert.equal(roots.files.length, CHILD_RUNTIME_FILES.length);
});

// ---------- D2-2 ----------
test('D2-2 regression (CODEX control): SDK installed at a path containing spaces can create and rerun', () => {
  const s = scratchSdk({ spaces: true });
  assert.ok(/\s/.test(s.sdk), 'scratch path must contain whitespace: ' + s.sdk);
  const casePath = path.join(s.base, 'my case.json');
  const created = s.cli(['create', '--adapter', 'example-parser-v1', '--name', 'spaces', s.fixture, casePath]);
  assert.equal(created.status, 0, created.stdout);
  const rerun = s.cli(['rerun', casePath]);
  assert.equal(rerun.status, 0, rerun.stdout);
  assert.equal(JSON.parse(rerun.stdout).results[0].status, 'MATCH');
});

// ---------- guard provenance and fail-closed ----------
test('exit 126 by the adapter itself is EXIT_126_RESERVED, not CLOSURE_ESCAPE; both RUN_ERROR', async () => {
  const s = scratchSdk();
  s.adapter('selfexit', 'process.exit(126);');
  const { executeAdapter } = await s.runner();
  const r = executeAdapter('selfexit', s.input);
  assert.equal(r.execution.complete, false);
  assert.equal(r.execution.error_code, 'EXIT_126_RESERVED');
  assert.equal(r.execution.exit_code, null);
});

test('guard without RAVEN_CLOSURE_ROOTS fails closed: only builtins load', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcb2-fc-'));
  fs.writeFileSync(path.join(dir, 'x.js'), 'module.exports=1;');
  const guard = path.join(root, 'src', 'closure-guard.cjs');
  const env = { PATH: '', NODE_OPTIONS: '--require "' + guard + '"' };
  const ok = spawnSync(node, ['-e', "require('node:fs');console.log('builtin ok')"], { encoding: 'utf8', env, cwd: dir });
  assert.equal(ok.status, 0, ok.stderr);
  const refused = spawnSync(node, ['-e', "require('./x.js')"], { encoding: 'utf8', env, cwd: dir });
  assert.equal(refused.status, 126);
  assert.match(refused.stderr, /"reason":"RAVEN_CLOSURE_ROOTS missing or malformed"/);
});

test('symlinked package directory pointing outside the closure is refused at binding time (BINDING_REFUSED)', async () => {
  const s = scratchSdk();
  const outside = path.join(s.base, 'outside-pkg'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'package.json'), JSON.stringify({ name: 'linked', version: '1.0.0', main: 'index.cjs' }));
  fs.writeFileSync(path.join(outside, 'index.cjs'), 'module.exports={v:1};');
  fs.mkdirSync(path.join(s.sdk, 'node_modules'), { recursive: true });
  fs.symlinkSync(outside, path.join(s.sdk, 'node_modules', 'linked'));
  s.adapter('linked', "import l from 'linked';const v=l.v;", ['linked']);
  const { resolveExecutionIdentity: id } = await s.runner();
  assert.throws(() => id('linked'), (e) => e.code === 'BINDING_REFUSED');
});

// ---------- policy identity / migration ----------
test('policy identity is /2; a case bound to policy /1 is INVALID_CASE (no silent migration)', () => {
  assert.equal(POLICY.id, 'raven-replay-adapter-offline/2');
  assert.notEqual(POLICY_SHA, OLD_POLICY_SHA_V1);
  assert.ok(POLICY.closure_guard && POLICY.dependency_closure && POLICY.ws_native_addon_flags, 'policy must declare the closure rule, the guard and the ws flag state');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcb2-pol-'));
  const casePath = path.join(dir, 'c.json');
  const created = spawnSync(node, [path.join(root, 'src', 'cli.mjs'), 'create', '--adapter', 'example-parser-v1', '--name', 'pol', path.join(root, 'fixtures', 'legacy-transaction.base64'), casePath], { encoding: 'utf8', cwd: root });
  assert.equal(created.status, 0, created.stdout);
  const c = JSON.parse(fs.readFileSync(casePath, 'utf8'));
  assert.equal(c.bindings.policy_sha256, POLICY_SHA);
  c.bindings.policy_sha256 = OLD_POLICY_SHA_V1;
  const old = path.join(dir, 'old.json'); fs.writeFileSync(old, JSON.stringify(c));
  const rerun = spawnSync(node, [path.join(root, 'src', 'cli.mjs'), 'rerun', old], { encoding: 'utf8', cwd: root });
  assert.equal(rerun.status, 2, rerun.stdout);
  // A policy-binding mismatch is refused while the case is parsed (raven-replay-adapter-case-error/1,
  // no results array): nothing was executed.
  const body = JSON.parse(rerun.stdout);
  const r = Array.isArray(body.results) ? body.results[0] : body;
  assert.equal(r.status, 'INVALID_CASE');
  assert.equal(r.exit_code, 2);
  assert.match(r.error, /Unsupported policy binding/);
});

// ---------- real closure (reads live node_modules only) ----------
test('real @solana/kit closure: ws is bound; its optional peers are absent and therefore not permitted; permitted roots == closure + adapters', () => {
  const id = resolveExecutionIdentity('solana-kit-tx-decode');
  assert.ok(id.closure_packages.includes('ws'));
  for (const n of ['bufferutil', 'utf-8-validate', 'typescript']) assert.ok(!id.closure_packages.includes(n), n + ' is not installed and must not be in the closure');
  const roots = id.permitted_execution_roots;
  assert.equal(roots.dirs.length, id.closure_packages.length + 1, 'closure dirs + adapters/');
  assert.ok(roots.dirs.includes(path.join(packageRoot(), 'adapters')));
  assert.deepEqual(roots.files.map((f) => path.basename(f)).sort(), CHILD_RUNTIME_FILES.map(f => path.basename(f)).sort());
});

// ---------- D2-S1-1 (CODEX S1 recheck): the enforcement code itself must be byte-bound ----------
// One mutation control per SDK child-runtime file. Each test proves, in order:
//   (a) the unchanged case replays MATCH;
//   (b) the guard instrument is live (an ancestor module is refused, nothing executes);
//   (c) mutating ONLY that SDK file changes the binding and the replay is refused BEFORE execution;
//   (d) restoring the file (and removing the ancestor) returns the same case to MATCH.
for (const [label, rel, mutate] of [
  ['closure guard replaced by a no-op', 'src/closure-guard.cjs', () => "'use strict';\n// no-op guard\n"],
  ['watchdog bytes changed', 'src/watchdog-exec.mjs', (old) => old + '\n// changed\n'],
  ['observer replaced by no-op', 'src/adapter-observe-hook.mjs', () => '// no-op observer\n'],
  ['observer comment mutation', 'src/adapter-observe-hook.mjs', old => old + '\n// mutation\n'],
  ['observer helper bytes changed', 'src/process-identity.mjs', old => old + '\n// mutation\n'],
]) {
  test(`D2-S1-1 regression (CODEX control): ${label} → detected before execution; unchanged case still MATCH`, async () => {
    const s = scratchSdk();
    s.pkg(s.sdk, 'review-root', { optionalDependencies: { 'review-leaf': '1.0.0' } }, "let v='fallback';try{v=require('review-leaf').v}catch{}module.exports={v};");
    s.adapter('review-unbound', "import r from 'review-root';const v=r.v;", ['review-root']);
    const casePath = path.join(s.base, 'case.json');
    const created = s.cli(['create', '--adapter', 'review-unbound', '--name', 'unbound', s.fixture, casePath]);
    assert.equal(created.status, 0, created.stdout);
    const digest = JSON.parse(created.stdout).case_content_sha256;
    const rerun = () => { const r = s.cli(['rerun', '--expect-sha256', digest, casePath]); return { code: r.status, body: JSON.parse(r.stdout).results[0] }; };
    // (a) unchanged → MATCH
    const clean = rerun();
    assert.equal(clean.code, 0);
    assert.equal(clean.body.status, 'MATCH');
    // (b) instrument: ancestor review-leaf returning the same value is refused by the live guard
    s.pkg(s.anc, 'review-leaf', {}, s.markerCode('ANCESTOR', "module.exports={v:'fallback'};"));
    const guarded = rerun();
    assert.equal(guarded.code, 3);
    assert.equal(guarded.body.execution, 'INCOMPLETE');
    assert.equal(s.readMarker(), null);
    // (c) mutate only the SDK file
    const { resolveExecutionIdentity: id } = await s.runner();
    const before = id('review-unbound');
    const file = path.join(s.sdk, ...rel.split('/'));
    const original = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, mutate(original));
    const after = id('review-unbound');
    assert.notEqual(after.dependency_binding_sha256, before.dependency_binding_sha256, rel + ' must be byte-bound');
    assert.deepEqual(after.closure_packages, before.closure_packages);
    assert.equal(after.adapter_source_sha256, before.adapter_source_sha256);
    const mutated = rerun();
    assert.equal(mutated.code, 3);
    assert.equal(mutated.body.status, 'RUN_ERROR');
    assert.equal(mutated.body.execution, 'NOT_RUN');
    assert.match(mutated.body.error, /Dependency installed-file inventory differs/);
    assert.equal(s.readMarker(), null, 'the ancestor module must not execute after the SDK file changed');
    // (d) restore → same case MATCHes again once the ancestor is gone
    fs.writeFileSync(file, original);
    fs.rmSync(path.join(s.anc, 'node_modules'), { recursive: true, force: true });
    const restored = rerun();
    assert.equal(restored.code, 0);
    assert.equal(restored.body.status, 'MATCH');
  });
}

test('invariant: every permitted SDK file is byte-bound with its current bytes; every permitted dir is a closure package or local root', () => {
  const idn = resolveExecutionIdentity('solana-kit-tx-decode');
  const bound = new Map(idn.dependency_packages.map((p) => [p.package, p]));
  assert.equal(idn.permitted_execution_roots.files.length, CHILD_RUNTIME_FILES.length);
  for (const f of idn.permitted_execution_roots.files) {
    const rel = path.relative(packageRoot(), f).split(path.sep).join('/');
    const entry = bound.get('sdk:' + rel);
    assert.ok(entry, 'permitted SDK file not bound: ' + rel);
    assert.equal(entry.kind, 'sdk_child_runtime');
    assert.equal(entry.inventory_sha256, createHash('sha256').update(fs.readFileSync(f)).digest('hex'));
  }
  const inventoried = new Set(idn.closure_packages.map((n) => path.join(packageRoot(), 'node_modules', ...n.split('/'))));
  inventoried.add(path.join(packageRoot(), 'adapters'));
  for (const d of idn.permitted_execution_roots.dirs) assert.ok(inventoried.has(d), 'permitted dir not inventoried: ' + d);
});

// I-1: exact-file extension, never a blanket src/ permit.
test('I-1: observer helper is required and regular; unrelated sibling remains refused', async () => {
  const s = scratchSdk({ spaces: true });
  try {
    const runner = await s.runner();
    const id = runner.resolveExecutionIdentity('example-parser-v1');
    const helper = path.join(s.sdk, 'src/process-identity.mjs');
    const original = fs.readFileSync(helper);
    const guard = path.join(s.sdk, 'src/closure-guard.cjs');
    const sibling = path.join(s.sdk, 'src/unrelated-review.mjs');
    fs.writeFileSync(sibling, `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(s.marker)}, 'executed');`);
    const load = roots => spawnSync(node, ['--require', guard, '--import', pathToFileURL(sibling).href, '-e', ''], {encoding:'utf8', env:{PATH:'', RAVEN_CLOSURE_ROOTS:JSON.stringify(roots)}});
    const denied=load(id.permitted_execution_roots);
    assert.equal(denied.status,126);assert.match(denied.stderr,/outside_permitted_closure/);assert.equal(s.readMarker(),null);
    const broad=load({...id.permitted_execution_roots,dirs:[...id.permitted_execution_roots.dirs,path.join(s.sdk,'src'),fs.realpathSync(path.join(s.sdk,'src'))]});
    assert.equal(broad.status,0,broad.stderr);assert.equal(s.readMarker(),'executed');
    fs.unlinkSync(helper);assert.throws(()=>runner.resolveExecutionIdentity('example-parser-v1'),/inventory refused/);
    const target=path.join(s.base,'identity-copy.mjs');fs.writeFileSync(target,original);fs.symlinkSync(target,helper);
    assert.throws(()=>runner.resolveExecutionIdentity('example-parser-v1'),/inventory refused/);
    fs.unlinkSync(helper);fs.writeFileSync(helper,original);
    assert.equal(runner.resolveExecutionIdentity('example-parser-v1').dependency_binding_sha256,id.dependency_binding_sha256);
    const helperOmitted={...id.permitted_execution_roots,files:id.permitted_execution_roots.files.filter(f=>path.basename(f)!=='process-identity.mjs')};
    const imported=spawnSync(node,['--require',guard,'--import',pathToFileURL(path.join(s.sdk,'src/adapter-observe-hook.mjs')).href,'-e',''],{encoding:'utf8',env:{PATH:'',RAVEN_CLOSURE_ROOTS:JSON.stringify(helperOmitted)}});
    assert.equal(imported.status,126);assert.match(imported.stderr,/process-identity.mjs/);
  } finally {fs.rmSync(s.base,{recursive:true,force:true});}
});

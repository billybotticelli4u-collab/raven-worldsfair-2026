import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const TOOL_PATH = fileURLToPath(new URL('../vendor/solana-inspector.mjs', import.meta.url));
export const TOOL_SHA = 'b1d03b29b298c922a64078a7f55b9344c0908b92ca411b4e5371786b92cac9d5';
export const NODE_VERSION = 'v22.18.0';
export const MAX_TRANSACTION_BYTES = 16384;
export const POLICY = Object.freeze({
  id: 'raven-replay-readonly-inspection/1',
  tool: 'solana-byte-structure-experimental/0',
  operation: 'inspect_local_bytes',
  timeout_ms: 3000,
  max_output_bytes: 8192,
  max_transaction_bytes: MAX_TRANSACTION_BYTES,
  input_encoding: 'base64',
  network_calls: 'none_in_allowlisted_tool',
  containment: 'node_permission_fs_read_only; network_not_kernel_denied',
  claim: 'Experimental offline byte-structure inspection only; no transaction signature verification, safety or chain execution claim.',
});
export const sha = data => crypto.createHash('sha256').update(data).digest('hex');
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  throw new Error('Unsupported envelope value');
}
export const POLICY_SHA = sha(canonical(POLICY));
function exactKeys(obj, keys) {
  return obj !== null && typeof obj === 'object' && !Array.isArray(obj) &&
    isDeepStrictEqual(Object.keys(obj).sort(), [...keys].sort());
}
function b64(value, max, empty = false) {
  if (typeof value !== 'string' || value.length > Math.ceil(max/3)*4 || (!empty && value.length === 0)) throw new Error('Invalid base64 size');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > max || bytes.toString('base64') !== value) throw new Error('Noncanonical base64');
  return bytes;
}
export function transactionBytes(text) { return b64(text, MAX_TRANSACTION_BYTES); }
function localTool() {
  if (process.version !== NODE_VERSION) throw new Error('Runtime mismatch: use Node '+NODE_VERSION);
  if (sha(fs.readFileSync(TOOL_PATH)) !== TOOL_SHA) throw new Error('Local tool digest mismatch');
}
function execute(tx) {
  localTool();
  const input = JSON.stringify({tx_base64:tx})+'\n';
  const result = spawnSync(process.execPath,
    ['--experimental-permission', '--allow-fs-read='+TOOL_PATH, '--no-warnings', TOOL_PATH],
    {input, env:{}, encoding:null, timeout:POLICY.timeout_ms, maxBuffer:POLICY.max_output_bytes});
  const stdout = result.stdout || Buffer.alloc(0), stderr = result.stderr || Buffer.alloc(0);
  let parsed = null;
  try { parsed = JSON.parse(stdout.toString('utf8')); } catch {}
  const valid = exactKeys(parsed, ['decision','version','reason']) &&
    ['ACCEPT','REJECT'].includes(parsed.decision) && ['legacy',0,1,null].includes(parsed.version) && typeof parsed.reason === 'string';
  return {
    complete: !result.error && result.status === 0 && result.signal === null && valid,
    exit_code:result.status, signal:result.signal, error_code:result.error?.code || null,
    stdin_sha256:sha(input), stdout_base64:stdout.toString('base64'), stderr_base64:stderr.toString('base64'),
    parsed:valid ? parsed : null,
  };
}
export function newSigner() {
  const {privateKey,publicKey} = crypto.generateKeyPairSync('ed25519');
  return {privateKey, publicKey:publicKey.export({type:'spki',format:'der'}).toString('base64')};
}
export const signerFingerprint = key => sha(b64(key,128));
export function sealBody(body, signer) {
  const digest = sha(canonical(body));
  const signature = crypto.sign(null, Buffer.from('raven-action-evidence/1\n'+digest), signer.privateKey).toString('base64');
  return {body, body_sha256:digest, signer_spki_base64:signer.publicKey, signature_base64:signature};
}
export function capture(txBase64, {caller = 'unidentified-caller', signer = newSigner()} = {}) {
  const bytes = transactionBytes(txBase64);
  if (typeof caller !== 'string' || caller.length > 120) throw new Error('Caller label must be at most 120 characters');
  const execution = execute(txBase64);
  const body = {
    schema:'raven-action-evidence/1',
    action:{tool:POLICY.tool, tool_sha256:TOOL_SHA, input_base64:txBase64, input_sha256:sha(bytes), policy:POLICY, policy_sha256:POLICY_SHA},
    capture:{id:crypto.randomUUID(), time:new Date().toISOString(), caller_label_untrusted:caller, runtime:process.version},
    execution,
  };
  const envelope = sealBody(body,signer);
  return {envelope, reference:{body_sha256:envelope.body_sha256, signer_fingerprint:signerFingerprint(signer.publicKey)},
    note:'Keep the reference through a separately trusted channel. A reference edited alongside evidence does not authenticate it.'};
}
function shape(body) {
  if (!exactKeys(body,['schema','action','capture','execution']) || body.schema !== 'raven-action-evidence/1') throw new Error('Invalid action evidence schema');
  if (!exactKeys(body.action,['tool','tool_sha256','input_base64','input_sha256','policy','policy_sha256'])) throw new Error('Invalid action fields');
  if (!exactKeys(body.capture,['id','time','caller_label_untrusted','runtime']) ||
    typeof body.capture.id !== 'string' || !/^[0-9a-f-]{36}$/.test(body.capture.id) ||
    typeof body.capture.time !== 'string' || !Number.isFinite(Date.parse(body.capture.time)) ||
    typeof body.capture.caller_label_untrusted !== 'string' || body.capture.caller_label_untrusted.length >120 ||
    typeof body.capture.runtime !== 'string') throw new Error('Invalid capture fields');
  const e = body.execution;
  if (!exactKeys(e,['complete','exit_code','signal','error_code','stdin_sha256','stdout_base64','stderr_base64','parsed']) ||
    typeof e.complete !== 'boolean' || !(e.exit_code === null || Number.isInteger(e.exit_code)) ||
    !(e.signal === null || typeof e.signal === 'string') || !(e.error_code === null || typeof e.error_code === 'string')) throw new Error('Invalid execution fields');
  b64(e.stdout_base64,POLICY.max_output_bytes,true); b64(e.stderr_base64,POLICY.max_output_bytes,true);
  transactionBytes(body.action.input_base64);
}
export function verify(envelope, {expectedBodySha, trustedSignerFingerprint} = {}) {
  const result = {integrity:'NOT_ESTABLISHED', signature:'NOT_ESTABLISHED',
    reference:'NOT_PROVIDED', issuer:'NOT_ESTABLISHED', replay:'NOT_RUN',
    chain_anchor:'NOT_CHECKED', caller_identity:'NOT_ESTABLISHED', reasons:[]};
  try {
    if (!exactKeys(envelope,['body','body_sha256','signer_spki_base64','signature_base64'])) throw new Error('Invalid envelope fields');
    shape(envelope.body);
    const body = envelope.body, actualDigest = sha(canonical(body));
    result.integrity = actualDigest === envelope.body_sha256 ? 'MATCH' : 'MISMATCH';
    if (expectedBodySha !== undefined) {
      if (!/^[a-f0-9]{64}$/.test(expectedBodySha)) throw new Error('Malformed external digest');
      result.reference = actualDigest === expectedBodySha ? 'MATCH' : 'MISMATCH';
    }
    const pub = crypto.createPublicKey({key:b64(envelope.signer_spki_base64,128),format:'der',type:'spki'});
    result.signature = pub.asymmetricKeyType === 'ed25519' &&
      crypto.verify(null,Buffer.from('raven-action-evidence/1\n'+envelope.body_sha256),pub,b64(envelope.signature_base64,64)) ? 'VALID' : 'INVALID';
    if (trustedSignerFingerprint !== undefined) {
      if (!/^[a-f0-9]{64}$/.test(trustedSignerFingerprint)) throw new Error('Malformed trusted signer fingerprint');
      result.issuer = signerFingerprint(envelope.signer_spki_base64) === trustedSignerFingerprint ? 'KEY_MATCH' : 'KEY_MISMATCH';
    }
    if (result.integrity !== 'MATCH') result.reasons.push('Evidence body changed');
    if (result.signature !== 'VALID') result.reasons.push('Signature not valid');
    if (result.reference === 'MISMATCH') result.reasons.push('Evidence differs from external reference');
    if (result.issuer === 'KEY_MISMATCH') result.reasons.push('Signer differs from trusted key');
    if (body.action.tool !== POLICY.tool || body.action.tool_sha256 !== TOOL_SHA ||
      !isDeepStrictEqual(body.action.policy,POLICY) || body.action.policy_sha256 !== POLICY_SHA)
      result.reasons.push('Unsupported tool or policy binding');
    if (body.action.input_sha256 !== sha(transactionBytes(body.action.input_base64))) result.reasons.push('Input digest mismatch');
    if (body.capture.runtime !== NODE_VERSION) result.reasons.push('Captured runtime unsupported');
    if (result.reasons.length) return result;
    const replayed = execute(body.action.input_base64);
    result.replay = replayed.complete && body.execution.complete && isDeepStrictEqual(replayed,body.execution) ? 'MATCH' : 'MISMATCH';
    if (result.replay !== 'MATCH') result.reasons.push('Tool execution or full output differs; incomplete runs cannot match');
    result.tool_result = replayed.parsed;
    return result;
  } catch (e) {
    result.reasons.push(e.message);
    return result;
  }
}
export function parseEnvelope(text) {
  if (Buffer.byteLength(text)>128*1024) throw new Error('Evidence file too large');
  return JSON.parse(text);
}
export function challenge(envelope, kind) {
  const copy = structuredClone(envelope);
  switch(kind) {
    case 'input': copy.body.action.input_base64 = Buffer.from('changed').toString('base64'); break;
    case 'output': copy.body.execution.parsed = {decision:'ACCEPT',version:1,reason:'fabricated'}; break;
    case 'policy': copy.body.action.policy.timeout_ms = 99999; break;
    case 'transcript': copy.body.execution.stdout_base64 = Buffer.from('fabricated stdout\n').toString('base64'); break;
    case 'signer': copy.signer_spki_base64 = newSigner().publicKey; return copy;
    case 'resigned-output':
      copy.body.execution.parsed = {decision:'ACCEPT',version:1,reason:'fabricated'};
      return sealBody(copy.body,newSigner());
    case 'other-signer': return sealBody(copy.body,newSigner());
    default: throw new Error('Unknown challenge');
  }
  // Attacker recomputes the internal body hash; keeps the original signature.
  copy.body_sha256 = sha(canonical(copy.body));
  return copy;
}

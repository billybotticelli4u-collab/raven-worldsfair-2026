import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {capture,verify,challenge,newSigner,sealBody,sha,canonical,transactionBytes,parseEnvelope} from '../src/action.mjs';
const tx=fs.readFileSync(new URL('../examples/legacy-transaction.base64',import.meta.url),'utf8').trim();
const captured=capture(tx,{caller:'test agent'});
const opts={expectedBodySha:captured.reference.body_sha256,trustedSignerFingerprint:captured.reference.signer_fingerprint};
test('actual tool invocation captures ACCEPT but makes no safety/chain assertion',()=>{
  assert.equal(captured.envelope.body.execution.complete,true);
  assert.equal(captured.envelope.body.execution.parsed.decision,'ACCEPT');
  const v=verify(captured.envelope,opts);
  assert.equal(v.replay,'MATCH');assert.equal(v.reference,'MATCH');assert.equal(v.issuer,'KEY_MATCH');
  assert.equal(v.chain_anchor,'NOT_CHECKED');assert.equal(v.caller_identity,'NOT_ESTABLISHED');
  assert.deepEqual(v.reasons,[]);
});
test('no supplied trust cannot turn embedded signer into trusted identity',()=>{
  const v=verify(captured.envelope);assert.equal(v.replay,'MATCH');assert.equal(v.signature,'VALID');
  assert.equal(v.issuer,'NOT_ESTABLISHED');assert.equal(v.reference,'NOT_PROVIDED');
});
for(const attack of ['input','output','policy','transcript','signer','resigned-output','other-signer']) {
  test('external reference and trust reject '+attack,()=>{
    const v=verify(challenge(captured.envelope,attack),opts);
    assert.notEqual(v.replay,'MATCH');assert.ok(v.reasons.length);
  });
}
test('self-rehashed and re-signed invented answer fails actual replay without external reference',()=>{
  const v=verify(challenge(captured.envelope,'resigned-output'));
  assert.equal(v.integrity,'MATCH');assert.equal(v.signature,'VALID');assert.equal(v.replay,'MISMATCH');
});
test('changed raw transcript with valid new signature fails full-output comparison',()=>{
  const changed=structuredClone(captured.envelope.body);
  changed.execution.stdout_base64=Buffer.from('same meaning is not same bytes').toString('base64');
  const v=verify(sealBody(changed,newSigner()));assert.equal(v.replay,'MISMATCH');
});
test('valid alternate signer remains explicitly untrusted unless separately pinned',()=>{
  const other=challenge(captured.envelope,'other-signer'), v=verify(other);
  assert.equal(v.replay,'MATCH');assert.equal(v.signature,'VALID');assert.equal(v.issuer,'NOT_ESTABLISHED');
  assert.equal(verify(other,opts).issuer,'KEY_MISMATCH');
});
test('changed-and-re-signed input with recomputed hashes may reproduce: external commitment detects original changed',()=>{
  const other=capture(Buffer.from([0]).toString('base64'));
  assert.equal(verify(other.envelope).replay,'MATCH');
  assert.equal(verify(other.envelope,{expectedBodySha:opts.expectedBodySha}).reference,'MISMATCH');
});
test('parser refusal is completed inspection, not execution failure',()=>{
  const bad=capture(Buffer.from([0]).toString('base64'));
  assert.equal(bad.envelope.body.execution.complete,true);assert.equal(bad.envelope.body.execution.parsed.decision,'REJECT');
  assert.equal(verify(bad.envelope).replay,'MATCH');
});
test('fabricated incomplete execution cannot receive a successful replay',()=>{
  const changed=structuredClone(captured.envelope.body);changed.execution.complete=false;
  changed.execution.error_code='ETIMEDOUT';changed.execution.exit_code=null;
  const v=verify(sealBody(changed,newSigner()));assert.equal(v.replay,'MISMATCH');
});
for(const field of ['tool_sha256','policy_sha256','input_sha256']) {
  test('unsupported '+field+' fails even after re-signing',()=>{
    const changed=structuredClone(captured.envelope.body);changed.action[field]='0'.repeat(64);
    assert.equal(verify(sealBody(changed,newSigner())).replay,'NOT_RUN');
  });
}
test('changed policy content with its own new digest is not accepted',()=>{
  const changed=structuredClone(captured.envelope.body);changed.action.policy.operation='send_transaction';
  changed.action.policy_sha256=sha(canonical(changed.action.policy));
  assert.equal(verify(sealBody(changed,newSigner())).replay,'NOT_RUN');
});
test('unknown signed fields are refused',()=>{
  const changed=structuredClone(captured.envelope.body);changed.arbitrary_public_claim='verified safe';
  assert.equal(verify(sealBody(changed,newSigner())).replay,'NOT_RUN');
});
test('malformed evidence and oversized/noncanonical inputs fail closed',()=>{
  for(const x of [null,[],{},'hello']) assert.equal(verify(x).replay,'NOT_RUN');
  for(const x of ['', 'AA', 'AA==\n', '!@#=',Buffer.alloc(16385).toString('base64')]) assert.throws(()=>transactionBytes(x));
  assert.throws(()=>parseEnvelope(' '.repeat(128*1024+1)));
});
test('malformed external reference is a refusal, not an omitted check',()=>{
  assert.notEqual(verify(captured.envelope,{expectedBodySha:''}).replay,'MATCH');
  assert.notEqual(verify(captured.envelope,{trustedSignerFingerprint:'no'}).replay,'MATCH');
});
test('relabeling claimed caller breaks original reference, and never establishes caller identity',()=>{
  const changed=structuredClone(captured.envelope.body);changed.capture.caller_label_untrusted='Raven production';
  const v=verify(sealBody(changed,newSigner()),opts);assert.equal(v.reference,'MISMATCH');
  assert.equal(v.caller_identity,'NOT_ESTABLISHED');
});

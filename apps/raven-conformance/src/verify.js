#!/usr/bin/env node
/** Independent report checker: deliberately imports no producer/runner/digest code.
 * Verifies an unsigned report's consistency with local reviewed artifacts.
 * An externally obtained expected digest binds exact bytes; neither is execution attestation.
 */
import {readFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const requireCheck=(ok,code)=>{if(!ok)throw new Error(code);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function verifyReport(report,{expectedDigest}={}) {
  requireCheck(report && report.schema==='raven-conformance-report/1','REPORT_SCHEMA');
  const {report_content_digest_sha256:digest,...body}=report;
  requireCheck(/^[0-9a-f]{64}$/.test(digest),'REPORT_DIGEST_FORMAT');
  requireCheck(hash(JSON.stringify(body,null,2)+'\n')===digest,'REPORT_DIGEST_MISMATCH');
  if(expectedDigest!==undefined) requireCheck(/^[0-9a-f]{64}$/.test(expectedDigest)&&digest===expectedDigest,'EXPECTED_DIGEST_MISMATCH');
  const pbytes=readFileSync(path.join(ROOT,'profiles/raven-canonical-envelope-1.json'));
  const profile=JSON.parse(pbytes);
  const corpus=JSON.parse(readFileSync(path.join(ROOT,'corpus/raven-canonical-envelope-demo-corpus-1.json')));
  const cbody={id:corpus.id,version:corpus.version,profile:corpus.profile,description:corpus.description,vectors:corpus.vectors};
  const cdigest=hash(JSON.stringify(cbody,null,2)+'\n');
  requireCheck(cdigest===corpus.content_digest_sha256,'LOCAL_CORPUS_DIGEST_MISMATCH');
  requireCheck(report.corpus.sha256===cdigest&&report.corpus.declared_content_digest_sha256===cdigest,'CORPUS_DIGEST_MISMATCH');
  requireCheck(report.corpus.id===corpus.id&&report.corpus.version===corpus.version&&report.corpus.vector_count===corpus.vectors.length,'CORPUS_IDENTITY');
  requireCheck(report.claimed_profile.name===profile.name&&report.claimed_profile.version===profile.version&&report.claimed_profile.sha256===hash(pbytes)&&corpus.profile===profile.name,'PROFILE_IDENTITY');
  const targets=JSON.parse(readFileSync(path.join(ROOT,'targets/manifests.json'))).targets;
  const target=targets.find(t=>t.id===report.target.id);
  requireCheck(target&&report.target.entry===target.entry&&report.target.version===target.version,'TARGET_IDENTITY');
  requireCheck(report.target.entry_sha256===hash(readFileSync(path.join(ROOT,'targets',target.entry))),'TARGET_DIGEST');
  requireCheck(report.target.claimed_conformance_profile===profile.name&&target.claimed_conformance_profile===profile.name&&report.target.claimed_conformance_profile_version===profile.version&&target.claimed_conformance_profile_version===profile.version,'TARGET_PROFILE');
  requireCheck(Array.isArray(report.results)&&report.results.length===corpus.vectors.length,'RESULT_CARDINALITY');
  const ids=new Set(),divergent=[],errors=[];let pass=0;
  for(let i=0;i<corpus.vectors.length;i++) {
    const r=report.results[i],v=corpus.vectors[i];
    requireCheck(r.vector_id===v.id&&!ids.has(r.vector_id),'VECTOR_IDENTITY');ids.add(r.vector_id);
    requireCheck(r.description===v.description&&same(r.expected,{decision:v.expected.decision}),'EXPECTED_RESULT');
    const e=r.evidence;requireCheck(e&&typeof e.stdout==='string'&&typeof e.stderr==='string','TRANSCRIPT_REQUIRED');
    requireCheck(Buffer.byteLength(e.stdout)<=3*65536&&Buffer.byteLength(e.stderr)<=3*65536,'TRANSCRIPT_LIMIT');
    // Independent interpretation of the transcript and execution fields.
    let observed=null;
    try {const lines=e.stdout.trim().split(/\r?\n/).filter(Boolean);if(lines.length===1){const o=JSON.parse(lines[0]);if(o&&['ACCEPT','REJECT'].includes(o.decision))observed=o;}}catch{}
    const error=e.output_truncated?'OUTPUT_LIMIT':e.timed_out?'TIMEOUT':e.exitCode!==0||e.signal?'TARGET_CRASH':!observed?'INVALID_OUTPUT':null;
    // A spawn failure has no running target; it cannot be promoted to a graded result.
    const expectedError=e.error_code==='SPAWN_ERROR'&&e.exitCode!==0?'SPAWN_ERROR':error;
    requireCheck(e.error_code===expectedError,'ERROR_CLASSIFICATION');
    requireCheck(r.observed.decision===(observed?.decision??null)&&same(r.observed.reason,observed?.reason??null),'OBSERVED_TRANSCRIPT_MISMATCH');
    const status=expectedError?'HARNESS_ERROR':observed.decision===v.expected.decision?'PASS':'DIVERGENCE';
    requireCheck(r.status===status,'STATUS_MISMATCH');
    if(status==='PASS')pass++;else if(status==='DIVERGENCE')divergent.push(v.id);else errors.push(v.id);
  }
  const s=report.summary;
  requireCheck(s.test_count===ids.size&&s.pass===pass&&s.divergence===divergent.length&&s.harness_error===errors.length&&s.graded_count===pass+divergent.length,'SUMMARY_COUNTS');
  requireCheck(same(s.divergent_vector_ids,divergent)&&same(s.harness_error_vector_ids,errors),'SUMMARY_VECTORS');
  requireCheck(s.overall===(errors.length?'HARNESS_ERROR':divergent.length?'DIVERGENT':'CONFORMANT'),'SUMMARY_VERDICT');
  return {status:'PASS',check:'report_integrity_and_local_artifact_consistency',digest,external_digest_matched:expectedDigest!==undefined,execution_attested:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
  try {
    const args=process.argv.slice(2);requireCheck(args.length===1||(args.length===3&&args[1]==='--expected-digest'),'Usage: npm run verify -- report.json [--expected-digest SHA256]');
    const bytes=readFileSync(args[0]);requireCheck(bytes.length<=4*1024*1024,'REPORT_SIZE_LIMIT');
    console.log(JSON.stringify(verifyReport(JSON.parse(bytes),{expectedDigest:args[2]}),null,2));
  }catch(error){console.error(JSON.stringify({status:'FAIL',error:error.message}));process.exitCode=1;}
}

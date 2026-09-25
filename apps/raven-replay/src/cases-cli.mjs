import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createCase, parseCase, runCases, MAX_CASE_BYTES, MAX_CASES, CaseError } from './cases.mjs';

function readBounded(path, limit) {
  const stat = fs.lstatSync(path);
  if (!stat.isFile() || stat.size > limit) throw new CaseError('INVALID_CASE', 'Input must be a regular file within the size limit');
  const text = fs.readFileSync(path, 'utf8');
  if (Buffer.byteLength(text) > limit) throw new CaseError('INVALID_CASE', 'Input exceeds size limit');
  return text;
}

export function main(args) {
  try {
    const [command, ...rest] = args;
    if (command === 'save') {
      if (rest.length !== 3) throw new CaseError('INVALID_CASE', 'Usage: cases-cli.mjs save input.base64 case.json case-name');
      const made = createCase(readBounded(rest[0], 24000).trim(), { name: rest[2] });
      fs.writeFileSync(rest[1], JSON.stringify(made.case, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      return { exit_code: 0, result: { status: 'SAVED', name: made.case.name, case_content_sha256: made.case_content_sha256,
        expected_result: made.case.expected_execution.parsed, limits: made.limits } };
    }
    if (command === 'run') {
      let expectedCaseSha256s;
      if (rest[0] === '--expect-sha256') {
        if (rest.length !== 3) throw new CaseError('INVALID_CASE', 'Expected one digest and one case after --expect-sha256');
        expectedCaseSha256s = [rest[1]]; rest.splice(0, 2);
      }
      if (rest.length < 1 || rest.length > MAX_CASES || rest.some(x => x.startsWith('--'))) throw new CaseError('INVALID_CASE', 'Usage: cases-cli.mjs run [--expect-sha256 digest] case.json [case2.json ...]');
      // Read all explicit files before executing anything. Case content cannot name paths or commands.
      const cases = rest.map(path => parseCase(readBounded(path, MAX_CASE_BYTES)));
      const result = runCases(cases, { expectedCaseSha256s });
      return { exit_code: result.exit_code, result };
    }
    throw new CaseError('INVALID_CASE', 'Expected save or run');
  } catch (error) {
    const status = error instanceof CaseError ? error.kind : 'RUN_ERROR';
    const exit_code = status === 'INVALID_CASE' ? 2 : 3;
    return { exit_code, result: { schema: 'raven-replay-case-error/1', status, exit_code,
      error: error instanceof CaseError ? error.message : 'File access or runner failure; existing output is never overwritten' } };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const { exit_code, result } = main(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = exit_code;
}

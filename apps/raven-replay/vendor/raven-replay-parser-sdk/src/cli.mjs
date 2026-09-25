#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createCase, parseCase, runCases, caseDigest,
  compareVersionsAgainstBaseline, compareVersionsFreshExperiment,
  MAX_CASE_BYTES, MAX_CASES, CaseError, CASE_SCHEMA,
} from './cases.mjs';
import { listAdapters } from './registry.mjs';

function readBounded(filePath, limit) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.size > limit) throw new CaseError('INVALID_CASE', 'Input must be a regular file within the size limit');
  const text = fs.readFileSync(filePath, 'utf8');
  if (Buffer.byteLength(text) > limit) throw new CaseError('INVALID_CASE', 'Input exceeds size limit');
  return text;
}

function writeNew(filePath, text) {
  fs.writeFileSync(filePath, text, { flag: 'wx', mode: 0o600 });
}

function usage() {
  return [
    'Usage:',
    '  cli.mjs list-adapters',
    '  cli.mjs create --adapter <id> --name <name> <input.base64> <case.json>',
    '  cli.mjs export <case.json> <export-dir>   # copies case + writes REFERENCE.sha256 + LABEL',
    '  cli.mjs import <case.json-or-export-dir> <dest-case.json>',
    '  cli.mjs rerun [--expect-sha256 digest] <case.json> [case2.json ...]',
    '  cli.mjs report [--detailed] [--expect-sha256 digest] <case.json> [case2.json ...] <report.json>',
    '  cli.mjs compare-versions --baseline-case <case.json> --expect-sha256 <digest> --candidate <id> [--label <text>] [--detailed] <out.json>',
    '  cli.mjs compare-versions-fresh --baseline <id> --candidate <id> --label <text> <input.base64> <out.json>',
    '',
    'Note: This package is a separate CLI module. The accepted Replay capture/saved-case UI is not integrated here.',
  ].join('\n');
}

export function main(args) {
  try {
    const [command, ...rest] = args;
    if (command === 'list-adapters') {
      return { exit_code: 0, result: { schema: 'raven-replay-adapter-list/1', adapters: listAdapters() } };
    }
    if (command === 'create') {
      let adapter, name;
      const positional = [];
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--adapter') adapter = rest[++i];
        else if (rest[i] === '--name') name = rest[++i];
        else positional.push(rest[i]);
      }
      if (positional.length !== 2) throw new CaseError('INVALID_CASE', usage());
      const made = createCase(readBounded(positional[0], 24000).trim(), { name, adapterId: adapter });
      writeNew(positional[1], JSON.stringify(made.case, null, 2) + '\n');
      return {
        exit_code: 0,
        result: {
          status: 'CREATED',
          name: made.case.name,
          adapter_id: made.case.adapter_id,
          case_content_sha256: made.case_content_sha256,
          expected_result: {
            decision: made.case.expected_execution.parsed.decision,
            version: made.case.expected_execution.parsed.version,
            reason: made.case.expected_execution.parsed.reason,
            decoded_omitted_from_summary: made.case.expected_execution.parsed.decision === 'ACCEPT',
          },
          limits: made.limits,
          warning: 'Case file contains raw input_base64. Treat as sensitive customer data if applicable.',
        },
      };
    }
    if (command === 'export') {
      if (rest.length !== 2) throw new CaseError('INVALID_CASE', 'Usage: export <case.json> <export-dir>');
      const c = parseCase(readBounded(rest[0], MAX_CASE_BYTES));
      const dig = caseDigest(c);
      fs.mkdirSync(rest[1], { recursive: false });
      writeNew(path.join(rest[1], 'case.json'), JSON.stringify(c, null, 2) + '\n');
      writeNew(path.join(rest[1], 'REFERENCE.sha256'), dig + '\n');
      writeNew(path.join(rest[1], 'LABEL.txt'),
        'RAVEN Replay adapter case export\n' +
        'schema=' + CASE_SCHEMA + '\n' +
        'name=' + c.name + '\n' +
        'adapter_id=' + c.adapter_id + '\n' +
        'contains_raw_input=YES\n' +
        'case_content_sha256=' + dig + '\n' +
        'Retain REFERENCE.sha256 independently of the case file for replacement detection.\n');
      return { exit_code: 0, result: { status: 'EXPORTED', case_content_sha256: dig, export_dir: rest[1] } };
    }
    if (command === 'import') {
      if (rest.length !== 2) throw new CaseError('INVALID_CASE', 'Usage: import <case.json-or-export-dir> <dest-case.json>');
      let src = rest[0];
      let expectDig;
      if (fs.existsSync(src) && fs.lstatSync(src).isDirectory()) {
        const refPath = path.join(src, 'REFERENCE.sha256');
        if (fs.existsSync(refPath)) expectDig = fs.readFileSync(refPath, 'utf8').trim();
        src = path.join(src, 'case.json');
      }
      const c = parseCase(readBounded(src, MAX_CASE_BYTES));
      const dig = caseDigest(c);
      if (expectDig && expectDig !== dig) throw new CaseError('INVALID_CASE', 'Imported case differs from REFERENCE.sha256');
      writeNew(rest[1], JSON.stringify(c, null, 2) + '\n');
      return {
        exit_code: 0,
        result: {
          status: 'IMPORTED',
          name: c.name,
          adapter_id: c.adapter_id,
          case_content_sha256: dig,
          reference: expectDig ? 'MATCH' : 'NOT_PROVIDED',
          warning: 'Imported case contains raw input_base64.',
        },
      };
    }
    if (command === 'rerun') {
      let expectedCaseSha256s;
      const files = [...rest];
      if (files[0] === '--expect-sha256') {
        if (files.length < 3) throw new CaseError('INVALID_CASE', 'Expected digest and at least one case');
        expectedCaseSha256s = [files[1]];
        files.splice(0, 2);
      }
      if (files.length < 1 || files.length > MAX_CASES) throw new CaseError('INVALID_CASE', usage());
      const cases = files.map((p) => parseCase(readBounded(p, MAX_CASE_BYTES)));
      const report = runCases(cases, { expectedCaseSha256s, detailed: false });
      return { exit_code: report.exit_code, result: report };
    }
    if (command === 'report') {
      let expectedCaseSha256s;
      let detailed = false;
      const files = [...rest];
      while (files[0] === '--detailed' || files[0] === '--expect-sha256') {
        if (files[0] === '--detailed') {
          detailed = true;
          files.shift();
          continue;
        }
        if (files[0] === '--expect-sha256') {
          if (files.length < 4) throw new CaseError('INVALID_CASE', 'Expected digest, cases, and report path');
          expectedCaseSha256s = [files[1]];
          files.splice(0, 2);
        }
      }
      if (files.length < 2) throw new CaseError('INVALID_CASE', 'Usage: report [--detailed] [cases...] <report.json>');
      const outPath = files.pop();
      const cases = files.map((p) => parseCase(readBounded(p, MAX_CASE_BYTES)));
      const report = runCases(cases, { expectedCaseSha256s, detailed });
      writeNew(outPath, JSON.stringify(report, null, 2) + '\n');
      return {
        exit_code: report.exit_code,
        result: {
          status: detailed ? 'DETAILED_REPORT_WRITTEN' : 'REPORT_WRITTEN',
          exit_code: report.exit_code,
          counts: report.counts,
          report_path: outPath,
          detailed_export: detailed,
          note: detailed
            ? 'OPT-IN detailed export may contain reconstructible wire/message/signature bytes.'
            : 'Default report uses safe summaries/digests only; no reconstructible wire bytes.',
        },
      };
    }
    if (command === 'compare-versions') {
      let baselineCasePath, expectSha, candidate, label;
      let detailed = false;
      const positional = [];
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--baseline-case') baselineCasePath = rest[++i];
        else if (rest[i] === '--expect-sha256') expectSha = rest[++i];
        else if (rest[i] === '--candidate') candidate = rest[++i];
        else if (rest[i] === '--label') label = rest[++i];
        else if (rest[i] === '--detailed') detailed = true;
        else positional.push(rest[i]);
      }
      if (!baselineCasePath || !expectSha || !candidate || positional.length !== 1) {
        throw new CaseError('INVALID_CASE', usage());
      }
      const baselineCase = parseCase(readBounded(baselineCasePath, MAX_CASE_BYTES));
      const comparison = compareVersionsAgainstBaseline({
        baselineCase,
        baselineCaseSha256: expectSha,
        candidateAdapterId: candidate,
        label,
        detailed,
      });
      writeNew(positional[0], JSON.stringify(comparison, null, 2) + '\n');
      const exit = comparison.comparison_complete ? 0 : 3;
      return {
        exit_code: exit,
        result: {
          status: comparison.status,
          label: comparison.label,
          changed: comparison.changed,
          comparison_complete: comparison.comparison_complete,
          difference_fields: (comparison.differences || []).map((d) => d.field),
          baseline_adapter_id: comparison.baseline.adapter_id,
          candidate_adapter_id: candidate,
          note: comparison.baseline.note,
        },
      };
    }
    if (command === 'compare-versions-fresh') {
      let baseline, candidate, label;
      const positional = [];
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--baseline') baseline = rest[++i];
        else if (rest[i] === '--candidate') candidate = rest[++i];
        else if (rest[i] === '--label') label = rest[++i];
        else positional.push(rest[i]);
      }
      if (positional.length !== 2) throw new CaseError('INVALID_CASE', usage());
      const input = readBounded(positional[0], 24000).trim();
      const comparison = compareVersionsFreshExperiment({
        baselineAdapterId: baseline,
        candidateAdapterId: candidate,
        inputBase64: input,
        label,
      });
      writeNew(positional[1], JSON.stringify(comparison, null, 2) + '\n');
      return {
        exit_code: 0,
        result: {
          status: 'FRESH_EXPERIMENT_COMPARED',
          label: comparison.label,
          changed: comparison.changed,
          difference_fields: comparison.differences.map((d) => d.field),
          baseline_adapter_id: baseline,
          candidate_adapter_id: candidate,
          warning: comparison.warning,
        },
      };
    }
    throw new CaseError('INVALID_CASE', usage());
  } catch (error) {
    const status = error instanceof CaseError ? error.kind : 'RUN_ERROR';
    const exit_code = status === 'INVALID_CASE' ? 2 : 3;
    return {
      exit_code,
      result: {
        schema: 'raven-replay-adapter-case-error/1',
        status,
        exit_code,
        error: error instanceof CaseError ? error.message : 'File access or runner failure; existing output is never overwritten',
      },
    };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const { exit_code, result } = main(process.argv.slice(2));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = exit_code;
}

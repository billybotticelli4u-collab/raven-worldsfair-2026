#!/usr/bin/env node
import { evaluatePack } from "./evaluate.js";

const json = process.argv.includes("--json");
const result = await evaluatePack();
if (json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  console.log(`Challenge pack: ${result.pack.corpus_id}@${result.pack.corpus_version}`);
  console.log(`Vectors: ${result.pack.vector_count} (${result.pack.added_vector_count} added, ${result.pack.underspecified_vector_count} unscored/underspecified)`);
  console.log(`Reference: ${result.reference.status} (${result.reference.scored_divergence_count} divergences)`);
  for (const mutant of result.mutants) console.log(`${mutant.id}: ${mutant.status} by ${mutant.killed_by.length} vector(s)`);
  console.log(`Survivors: ${result.surviving_mutants.length}`);
  console.log("Wrote results/measured.json and COVERAGE_MATRIX.md");
}
process.exitCode = result.reference.scored_divergence_count === 0
  && result.surviving_mutants.length === 0
  && result.infrastructure_failures.length === 0 ? 0 : 1;

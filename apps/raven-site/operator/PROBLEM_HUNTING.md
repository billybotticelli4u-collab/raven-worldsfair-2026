# Problem hunting (HyperAgent/Gemini lesson: hunt problems, don't wait)

Weekly: `node scripts/raven-problem-hunt.mjs` (reads private/ if present,
degrades to templates; never needs secrets).

How to read the report:
- Repeated missing-evidence requests = the next engine phase, measured. Three
  leads asking for deployer history outranks any idea we have internally.
- Repeated roles/use cases = the beachhead refining itself. Double down.
- Stalled leads / tokens with no verdict sent = OUR failure; fix same day.
- Eval/smoke failures = build orders (contract breach with the public).
- Beta users with repeat usage = ask THEM what's missing; they're the loop.
- Beta users without repeat usage = interview before building anything.
- Out-of-scope requests = decline with operator/templates/access-declined-
  out-of-scope.md; log the pattern anyway (it maps the market's confusion).

Hard rules baked into the script: it never suggests P3-4 unless feedback
explicitly demands deployer history; never suggests global holder enablement
unless beta evidence supports it.

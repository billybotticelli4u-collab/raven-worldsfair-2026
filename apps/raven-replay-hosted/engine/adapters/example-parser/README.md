# Registering an example parser (no Raven engine edit)

1. Add your script under `adapters/<your-name>/` (relative path only).
2. Append an entry to `adapters/registry.json` with a new `id`, `entrypoint` relative to `adapters/`, `output_contract`, and `dependency_packages` (empty if none).
3. If you need npm packages, add them to the package root `package.json`, pin with the lockfile, and list those package names in `dependency_packages` so the installed-file inventory is bound.
4. Do **not** modify `src/cases.mjs`, `src/runner.mjs`, or comparison logic.
5. Cases must only reference the registered `id`. Cases never install packages or embed paths/commands.

Synthetic v1/v2 demonstrate a controlled output field change for `compare-versions`. They are not a customer integration or SDK vulnerability finding.

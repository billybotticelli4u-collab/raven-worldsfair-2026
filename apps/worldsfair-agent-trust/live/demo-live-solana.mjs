// Entry point for `npm run demo:live-solana`. See LIVE-SOLANA.md.
import { runLiveSolanaCli } from "./cli.js";

process.exitCode = await runLiveSolanaCli({
  argv: process.argv.slice(2),
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
});

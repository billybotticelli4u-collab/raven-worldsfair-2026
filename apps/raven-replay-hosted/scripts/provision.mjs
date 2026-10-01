// Operator-only snapshot construction. Never called by a public endpoint.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
const root = new URL("../", import.meta.url);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const nodeTarSha =
  "a2e703725d8683be86bb5da967bf8272f4518bdaf10f21389e2b2c9eaeae8c8a";
const nodeTar = "node-v22.18.0-linux-x64.tar.gz";

export async function provision(credentials = {}, record = () => {}) {
  const manifest = JSON.parse(
    readFileSync(new URL("ENGINE-SOURCE.json", root)),
  );
  const assembly = JSON.parse(readFileSync(new URL("ENGINE-ASSEMBLY.json", root)));
  if (assembly.base_source_manifest_sha256 !== sha(readFileSync(new URL("ENGINE-SOURCE.json", root)))) throw Error("assembly source mismatch");
  const files = assembly.files.map((item) => {
    if (
      !/^[a-zA-Z0-9_./-]+$/.test(item.path) ||
      item.path.split("/").includes("..")
    )
      throw Error("invalid source path");
    const content = readFileSync(new URL("engine/" + item.path, root));
    if (sha(content) !== item.sha256) throw Error("source mismatch");
    return { path: "/vercel/sandbox/app/engine/" + item.path, content };
  });
  const pin = {
    schema: "raven-hosted-engine-pin/1",
    source_commit: manifest.source_commit,
    source_manifest_sha256: sha(
      readFileSync(new URL("ENGINE-SOURCE.json", root)),
    ),
    node_tar_sha256: nodeTarSha,
    node_version: "v22.18.0",
    assembly_manifest_sha256: sha(readFileSync(new URL("ENGINE-ASSEMBLY.json", root))),
    engine_files: assembly.files,
  };
  const pinHash = sha(JSON.stringify(pin));
  let box, snapshot;
  try {
    box = await Sandbox.create({
      ...credentials,
      image: "vercel/sandbox/node:22",
      persistent: false,
      timeout: 300000,
      resources: { vcpus: 2 },
      ports: [],
      env: {},
      networkPolicy: { allow: ["nodejs.org", "registry.npmjs.org"] },
      signal: AbortSignal.timeout(60000),
    });
    record({ stage: "created", sandbox: box.name });
    await box.writeFiles([
      ...files,
      {
        path: "/vercel/sandbox/app/package.json",
        content: '{"type":"module","private":true}',
      },
      { path: "/vercel/sandbox/engine-pin.json", content: JSON.stringify(pin) },
    ]);
    const installer = `import {writeFileSync,readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {gunzipSync} from 'node:zlib';
const response=await fetch('https://nodejs.org/dist/v22.18.0/${nodeTar}',{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('download');const tar=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(tar).digest('hex')!=='${nodeTarSha}')throw Error('checksum');writeFileSync('/vercel/sandbox/node.tar',gunzipSync(tar));execFileSync('tar',['-xf','/vercel/sandbox/node.tar','-C','/vercel/sandbox']);execFileSync('mv',['/vercel/sandbox/node-v22.18.0-linux-x64','/vercel/sandbox/node']);const node='/vercel/sandbox/node/bin/node';if(execFileSync(node,['--version'],{encoding:'utf8'}).trim()!=='v22.18.0')throw Error('version');execFileSync(node,['/vercel/sandbox/node/lib/node_modules/npm/bin/npm-cli.js','ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:'/vercel/sandbox/app/engine',env:{PATH:'/vercel/sandbox/node/bin:/usr/bin:/bin',HOME:'/vercel/sandbox',npm_config_registry:'https://registry.npmjs.org/'},stdio:'pipe'});console.log('PINNED_ENGINE_INSTALLED');`;
    await box.writeFiles([
      { path: "/vercel/sandbox/install.mjs", content: installer },
    ]);
    const install = await box.runCommand({
      cmd: "node",
      args: ["/vercel/sandbox/install.mjs"],
      timeoutMs: 180000,
    });
    if (install.exitCode !== 0) {
      record({
        stage: "install_failed",
        exit: install.exitCode,
        stderr: (await install.stderr()).slice(0, 4000),
      });
      throw Error("snapshot install failed");
    }
    record({ stage: "installed", result: (await install.stdout()).trim() });
    const suite = await box.runCommand({
      cmd: "/vercel/sandbox/node/bin/node",
      args: [
        "/vercel/sandbox/node/lib/node_modules/npm/bin/npm-cli.js",
        "test",
      ],
      cwd: "/vercel/sandbox/app/engine",
      env: { PATH: "/vercel/sandbox/node/bin:/usr/bin:/bin" },
      timeoutMs: 60000,
    });
    record({
      stage: "suite",
      exit: suite.exitCode,
      stdout: await suite.stdout(),
      stderr: await suite.stderr(),
    });
    if (suite.exitCode !== 0) throw Error("engine suite failed");
    await box.update({ networkPolicy: "deny-all" });
    snapshot = await box.snapshot({ expiration: 7 * 24 * 60 * 60 * 1000 });
    return {
      ...pin,
      engine_pin_sha256: pinHash,
      snapshot_id: snapshot.snapshotId,
      snapshot_status: snapshot.status,
      source_sandbox: box.name,
    };
  } finally {
    if (box && !snapshot) {
      const stopped = await box.stop({ signal: AbortSignal.timeout(10000) });
      record({ stage: "cleanup", status: stopped.status });
    }
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = new URL('../../../', import.meta.url);
// Probe only the new launcher's process group; no process command lines or environments.
const groupExists = group => {
  try { process.kill(-group, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; if (error.code === 'EPERM') return true; throw error; }
};

for (const signal of ['SIGTERM', 'SIGKILL']) for (const viaNpm of [true, false]) for (const load of ['idle', 'incomplete body', 'active profile']) test(`${signal} to ${viaNpm ? 'npm' : 'non-forwarding launcher'} leaves no onboarding server (${load})`, { timeout: 15000, skip: signal === 'SIGKILL' && !viaNpm && process.platform !== 'linux' ? 'Linux /proc ancestry regression; needs fresh Linux execution' : false }, async () => {
  assert.notEqual(process.platform, 'win32', 'POSIX launcher regression needs process-group signals');
  const fixture = signal === 'SIGKILL'
    // Keep a real shell between the killed launcher and server, as on Linux npm.
    ? `import { spawn } from 'node:child_process'; spawn('/bin/sh', ['-c', '"$1" --experimental-strip-types apps/raven-onboarding/server.mjs; :', 'raven-launcher-fixture', process.execPath], { stdio: ['ignore', 'inherit', 'inherit'] });`
    : "import { spawn } from 'node:child_process'; spawn(process.execPath, ['--experimental-strip-types', 'apps/raven-onboarding/server.mjs'], { stdio: ['ignore', 'inherit', 'inherit'] });";
  const child = spawn(viaNpm ? 'npm' : process.execPath, viaNpm ? ['run', 'onboarding'] : ['--input-type=module', '-e', fixture], { cwd: root, env: { ...process.env, PORT: '0' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  let output = '', socket, running;
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  try {
    const deadline = Date.now() + 5000;
    while (!output.match(/http:\/\/127\.0\.0\.1:\d+/) && Date.now() < deadline) await wait(10);
    const base = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(base, output);
    assert.equal((await fetch(base + '/api/setup')).status, 200);
    if (load === 'incomplete body') {
      const url = new URL(base);
      socket = net.connect(Number(url.port), '127.0.0.1'); socket.on('error', () => {});
      await new Promise(resolve => socket.once('connect', resolve));
      socket.write(`POST /api/receipt HTTP/1.1\r\nHost: ${url.host}\r\nContent-Length: 1000\r\n\r\n{`);
    }
    if (load === 'active profile') {
      const post = (endpoint, body) => fetch(base + endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      running = post('/api/conformance', { target: 'SOL_BROKEN_SUBTLE' }).then(r => r.text()).catch(() => 'connection closed');
      let busy = false;
      const until = Date.now() + 3000;
      while (Date.now() < until) {
        const response = await post('/api/receipt', { path: 'path_a_verified' }); await response.text();
        if (response.status === 409) { busy = true; break; }
      }
      assert.equal(busy, true, 'signal occurs only after the server confirms an active run');
    }
    child.kill(signal); await exited;
    const until = Date.now() + 3000;
    while (groupExists(child.pid) && Date.now() < until) await wait(25);
    const remaining = groupExists(child.pid);
    console.log('LAUNCHER_CLEANUP', JSON.stringify({ signal, viaNpm, load, remaining }));
    assert.equal(remaining, false, 'terminating npm must not leave its loopback server or engine children');
    await assert.rejects(fetch(base + '/api/setup'), 'listener must be gone');
  } finally {
    socket?.destroy();
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await wait(200);
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await exited; await running;
  }
});

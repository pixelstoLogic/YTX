/* Temporary diagnostic: read brave://policy and extension install state through CDP. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const executable = process.argv[2];
const port = 9333;
const profile = path.join(os.tmpdir(), 'ytx-browser-policy-probe');
if (fs.existsSync(profile)) fs.rmSync(profile, { recursive: true, force: true });
const child = spawn(executable, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--headless=new',
  'about:blank'
], { windowsHide: true, stdio: 'ignore' });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForDebugger() {
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('debugger did not start');
}

async function evaluate(target, expression) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const send = (method, params = {}) => new Promise(resolve => {
    const callId = ++id;
    pending.set(callId, resolve);
    ws.send(JSON.stringify({ id: callId, method, params }));
  });
  await send('Runtime.enable');
  await sleep(1200);
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  ws.close();
  return result.result?.result?.value;
}

(async () => {
  try {
    await waitForDebugger();
    const created = await fetch(`http://127.0.0.1:${port}/json/new?brave://policy`, { method: 'PUT' }).then(r => r.json());
    await sleep(2500);
    const text = await evaluate(created, 'document.body.innerText');
    console.log(String(text || '').slice(0, 12000));
    const extension = await fetch(`http://127.0.0.1:${port}/json/new?brave://extensions`, { method: 'PUT' }).then(r => r.json());
    await sleep(2000);
    console.log('\n--- EXTENSIONS ---\n');
    console.log(String(await evaluate(extension, 'document.body.innerText') || '').slice(0, 5000));
    const probe = await fetch(`http://127.0.0.1:${port}/json/new?chrome-extension://ibbnkdcefianlglmenklhmcoeiolpjjb/manifest.json`, { method: 'PUT' }).then(r => r.json());
    await sleep(2500);
    console.log('\n--- EXTENSION MANIFEST ---\n');
    console.log(String(await evaluate(probe, 'document.body.innerText') || '').slice(0, 3000));
  } catch (error) {
    console.error(error);
  } finally {
    child.kill();
  }
})();

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const exe = process.argv[2];
const profile = path.join(os.tmpdir(), 'ytx-brave-log-probe');
if (fs.existsSync(profile)) fs.rmSync(profile, { recursive: true, force: true });
const child = spawn(exe, [
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--headless=new',
  '--enable-logging=stderr',
  '--v=1',
  'about:blank'
], { windowsHide: true });
let buffer = '';
child.stderr.on('data', chunk => {
  buffer += chunk.toString();
  for (const line of buffer.split(/\r?\n/)) {
    if (/ibbnkdcefianlglmenklhmcoeiolpjjb|extension|crx|policy|install/i.test(line)) console.log(line);
  }
  buffer = buffer.split(/\r?\n/).pop();
});
child.stdout.on('data', chunk => process.stdout.write(chunk));
setTimeout(() => {
  child.kill();
  setTimeout(() => process.exit(0), 500);
}, 25000);

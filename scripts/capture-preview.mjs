// Regenerates public/og-image.png, the 1200x630 image shown in link previews.
// Opens the live site in headless Chrome at exactly 1200x630, hides the page's
// buttons, and saves a screenshot.
//
// Usage: npm run preview-image -- "<path to chrome.exe>" <temp profile dir> https://alozich.github.io/anns-shelf/ public/og-image.png 60
// (the last number scrolls down a little so the lower shelves fit)
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [chromePath, profile, url, out, scrollY = '0'] = process.argv.slice(2);
const port = 9333;
const chrome = spawn(chromePath, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--hide-scrollbars', '--no-first-run', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch {}
  }
  if (!target) throw new Error('Chrome did not start');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((r) => {
    const mid = ++id; pending.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(9000); // textures, covers and fonts
  await send('Runtime.evaluate', { expression: `
    for (const el of document.querySelectorAll('#info, #sound, #label')) el.style.display = 'none';
    window.scrollTo(0, ${Number(scrollY)});
  ` });
  await sleep(1500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', out);
  ws.close();
} finally {
  chrome.kill();
}

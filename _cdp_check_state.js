const http = require('http');
const WebSocket = require('ws');
const PORT = 9222;

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}/json`, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

function evalInPage(ws, expression) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const onMsg = (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id === id) {
        ws.removeListener('message', onMsg);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result.result);
      }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });
}

async function main() {
  let targets;
  for (let i = 0; i < 20; i++) {
    try { targets = await getTargets(); break; } catch (e) { await new Promise(r => setTimeout(r, 500)); }
  }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });

  // give the app's async init a moment
  await new Promise(r => setTimeout(r, 1500));

  const state = await evalInPage(ws, `(() => ({
    currentFileName: (typeof currentFile !== 'undefined') ? currentFile.name : null,
    editorValueStart: document.getElementById('mdEditor')?.value.slice(0, 30),
    dataView: document.getElementById('editorArea')?.getAttribute('data-view'),
    editorHidden: document.getElementById('editorPane')?.classList.contains('hidden'),
    previewHidden: document.getElementById('previewPane')?.classList.contains('hidden'),
    activeFileItem: document.querySelector('.file-item.active')?.dataset.path || null,
    fileListFirst: document.querySelector('#file-list .file-item')?.dataset.path || null,
    welcomeVisible: !document.getElementById('welcome-screen')?.classList.contains('hidden')
  }))()`);
  console.log('STATE:', state);
  ws.close();
}

main().then(() => process.exit(0)).catch(err => { console.error('FAILED:', err); process.exit(1); });

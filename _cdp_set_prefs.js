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
  const targets = await getTargets();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });

  const folder = process.argv[2];
  const result = await evalInPage(ws, `(() => {
    localStorage.setItem('launchBehavior', 'first-file');
    localStorage.setItem('startupMode', 'split');
    localStorage.setItem('lastFolder', ${JSON.stringify(folder)});
    return {
      launchBehavior: localStorage.getItem('launchBehavior'),
      startupMode: localStorage.getItem('startupMode'),
      lastFolder: localStorage.getItem('lastFolder')
    };
  })()`);
  console.log('PREFS SET:', result);
  ws.close();
}

main().then(() => process.exit(0)).catch(err => { console.error('FAILED:', err); process.exit(1); });

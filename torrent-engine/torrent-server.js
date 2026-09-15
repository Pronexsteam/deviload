'use strict';
// Streams a torrent's video over HTTP (sequential download into %TEMP%, the full file is not kept).
// Run: node torrent-server.js <argPath> <port>
//   <argPath> = path to a .torrent OR path to a .txt that contains a magnet link
// Prints to stdout: "STREAM <url>" and "NAME <file name>".
const WebTorrent = require('webtorrent');
const fs = require('fs');
const os = require('os');
const path = require('path');

const arg = process.argv[2];
const port = parseInt(process.argv[3] || '8910', 10);
if (!arg) { console.error('ERR no input'); process.exit(1); }

let id;
try {
  if (arg.toLowerCase().endsWith('.torrent')) { id = arg; }
  else { id = fs.readFileSync(arg, 'utf8').trim(); }
} catch (e) { console.error('ERR cannot read input: ' + e.message); process.exit(1); }
if (!id) { console.error('ERR empty input'); process.exit(1); }

const tmp = path.join(os.tmpdir(), 'ytui_torrent');
try { fs.mkdirSync(tmp, { recursive: true }); } catch (e) {}

const VIDEO_EXT = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.flv', '.wmv', '.ts', '.m2ts', '.mpg', '.mpeg'];

let serving = false;
// do not crash on non-critical errors — otherwise the HTTP server dies and the player gets "connection refused"
process.on('uncaughtException', e => { console.error('WARN uncaught: ' + (e && e.message ? e.message : e)); });
process.on('unhandledRejection', e => { console.error('WARN rejection: ' + e); });

const client = new WebTorrent();
client.on('error', err => {
  const m = (err && err.message) ? err.message : ('' + err);
  if (serving) { console.error('WARN client: ' + m); return; } // already streaming — keep going
  console.error('ERR ' + m);
  process.exit(1);
});

console.log('STATE adding');

client.add(id, { path: tmp }, torrent => {
  console.log('STATE metadata');
  let vids = torrent.files.filter(f => VIDEO_EXT.indexOf(path.extname(f.name).toLowerCase()) !== -1);
  let pool = vids.length ? vids : torrent.files;
  let file = pool.reduce((a, b) => (a && a.length > b.length) ? a : b, null);
  if (!file) { console.error('ERR no files'); process.exit(1); }
  torrent.files.forEach(f => { try { f.deselect(); } catch (e) {} });
  try { file.select(); } catch (e) {}
  const idx = torrent.files.indexOf(file);
  try {
    const server = torrent.createServer();
    server.on('error', e => console.error('WARN server: ' + (e && e.message ? e.message : e)));
    server.listen(port, '127.0.0.1', () => {
      serving = true;
      console.log('STREAM http://127.0.0.1:' + port + '/' + idx);
      console.log('NAME ' + file.name);
    });
  } catch (e) { console.error('ERR server: ' + e.message); process.exit(1); }
});

// timeout applies only while there is NO metadata/stream yet (no peers)
setTimeout(() => { if (!serving) { console.error('ERR timeout (no peers?)'); process.exit(1); } }, 150000);

// keep the process alive until the app closes it
setInterval(() => {}, 1 << 30);

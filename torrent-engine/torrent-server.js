'use strict';
// Стримит видео из торрента по HTTP (последовательно, в temp — без хранения полного файла).
// Запуск: node torrent-server.js <argPath> <port>
//   <argPath> = путь к .torrent ЛИБО путь к .txt с magnet-ссылкой внутри
// В stdout печатает: "STREAM <url>" и "NAME <имя файла>".
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
// не падаем на некритичных ошибках — иначе HTTP-сервер умирает и плеер ловит "отказано в подключении"
process.on('uncaughtException', e => { console.error('WARN uncaught: ' + (e && e.message ? e.message : e)); });
process.on('unhandledRejection', e => { console.error('WARN rejection: ' + e); });

const client = new WebTorrent();
client.on('error', err => {
  const m = (err && err.message) ? err.message : ('' + err);
  if (serving) { console.error('WARN client: ' + m); return; } // уже стримим — не валимся
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

// таймаут только пока НЕТ метаданных/стрима (нет пиров)
setTimeout(() => { if (!serving) { console.error('ERR timeout (no peers?)'); process.exit(1); } }, 150000);

// держим процесс живым, пока приложение само его не закроет
setInterval(() => {}, 1 << 30);

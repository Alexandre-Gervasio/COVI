const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const ICON = path.join(__dirname, 'build', 'icon.png');
const DOWNLOADS = () => app.getPath('downloads');
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
let prefs = { format: 'jpg', watch: true };
let win = null, tray = null, popup = null, quitting = false, watcher = null;
let known = new Set(), pending = [], flushTimer = null, queue = [];

function loadPrefs() { try { prefs = { ...prefs, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) }; } catch (e) {} }
function savePrefs() { try { fs.writeFileSync(prefsFile(), JSON.stringify(prefs)); } catch (e) {} }
const webPrefs = { preload: path.join(__dirname, 'preload.js') };

function openMain() {
  if (win) { win.show(); win.focus(); return; }
  win = new BrowserWindow({ width: 760, height: 820, icon: ICON, webPreferences: webPrefs });
  win.setMenuBarVisibility(false);
  win.loadFile('index.html');
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
}

// ---------- monitoramento da pasta Downloads ----------
const isHeic = (n) => /\.(heic|heif)$/i.test(n || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitStable(p) {
  let last = -1;
  for (let i = 0; i < 60; i++) {
    let s; try { s = fs.statSync(p); } catch (e) { return false; }
    if (s.size > 0 && s.size === last) return true;
    last = s.size; await sleep(1000);
  }
  return false;
}

function startWatch() {
  stopWatch();
  if (!prefs.watch) return;
  const dir = DOWNLOADS();
  try { known = new Set(fs.readdirSync(dir).filter(isHeic).map((n) => path.join(dir, n))); } catch (e) {}
  try {
    watcher = fs.watch(dir, async (ev, name) => {
      if (!isHeic(name)) return;
      const p = path.join(dir, name);
      if (known.has(p) || !fs.existsSync(p)) return;
      known.add(p);
      if (!(await waitStable(p))) { known.delete(p); return; }
      pending.push(p);
      clearTimeout(flushTimer);
      flushTimer = setTimeout(() => { queue.push(pending); pending = []; next(); }, 2500);
    });
  } catch (e) {}
}
function stopWatch() { if (watcher) { watcher.close(); watcher = null; } }

function next() {
  if (popup || !queue.length) return;
  const files = queue.shift();
  popup = new BrowserWindow({
    width: 400, height: 280, show: false, alwaysOnTop: true, resizable: false,
    minimizable: false, maximizable: false, skipTaskbar: true, title: 'Foto HEIC detectada',
    icon: ICON, webPreferences: webPrefs
  });
  popup.setMenuBarVisibility(false);
  const { workArea } = require('electron').screen.getPrimaryDisplay();
  popup.setPosition(workArea.x + workArea.width - 420, workArea.y + workArea.height - 300);
  popup.loadFile('prompt.html', { query: { files: JSON.stringify(files) } });
  popup.once('ready-to-show', () => popup.showInactive());
  popup.on('closed', () => { popup = null; next(); });
}

// ---------- bandeja ----------
function buildMenu() {
  const items = [
    { label: 'Abrir conversor', click: openMain },
    { label: 'Avisar quando baixar fotos HEIC', type: 'checkbox', checked: prefs.watch,
      click: (m) => { prefs.watch = m.checked; savePrefs(); startWatch(); } }
  ];
  if (process.platform !== 'linux') {
    items.push({ label: 'Iniciar com o sistema', type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (m) => app.setLoginItemSettings({ openAtLogin: m.checked, args: ['--hidden'] }) });
  }
  items.push({ type: 'separator' }, { label: 'Sair', click: () => { quitting = true; app.quit(); } });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', openMain);

app.whenReady().then(() => {
  loadPrefs();
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 18, height: 18 }));
  tray.setToolTip('COVI');
  tray.on('click', openMain);
  buildMenu();
  const hidden = process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin;
  if (!hidden) openMain();
  startWatch();
});
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {});

// ---------- IPC ----------
ipcMain.handle('save', async (e, name, buf) => {
  const r = await dialog.showSaveDialog({ defaultPath: name });
  if (r.canceled) return false;
  fs.writeFileSync(r.filePath, Buffer.from(buf));
  return true;
});
ipcMain.handle('saveAll', async (e, files) => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return 0;
  for (const f of files) fs.writeFileSync(path.join(r.filePaths[0], path.basename(f.name)), Buffer.from(f.buf));
  return files.length;
});
ipcMain.handle('readFile', (e, p) => fs.readFileSync(p));
ipcMain.handle('writeNext', (e, orig, ext, buf) => {
  const dir = path.dirname(orig), base = path.basename(orig, path.extname(orig));
  let out = path.join(dir, base + '.' + ext), n = 1;
  while (fs.existsSync(out)) out = path.join(dir, `${base} (${n++}).${ext}`);
  fs.writeFileSync(out, Buffer.from(buf));
  return out;
});
ipcMain.handle('getPrefs', () => prefs);
ipcMain.handle('setFormat', (e, f) => { prefs.format = f; savePrefs(); });
ipcMain.handle('closePopup', () => { if (popup) popup.close(); });

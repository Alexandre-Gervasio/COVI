const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, Notification, shell } = require('electron');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const registerImageConverterIpc = require('./src/main/image-converter');
const createPreferences = require('./src/main/preferences');
const createDownloadMonitor = require('./src/main/download-monitor');
const createNotifier = require('./src/main/notifications');
const createUpdater = require('./src/main/updater');

const ICON = path.join(__dirname, 'build', 'icon.png');
const DOWNLOADS = () => app.getPath('downloads');
const preferences = createPreferences({ app, fs, path, crypto: require('crypto') });
const prefs = preferences.get();
const loadPrefs = preferences.load;
const savePrefs = preferences.save;
const setAutoStart = preferences.setAutoStart;
let win = null, tray = null, quitting = false, updateManager = null;


const webPrefs = { preload: path.join(__dirname, 'preload.js') };
const showNotice = createNotifier({ dialog, Notification, icon: ICON, getWindow: () => win });
const downloadMonitor = createDownloadMonitor({
  BrowserWindow, screen: require('electron').screen, fs, path, icon: ICON, webPrefs,
  getDownloads: DOWNLOADS, isWatchEnabled: () => prefs.watch
});

function openMain() {
  if (win) { win.show(); win.focus(); return; }
  win = new BrowserWindow({ width: 760, height: 820, icon: ICON, webPreferences: webPrefs });
  win.setMenuBarVisibility(false);
  win.loadFile('index.html');
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
}

// ---------- bandeja ----------
function buildMenu() {
  const items = [
    { label: 'Abrir conversor', click: openMain },
    { label: 'Verificar atualizações', click: () => updateManager.checkForUpdates(true) },
    ...(updateManager && updateManager.getReadyVersion() ? [{ label: `Reiniciar para atualizar para ${updateManager.getReadyVersion()}`, click: () => autoUpdater.quitAndInstall(false, true) }] : []),
    { label: 'Avisar quando baixar fotos HEIC', type: 'checkbox', checked: prefs.watch,
      click: (m) => { prefs.watch = m.checked; savePrefs(); downloadMonitor.startWatch(); } },
    { label: 'Iniciar com o sistema', type: 'checkbox', checked: prefs.autoStart,
      click: (m) => {
        try {
          setAutoStart(m.checked);
          prefs.autoStart = m.checked;
          savePrefs();
        } catch (error) {
          console.error('Não foi possível alterar a inicialização automática do C.O.V.I.:', error);
          showNotice('Falha ao alterar a inicialização automática', 'Verifique as permissões do usuário e tente novamente.');
        }
        buildMenu();
      } }
  ];
  items.push({ type: 'separator' }, { label: 'Sair', click: () => { quitting = true; app.quit(); } });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', openMain);

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.alexandre.conversorheic');
  loadPrefs();
  try {
    setAutoStart(prefs.autoStart);
  } catch (error) {
    console.error('Não foi possível ativar a inicialização automática do C.O.V.I.:', error);
    showNotice('Falha ao ativar a inicialização automática', 'Você pode ativá-la depois pelo menu da bandeja.');
  }
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 18, height: 18 }));
  tray.setToolTip('C.O.V.I.');
  tray.on('click', openMain);
  buildMenu();
  const hidden = process.argv.includes('--hidden') ||
    (process.platform !== 'linux' && app.getLoginItemSettings().wasOpenedAtLogin);
  if (!hidden) openMain();
  downloadMonitor.startWatch();
  updateManager = createUpdater({
    app, autoUpdater, https, shell, showNotice,
    getPreferences: () => prefs, savePreferences: savePrefs, buildMenu,
    onStatus: (status) => { if (win && !win.isDestroyed()) win.webContents.send('update:status', status); }
  });
  updateManager.startUpdateChecks();
});
app.on('before-quit', () => { quitting = true; if (updateManager) updateManager.stop(); });
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
ipcMain.handle('getVersion', () => app.getVersion());
ipcMain.handle('update:getStatus', () => updateManager ? updateManager.getStatus() : { state: 'idle', message: '' });
ipcMain.handle('update:action', () => updateManager.performAction());
registerImageConverterIpc(ipcMain);
ipcMain.handle('closePopup', () => downloadMonitor.closePopup());

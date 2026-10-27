const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, Notification, shell } = require('electron');
const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');
const sharp = require('sharp');

const ICON = path.join(__dirname, 'build', 'icon.png');
const DOWNLOADS = () => app.getPath('downloads');
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
const RELEASES_API = 'https://api.github.com/repos/Alexandre-Gervasio/COVI/releases/latest';
const RELEASES_PAGE = 'https://github.com/Alexandre-Gervasio/COVI/releases/latest';
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const LOSSLESS_SPACES = ['srgb', 'rgb', 'rgb16', 'b-w', 'grey16'];
const LOSSLESS_FORMATS = [
  { id: 'png', encoder: 'png', extension: 'png', label: 'PNG (sem perda)', spaces: LOSSLESS_SPACES },
  { id: 'tiff', encoder: 'tiff', extension: 'tiff', label: 'TIFF sem compressão' },
  { id: 'webp', encoder: 'webp', extension: 'webp', label: 'WebP lossless', spaces: ['srgb'], depth: 'uchar' },
  { id: 'avif-lossless', encoder: 'heif', extension: 'avif', label: 'AVIF lossless', spaces: ['srgb'], depth: 'uchar' }
];
const LOSSY_FORMATS = [
  { id: 'jpg', encoder: 'jpeg', extension: 'jpg', label: 'JPG (com perda)' },
  { id: 'webp-lossy', encoder: 'webp', extension: 'webp', label: 'WebP (com perda)' },
  { id: 'avif', encoder: 'heif', extension: 'avif', label: 'AVIF (com perda)' },
  { id: 'gif', encoder: 'gif', extension: 'gif', label: 'GIF (com perda, até 256 cores)' }
];
const INPUT_FORMATS = {
  jpeg: ['jpg', 'jpeg', 'jpe'],
  png: ['png'],
  webp: ['webp'],
  tiff: ['tif', 'tiff', 'tf8', 'btf', 'btif'],
  gif: ['gif'],
  heif: ['heic', 'heif', 'hif', 'avif'],
};
let prefs = { watch: true, autoStart: true };
let win = null, tray = null, popup = null, quitting = false, watcher = null;
let known = new Set(), pending = [], flushTimer = null, queue = [];
let updateCheckTimer = null, updateCheckInProgress = false, releaseCheckInProgress = false;
let manualUpdateCheck = false, updateReadyVersion = null;

function loadPrefs() { try { prefs = { ...prefs, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) }; } catch (e) {} }
function savePrefs() { try { fs.writeFileSync(prefsFile(), JSON.stringify(prefs)); } catch (e) {} }
const webPrefs = { preload: path.join(__dirname, 'preload.js') };

function quoteDesktopExec(value) {
  return `"${value.replace(/([\\`"$])/g, '\\$1').replace(/%/g, '%%')}"`;
}

function setAutoStart(enabled) {
  if (!app.isPackaged) return;
  if (process.platform !== 'linux') {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
    return;
  }

  const folder = path.join(app.getPath('home'), '.config', 'autostart');
  const entry = path.join(folder, 'com.alexandre.conversorheic.desktop');
  if (!enabled) {
    if (fs.existsSync(entry)) fs.unlinkSync(entry);
    return;
  }

  fs.mkdirSync(folder, { recursive: true });
  const executable = process.env.APPIMAGE && fs.existsSync(process.env.APPIMAGE)
    ? process.env.APPIMAGE
    : app.getPath('exe');
  const contents = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=C.O.V.I.',
    `Exec=${quoteDesktopExec(executable)} --hidden`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    ''
  ].join('\n');
  const temporary = `${entry}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, contents, { flag: 'wx' });
  try {
    fs.renameSync(temporary, entry);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch (cleanupError) {
      console.error('Não foi possível remover o arquivo temporário de inicialização:', cleanupError);
    }
    throw error;
  }
}

function getSupportedImageExtensions() {
  return Object.entries(INPUT_FORMATS)
    .filter(([format]) => sharp.format[format] && sharp.format[format].input.file)
    .flatMap(([, extensions]) => extensions)
    .sort();
}

function getInputFormat(filePath) {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  return Object.entries(INPUT_FORMATS).find(([format, extensions]) =>
    extensions.includes(extension) && sharp.format[format] && sharp.format[format].input.file
  )?.[0];
}

function getAvailableFormats(formats) {
  return formats.filter((format) => sharp.format[format.encoder]?.output.file);
}

function getLosslessTargets(metadata) {
  if ((metadata.pages || 1) > 1) return [];
  if (!['uchar', 'ushort'].includes(metadata.depth)) return [];
  if (!LOSSLESS_SPACES.includes(metadata.space)) return [];
  return getAvailableFormats(LOSSLESS_FORMATS)
    .filter((format) => (!format.spaces || format.spaces.includes(metadata.space)) &&
      (!format.depth || format.depth === metadata.depth) &&
      (format.id !== 'tiff' || ['uchar', 'ushort'].includes(metadata.depth)))
    .map(({ id, label }) => ({ id, label }));
}

async function getImageConversionInfo(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new Error('Caminho de arquivo inválido.');
  }
  const inputFormat = getInputFormat(filePath);
  if (!inputFormat) throw new Error('Formato de entrada não suportado por esta versão do C.O.V.I.');
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) throw new Error('O caminho selecionado não é um arquivo.');
  const metadata = await sharp(filePath, { animated: true }).metadata();
  const losslessTargets = getLosslessTargets(metadata);
  const targets = (metadata.pages || 1) > 1 || !['uchar', 'ushort'].includes(metadata.depth)
    ? losslessTargets
    : losslessTargets.concat(getAvailableFormats(LOSSY_FORMATS).map(({ id, label }) => ({ id, label })));
  let reason = '';
  if ((metadata.pages || 1) > 1) reason = 'Animações e imagens com várias páginas são recusadas para não descartar quadros.';
  else if (!['uchar', 'ushort'].includes(metadata.depth)) reason = `Profundidade de cor ${metadata.depth} não pode ser preservada com segurança.`;
  else if (!LOSSLESS_SPACES.includes(metadata.space)) reason = `Espaço de cor ${metadata.space} não pode ser preservado com segurança.`;
  else if (!targets.length) reason = 'Nenhum formato de saída compatível e sem perda está disponível para esta imagem.';
  return {
    width: metadata.width,
    height: metadata.height,
    channels: metadata.channels,
    depth: metadata.depth,
    space: metadata.space,
    hasAlpha: metadata.hasAlpha,
    pages: metadata.pages || 1,
    losslessTargets,
    targets,
    reason
  };
}

function writeAtomically(filePath, contents) {
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  try {
    fs.writeFileSync(temporary, contents, { flag: 'wx' });
    fs.renameSync(temporary, filePath);
  } catch (error) {
    if (fs.existsSync(temporary)) {
      try { fs.unlinkSync(temporary); } catch (cleanupError) {
        console.error('Não foi possível remover o arquivo temporário de conversão:', cleanupError);
      }
    }
    throw error;
  }
}

function replaceOriginal(filePath, extension, contents) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new Error('Caminho de arquivo inválido.');
  }
  const allowedFormats = [...LOSSLESS_FORMATS, ...LOSSY_FORMATS];
  if (!allowedFormats.some((format) => format.extension === extension)) {
    throw new Error('Formato de saída inválido.');
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('O caminho selecionado não é um arquivo.');

  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  const normalize = (candidate) => process.platform === 'win32'
    ? path.resolve(candidate).toLowerCase()
    : path.resolve(candidate);
  const sameFile = (candidate) => normalize(candidate) === normalize(filePath);
  let destination = path.join(dir, `${base}.${extension}`);
  const replacingInPlace = sameFile(destination);
  let suffix = 1;
  while (!replacingInPlace && fs.existsSync(destination)) {
    destination = path.join(dir, `${base} (${suffix++}).${extension}`);
  }

  writeAtomically(destination, Buffer.from(contents));
  if (!replacingInPlace) {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      throw new Error(`A conversão foi salva em ${destination}, mas o original não pôde ser removido: ${error.message}`);
    }
  }
  return destination;
}

function compareVersions(a, b) {
  const parse = (version) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
    if (!match) throw new Error(`Versão inválida recebida do GitHub: ${version}`);
    return match.slice(1).map(Number);
  };
  const left = parse(a), right = parse(b);
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

function showNotice(title, body, button, onClick) {
  if (Notification.isSupported()) {
    const notification = new Notification({ title, body, icon: ICON });
    if (onClick) notification.on('click', onClick);
    notification.show();
    return;
  }
  const options = { type: 'info', title, message: body, buttons: onClick ? [button, 'Depois'] : ['OK'], cancelId: onClick ? 1 : 0 };
  const parent = win && !win.isDestroyed() ? win : undefined;
  const messageBox = parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
  messageBox.then(({ response }) => {
    if (onClick && response === 0) onClick();
  }).catch((error) => console.error('Não foi possível exibir o aviso de atualização:', error));
}

function getLatestRelease() {
  return new Promise((resolve, reject) => {
    const request = https.get(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'COVI-updater' }
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`GitHub respondeu com HTTP ${response.statusCode}`));
        return;
      }
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
      });
    });
    request.setTimeout(10000, () => request.destroy(new Error('Tempo limite ao consultar atualizações')));
    request.on('error', reject);
  });
}

function notifyManualUpdate(version, releaseUrl, force = false) {
  if (!force && prefs.lastUpdateNotice === version) return;
  prefs.lastUpdateNotice = version;
  savePrefs();
  showNotice(
    'Atualização do C.O.V.I. disponível',
    `A versão ${version} está disponível. Clique para abrir a página de download.`,
    'Baixar atualização',
    () => shell.openExternal(releaseUrl).catch((error) => console.error('Não foi possível abrir o download:', error))
  );
}

async function checkManualUpdate(manual) {
  if (releaseCheckInProgress) return;
  releaseCheckInProgress = true;
  try {
    const release = await getLatestRelease();
    const version = release.tag_name;
    if (compareVersions(version, app.getVersion()) > 0) {
      if (manual || prefs.lastUpdateNotice !== version) notifyManualUpdate(version, release.html_url || RELEASES_PAGE, manual);
    } else if (manual) {
      showNotice('C.O.V.I. atualizado', 'Você já está usando a versão mais recente.');
    }
  } catch (error) {
    console.error('Não foi possível verificar atualizações do C.O.V.I.:', error);
    if (manual) showNotice('Falha ao verificar atualizações', 'Verifique sua conexão com a internet e tente novamente.');
  } finally {
    releaseCheckInProgress = false;
  }
}

function supportsAutomaticUpdates() {
  return process.platform === 'win32' || (process.platform === 'linux' && Boolean(process.env.APPIMAGE));
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    if (manual) showNotice('C.O.V.I. em desenvolvimento', 'A verificação de atualizações está disponível na versão instalada.');
    return;
  }
  if (!supportsAutomaticUpdates()) {
    checkManualUpdate(manual);
    return;
  }
  if (updateCheckInProgress) return;
  updateCheckInProgress = true;
  manualUpdateCheck = manual;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    console.error('Não foi possível verificar atualizações do C.O.V.I.:', error);
    if (manualUpdateCheck && manual) showNotice('Falha ao verificar atualizações', 'Verifique sua conexão com a internet e tente novamente.');
    manualUpdateCheck = false;
  } finally {
    updateCheckInProgress = false;
  }
}

function startUpdateChecks() {
  if (!app.isPackaged) return;
  if (supportsAutomaticUpdates()) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.autoRunAppAfterInstall = true;
    autoUpdater.on('update-available', (info) => {
      console.info(`Atualização do C.O.V.I. encontrada: ${info.version}`);
      manualUpdateCheck = false;
    });
    autoUpdater.on('update-not-available', (info) => {
      if (manualUpdateCheck) showNotice('C.O.V.I. atualizado', `Você já está usando a versão ${info.version}.`);
      manualUpdateCheck = false;
    });
    autoUpdater.on('update-downloaded', (info) => {
      updateReadyVersion = info.version;
      prefs.lastUpdateNotice = info.version;
      savePrefs();
      buildMenu();
      showNotice(
        'Atualização do C.O.V.I. pronta',
        `A versão ${info.version} foi baixada. Clique para reiniciar e instalar agora; ela também será instalada ao sair.`,
        'Reiniciar agora',
        () => autoUpdater.quitAndInstall(false, true)
      );
    });
    autoUpdater.on('error', (error) => {
      console.error('Erro no atualizador do C.O.V.I.:', error);
      if (manualUpdateCheck) showNotice('Falha ao verificar atualizações', 'Verifique sua conexão com a internet e tente novamente.');
      manualUpdateCheck = false;
    });
  }
  checkForUpdates();
  updateCheckTimer = setInterval(() => checkForUpdates(), UPDATE_CHECK_INTERVAL);
  updateCheckTimer.unref();
}

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
    { label: 'Verificar atualizações', click: () => checkForUpdates(true) },
    ...(updateReadyVersion ? [{ label: `Reiniciar para atualizar para ${updateReadyVersion}`, click: () => autoUpdater.quitAndInstall(false, true) }] : []),
    { label: 'Avisar quando baixar fotos HEIC', type: 'checkbox', checked: prefs.watch,
      click: (m) => { prefs.watch = m.checked; savePrefs(); startWatch(); } },
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
  startWatch();
  startUpdateChecks();
});
app.on('before-quit', () => { quitting = true; if (updateCheckTimer) clearInterval(updateCheckTimer); });
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
ipcMain.handle('replaceOriginal', (e, filePath, extension, contents) => replaceOriginal(filePath, extension, contents));
ipcMain.handle('getImageConverterFormats', () => ({
  extensions: getSupportedImageExtensions(),
  outputs: [...getAvailableFormats(LOSSLESS_FORMATS), ...getAvailableFormats(LOSSY_FORMATS)]
    .map(({ id, label, extension }) => ({ id, label, extension }))
}));
ipcMain.handle('getImageConversionInfo', (e, filePath) => getImageConversionInfo(filePath));
ipcMain.handle('convertImage', async (e, filePath, formatId) => {
  const info = await getImageConversionInfo(filePath);
  const format = [...LOSSLESS_FORMATS, ...LOSSY_FORMATS].find(({ id }) => id === formatId);
  if (!format || !info.targets.some((target) => target.id === formatId)) {
    throw new Error(info.reason || 'Este formato de saída não está disponível para esta imagem.');
  }
  let image = sharp(filePath).keepMetadata();
  const lossless = LOSSLESS_FORMATS.some(({ id }) => id === formatId);
  if (lossless) image = image.toColourspace(info.space);
  if (formatId === 'png') {
    image = image.png({ compressionLevel: 9, bitdepth: info.depth === 'ushort' ? 16 : 8, palette: false });
  } else if (formatId === 'tiff') {
    image = image.tiff({ compression: 'none' });
  } else if (formatId === 'webp') {
    image = image.webp({ lossless: true, effort: 6, exact: true });
  } else if (formatId === 'avif-lossless') {
    image = image.avif({ lossless: true, effort: 4, bitdepth: 8 });
  } else if (formatId === 'jpg') {
    image = image.flatten({ background: '#ffffff' }).jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true });
  } else if (formatId === 'webp-lossy') {
    image = image.webp({ quality: 90, alphaQuality: 100, effort: 6 });
  } else if (formatId === 'avif') {
    image = image.avif({ quality: 90, effort: 4 });
  } else if (formatId === 'gif') {
    image = image.gif({ colours: 256, effort: 7 });
  }
  const { data, info: outputInfo } = await image.toBuffer({ resolveWithObject: true });
  if (lossless) {
    const outputMetadata = await sharp(data).metadata();
    const [sourcePixels, outputPixels] = await Promise.all([
      sharp(filePath).raw({ depth: info.depth }).toBuffer(),
      sharp(data).raw({ depth: info.depth }).toBuffer()
    ]);
    if (
      outputInfo.width !== info.width ||
      outputInfo.height !== info.height ||
      outputInfo.channels !== info.channels ||
      outputMetadata.depth !== info.depth ||
      !sourcePixels.equals(outputPixels)
    ) {
      throw new Error('A saída não preservou exatamente os pixels, as dimensões e a profundidade de cor originais.');
    }
  }
  return {
    data: new Uint8Array(data),
    size: outputInfo.size,
    width: outputInfo.width,
    height: outputInfo.height
  };
});
ipcMain.handle('closePopup', () => { if (popup) popup.close(); });

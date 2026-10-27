function createDownloadMonitor({ BrowserWindow, screen, fs, path, icon, webPrefs, getDownloads, isWatchEnabled }) {
  let popup = null, watcher = null;
  let known = new Set(), pending = [], flushTimer = null, queue = [];

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
    if (!isWatchEnabled()) return;
    const dir = getDownloads();
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
      icon, webPreferences: webPrefs
    });
    popup.setMenuBarVisibility(false);
    const { workArea } = screen.getPrimaryDisplay();
    popup.setPosition(workArea.x + workArea.width - 420, workArea.y + workArea.height - 300);
    popup.loadFile('prompt.html', { query: { files: JSON.stringify(files) } });
    popup.once('ready-to-show', () => popup.showInactive());
    popup.on('closed', () => { popup = null; next(); });
  }

  return { startWatch, stopWatch, closePopup: () => { if (popup) popup.close(); } };
}

module.exports = createDownloadMonitor;

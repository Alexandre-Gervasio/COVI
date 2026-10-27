function createPreferences({ app, fs, path, crypto }) {
  const filePath = () => path.join(app.getPath('userData'), 'prefs.json');
  const prefs = { watch: true, autoStart: true };

  function load() {
    try {
      const saved = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
        throw new Error('O arquivo de preferências não contém um objeto válido.');
      }
      Object.assign(prefs, saved);
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('Não foi possível carregar as preferências do C.O.V.I.:', error);
    }
  }

  function save() {
    try {
      fs.writeFileSync(filePath(), JSON.stringify(prefs));
    } catch (error) {
      console.error('Não foi possível salvar as preferências do C.O.V.I.:', error);
    }
  }

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
      try {
        fs.unlinkSync(temporary);
      } catch (cleanupError) {
        console.error('Não foi possível remover o arquivo temporário de inicialização:', cleanupError);
      }
      throw error;
    }
  }

  return { get: () => prefs, load, save, setAutoStart };
}

module.exports = createPreferences;

function createUpdater({ app, autoUpdater, https, shell, showNotice, getPreferences, savePreferences, buildMenu, onStatus }) {
  const RELEASES_API = 'https://api.github.com/repos/Alexandre-Gervasio/COVI/releases/latest';
  const RELEASES_PAGE = 'https://github.com/Alexandre-Gervasio/COVI/releases/latest';
  const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000;
  let updateCheckTimer = null, updateCheckInProgress = false, releaseCheckInProgress = false;
  let manualUpdateCheck = false, updateReadyVersion = null, externalReleaseUrl = null;
  let updateStatus = { state: 'idle', message: 'Clique para verificar se há atualizações.' };
  const prefs = getPreferences();

  function publishStatus(state, message, version) {
    updateStatus = { state, message, version };
    onStatus(updateStatus);
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
    savePreferences();
    showNotice(
      'Atualização do C.O.V.I. disponível',
      `A versão ${version} está disponível. Clique para abrir a página de download.`,
      'Baixar atualização',
      () => shell.openExternal(releaseUrl).catch((error) => console.error('Não foi possível abrir o download:', error))
    );
  }

  async function checkManualUpdate(manual) {
    if (releaseCheckInProgress) return updateStatus;
    releaseCheckInProgress = true;
    if (manual) publishStatus('checking', 'Verificando atualizações...');
    try {
      const release = await getLatestRelease();
      const version = release.tag_name;
      if (compareVersions(version, app.getVersion()) > 0) {
        externalReleaseUrl = release.html_url || RELEASES_PAGE;
        publishStatus('available', `A versão ${version} está disponível. Clique para baixar.`, version);
        if (manual || prefs.lastUpdateNotice !== version) notifyManualUpdate(version, release.html_url || RELEASES_PAGE, manual);
      } else {
        externalReleaseUrl = null;
        publishStatus('current', `Você já está usando a versão ${app.getVersion()}.`, app.getVersion());
        if (manual) showNotice('C.O.V.I. atualizado', 'Você já está usando a versão mais recente.');
      }
    } catch (error) {
      console.error('Não foi possível verificar atualizações do C.O.V.I.:', error);
      publishStatus('error', 'Falha ao verificar atualizações. Verifique a conexão e tente novamente.');
      if (manual) showNotice('Falha ao verificar atualizações', 'Verifique sua conexão com a internet e tente novamente.');
    } finally {
      releaseCheckInProgress = false;
    }
    return updateStatus;
  }

  function supportsAutomaticUpdates() {
    return process.platform === 'win32' || (process.platform === 'linux' && Boolean(process.env.APPIMAGE));
  }

  async function checkForUpdates(manual = false) {
    if (!app.isPackaged) {
      if (manual) publishStatus('error', 'A verificação de atualizações está disponível na versão instalada.');
      if (manual) showNotice('C.O.V.I. em desenvolvimento', 'A verificação de atualizações está disponível na versão instalada.');
      return updateStatus;
    }
    if (!supportsAutomaticUpdates()) {
      return checkManualUpdate(manual);
    }
    if (updateCheckInProgress) {
      if (manual) publishStatus('checking', 'Uma verificação de atualizações já está em andamento...');
      return updateStatus;
    }
    updateCheckInProgress = true;
    manualUpdateCheck = manual;
    if (manual) publishStatus('checking', 'Verificando atualizações...');
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      console.error('Não foi possível verificar atualizações do C.O.V.I.:', error);
      publishStatus('error', 'Falha ao verificar atualizações. Verifique a conexão e tente novamente.');
      if (manualUpdateCheck && manual) showNotice('Falha ao verificar atualizações', 'Verifique sua conexão com a internet e tente novamente.');
      manualUpdateCheck = false;
    } finally {
      updateCheckInProgress = false;
    }
    return updateStatus;
  }

  function startUpdateChecks() {
    if (!app.isPackaged) return;
    if (supportsAutomaticUpdates()) {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.autoRunAppAfterInstall = true;
      autoUpdater.on('update-available', (info) => {
        console.info(`Atualização do C.O.V.I. encontrada: ${info.version}`);
        publishStatus('downloading', `Baixando a versão ${info.version}...`, info.version);
        manualUpdateCheck = false;
      });
      autoUpdater.on('update-not-available', (info) => {
        publishStatus('current', `Você já está usando a versão ${info.version}.`, info.version);
        if (manualUpdateCheck) showNotice('C.O.V.I. atualizado', `Você já está usando a versão ${info.version}.`);
        manualUpdateCheck = false;
      });
      autoUpdater.on('update-downloaded', (info) => {
        updateReadyVersion = info.version;
        publishStatus('downloaded', `Versão ${info.version} baixada. Clique para reiniciar e atualizar.`, info.version);
        prefs.lastUpdateNotice = info.version;
        savePreferences();
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
        publishStatus('error', 'Falha ao atualizar. Verifique a conexão e tente novamente.');
        if (manualUpdateCheck) showNotice('Falha ao verificar atualizações', 'Verifique sua conexão com a internet e tente novamente.');
        manualUpdateCheck = false;
      });
    }
    checkForUpdates();
    updateCheckTimer = setInterval(() => checkForUpdates(), UPDATE_CHECK_INTERVAL);
    updateCheckTimer.unref();
  }

  async function performAction() {
    if (updateReadyVersion) {
      autoUpdater.quitAndInstall(false, true);
      return updateStatus;
    }
    if (externalReleaseUrl) {
      await shell.openExternal(externalReleaseUrl);
      return updateStatus;
    }
    return checkForUpdates(true);
  }

    return {
      checkForUpdates,
      startUpdateChecks,
      getReadyVersion: () => updateReadyVersion,
      getStatus: () => updateStatus,
      performAction,
      stop: () => { if (updateCheckTimer) clearInterval(updateCheckTimer); }
    };
}

module.exports = createUpdater;

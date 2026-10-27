const { contextBridge, ipcRenderer } = require('electron');
const i = (c, ...a) => ipcRenderer.invoke(c, ...a);
contextBridge.exposeInMainWorld('api', {
  save: (n, b) => i('save', n, b),
  saveAll: (f) => i('saveAll', f),
  readFile: (p) => i('readFile', p),
  writeNext: (p, ext, b) => i('writeNext', p, ext, b),
  getPrefs: () => i('getPrefs'),
  setFormat: (f) => i('setFormat', f),
  closePopup: () => i('closePopup')
});

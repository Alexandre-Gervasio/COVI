const { contextBridge, ipcRenderer, webUtils } = require('electron');
const i = (c, ...a) => ipcRenderer.invoke(c, ...a);
contextBridge.exposeInMainWorld('api', {
  save: (n, b) => i('save', n, b),
  saveAll: (f) => i('saveAll', f),
  readFile: (p) => i('readFile', p),
  writeNext: (p, ext, b) => i('writeNext', p, ext, b),
  getVersion: () => i('getVersion'),
  getImageConverterFormats: () => i('getImageConverterFormats'),
  getImageConversionInfo: (p) => i('getImageConversionInfo', p),
  convertImage: (p, f) => i('convertImage', p, f),
  replaceOriginal: (p, ext, b) => i('replaceOriginal', p, ext, b),
  getUpdateStatus: () => i('update:getStatus'),
  updateAction: () => i('update:action'),
  onUpdateStatus: (callback) => {
    const listener = (event, status) => callback(status);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
  getPathForFile: (file) => webUtils.getPathForFile(file),
  closePopup: () => i('closePopup')
});

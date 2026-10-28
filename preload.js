const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('studio', {
  getBackendStatus: () => ipcRenderer.invoke('media:status'),
  resolveUrl: url => ipcRenderer.invoke('media:resolve', url),
  downloadSection: options => ipcRenderer.invoke('media:download-section', options),
  exportMedia: options => ipcRenderer.invoke('media:export', options),
  convertBatch: options => ipcRenderer.invoke('media:convert-batch', options),
  importToAdobe: options => ipcRenderer.invoke('media:import-adobe', options),
  openMedia: () => ipcRenderer.invoke('media:open'),
  revealFile: filePath => ipcRenderer.invoke('media:reveal-file', filePath),
  getChangelog: () => ipcRenderer.invoke('app:get-changelog'),
  checkUpdates: () => ipcRenderer.invoke('app:check-updates'),
  downloadUpdate: asset => ipcRenderer.invoke('app:download-update', asset),
  openInstaller: filePath => ipcRenderer.invoke('app:open-installer', filePath),
  openRelease: url => ipcRenderer.invoke('app:open-release', url),
  getSystemStatus: () => ipcRenderer.invoke('app:system-status'),
  getAdobeStatus: () => ipcRenderer.invoke('media:adobe-status'),
  getProjectMedia: target => ipcRenderer.invoke('media:project-media', target),
  openBrowserExtension: () => ipcRenderer.invoke('media:open-browser-extension'),
  getPreferences: () => ipcRenderer.invoke('app:get-preferences'),
  setPreferences: options => ipcRenderer.invoke('app:preferences', options),
  scanSystem: () => ipcRenderer.invoke('app:system-scan'),
  startNativeDrag: path => ipcRenderer.send('media:start-native-drag', path),
  onProtocolVideo: callback => { ipcRenderer.removeAllListeners('app:protocol-video'); ipcRenderer.on('app:protocol-video', (_event, url) => callback(url)); },
  onTaskProgress: callback => { ipcRenderer.removeAllListeners('task:progress'); ipcRenderer.on('task:progress', (_event, data) => callback(data)); },
  onAdobeHandoff: callback => { ipcRenderer.removeAllListeners('adobe:handoff'); ipcRenderer.on('adobe:handoff', (_event, data) => callback(data)); }
});


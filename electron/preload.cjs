const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexPoolDesktop', {
  isElectron: true,
  request: (payload) => ipcRenderer.invoke('codexpool:api-request', payload),
});

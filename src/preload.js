const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  openFileDialog: () => ipcRenderer.invoke('dialog:open'),
  saveFile: (filePath, content) => ipcRenderer.invoke('file:save', { filePath, content }),
  saveFileDialog: (defaultPath) => ipcRenderer.invoke('dialog:save', { defaultPath }),
  confirmClose: (filename) => ipcRenderer.invoke('dialog:confirm-close', { filename }),

  // Listen for menu events
  onMenuNew: (callback) => ipcRenderer.on('menu:new-file', callback),
  onMenuSave: (callback) => ipcRenderer.on('menu:save', callback),
  onMenuSaveAs: (callback) => ipcRenderer.on('menu:save-as', callback),
  onMenuCloseTab: (callback) => ipcRenderer.on('menu:close-tab', callback),
  onMenuFormat: (callback) => ipcRenderer.on('menu:format', callback),
  onMenuSelectAll: (callback) => ipcRenderer.on('editor:select-all', callback),
  onMenuRefresh: (callback) => ipcRenderer.on('menu:refresh-preview', callback),

  // File opened from OS (double-click / open with)
  onFileOpened: (callback) => ipcRenderer.on('file:opened', (event, data) => callback(data)),
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  selectDirectory: (defaultPath) => ipcRenderer.invoke('select-directory', defaultPath),
  getDefaultWorkspacePath: () => ipcRenderer.invoke('get-default-workspace-path'),
  openPath: (targetPath) => ipcRenderer.invoke('open-path', targetPath),
  saveProjectFiles: (folderPath, payload) =>
    ipcRenderer.invoke('save-project-files', folderPath, payload),
  listProjectFiles: (folderPath) => ipcRenderer.invoke('list-project-files', folderPath),
  loadProjectFile: (filePath) => ipcRenderer.invoke('load-project-file', filePath),
  saveAppConfig: (config) => ipcRenderer.invoke('save-app-config', config),
  loadAppConfig: () => ipcRenderer.invoke('load-app-config'),
});

const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('quota', Object.freeze({
  getDashboard: () => ipcRenderer.invoke('dashboard:get'),
  refresh: () => ipcRenderer.invoke('data:refresh'),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  chooseDirectory: () => ipcRenderer.invoke('directory:choose'),
  openCompact: () => ipcRenderer.invoke('window:compact'),
  openMain: () => ipcRenderer.invoke('window:main'),
  hideCompact: () => ipcRenderer.invoke('window:hideCompact'),
  controlWindow: action => ipcRenderer.invoke('window:control',action),
  beginWindowGesture: kind => ipcRenderer.invoke('window:gesture:begin',kind),
  updateWindowGesture: () => ipcRenderer.invoke('window:gesture:update'),
  endWindowGesture: () => ipcRenderer.invoke('window:gesture:end'),
  onDashboardUpdated: callback => { const listener=(_event,data)=>callback(data);ipcRenderer.on('dashboard:updated',listener);return()=>ipcRenderer.removeListener('dashboard:updated',listener); },
  exportData: () => ipcRenderer.invoke('data:export'),
  refreshAccount: () => ipcRenderer.invoke('account:refresh')
}));

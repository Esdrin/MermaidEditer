'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 文件
  openFile: () => ipcRenderer.invoke('file:open'),
  readPath: (p) => ipcRenderer.invoke('file:read-path', p),
  saveFile: (content) => ipcRenderer.invoke('file:save', content),
  saveFileAs: (content) => ipcRenderer.invoke('file:save-as', content),
  saveQuiet: (content) => ipcRenderer.invoke('file:save-quiet', content),
  // 外部实时同步
  watchFile: (p) => ipcRenderer.invoke('file:watch', p),
  unwatchFile: () => ipcRenderer.invoke('file:unwatch'),
  onExternalChange: (cb) => ipcRenderer.on('file:changed-external', (e, content) => cb(content)),
  // 文件管理器
  pickFolder: () => ipcRenderer.invoke('file:pick-folder'),
  listDir: (dir) => ipcRenderer.invoke('file:list-dir', dir),
  openExplorer: () => ipcRenderer.invoke('file:open-explorer'),
  // 导出
  exportImage: (payload, defaultName) => ipcRenderer.invoke('file:export-image', payload, defaultName),
  exportSvg: (xml, defaultName) => ipcRenderer.invoke('file:export-svg', xml, defaultName),
  exportMd: (text, defaultName) => ipcRenderer.invoke('file:export-md', text, defaultName),
  exportPdf: (html, defaultName) => ipcRenderer.invoke('file:export-pdf', html, defaultName),
  // 状态
  setDirty: (d) => ipcRenderer.send('app:set-dirty', d),
  setContent: (c) => ipcRenderer.send('app:set-content', c),
  exit: () => ipcRenderer.send('app:exit'),
  // 双击 .mmd 文件 / 命令行参数打开：主进程通知渲染进程加载
  onOpenPath: (cb) => ipcRenderer.on('app:open-path', (e, p) => cb(p)),
  // 拖放文件路径
  getPathForFile: (file) => webUtils.getPathForFile(file),
});

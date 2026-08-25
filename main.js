'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsw = require('node:fs'); // fs.watch 回调 API（promises 模块没有）

let win = null;
let dirty = false;
let currentPath = null;
let lastContent = '';
let lastWritten = '';   // 最近一次由本应用写入磁盘的内容（用于区分外部修改）
let watcher = null;     // 外部同步的文件监听
let changeTimer = null;

/* —— 启动崩溃日志（窗口闪退时留证据）；惰性解析路径，保证 ready 前也可写 —— */
function errLogFile() {
  try {
    return path.join(app.getPath('userData'), 'startup-error.log');
  } catch (e) {
    return path.join(process.env.APPDATA || __dirname, 'MermaidEditor', 'startup-error.log');
  }
}
function logErr(tag, err) {
  try {
    require('node:fs').appendFileSync(errLogFile(), '[' + new Date().toISOString() + '] ' + tag + ': ' + String(err && (err.stack || err.message || err)) + '\n');
  } catch (e) { /* ignore */ }
}
function logBoot(msg) {
  try {
    require('node:fs').appendFileSync(errLogFile(), '[' + new Date().toISOString() + '] BOOT: ' + msg + '\n');
  } catch (e) { /* ignore */ }
}
process.on('uncaughtException', (err) => { logErr('uncaughtException', err); });
process.on('unhandledRejection', (reason) => { logErr('unhandledRejection', reason); });

const EXT_FILTERS = [
  { name: 'Mermaid 文件', extensions: ['mmd', 'mermaid'] },
  { name: '文本文件', extensions: ['txt'] },
  { name: 'Markdown', extensions: ['md'] },
  { name: '所有文件', extensions: ['*'] },
];

const APP_TITLE = 'MermaidEditor';
const APP_ICON = path.join(__dirname, 'assets', 'icon.png');

/* —— 启动前开关（必须在 app ready 之前调用）——
 * 完全离线的本地应用不需要 HTTP 磁盘缓存 / GPU shader 磁盘缓存；
 * 禁用后不再尝试移动/创建 Cache、GPUCache 目录，
 * 避免残留进程占用目录时报 “Unable to move the cache / Gpu Cache Creation failed”。 */
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

function createWindow() {
  logBoot('createWindow 开始');
  win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    title: APP_TITLE,
    icon: APP_ICON,
    backgroundColor: '#f3f2f1',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    logBoot('ready-to-show → 显示窗口');
    win.show();
  });
  win.webContents.on('did-finish-load', () => logBoot('页面加载完成'));
  win.webContents.on('did-fail-load', (e, code, desc) => logBoot('页面加载失败 code=' + code + ' ' + desc));
  win.webContents.on('render-process-gone', (e, d) => logBoot('渲染进程退出 ' + JSON.stringify(d)));
  win.on('close', onClose);

  // F12 切换开发者工具
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools();
    }
  });

  // 右键菜单（撤销/剪切/复制/粘贴）
  win.webContents.on('context-menu', (e, params) => {
    const tpl = [];
    if (params.isEditable) {
      tpl.push(
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      );
    } else {
      tpl.push({ role: 'copy', label: '复制' });
    }
    Menu.buildFromTemplate(tpl).popup({ window: win });
  });
}

// —— 文件读写 ——

async function saveContent(content, saveAs) {
  let target = saveAs ? null : currentPath;
  if (!target) {
    const r = await dialog.showSaveDialog(win, {
      title: '保存文件',
      defaultPath: currentPath || 'diagram.mmd',
      filters: EXT_FILTERS,
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    target = r.filePath;
  }
  await fs.writeFile(target, content, 'utf8');
  currentPath = target;
  lastContent = content;
  lastWritten = content;
  return { canceled: false, path: target };
}

// 关闭前检查未保存更改
async function onClose(e) {
  if (!dirty) return;
  e.preventDefault();
  const name = currentPath ? path.basename(currentPath) : '未命名.mmd';
  const r = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['保存', '不保存', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    message: '是否保存对“' + name + '”的更改？',
  });
  if (r.response === 0) {
    const res = await saveContent(lastContent, false);
    if (!res.canceled) {
      dirty = false;
      win.destroy();
    }
  } else if (r.response === 1) {
    dirty = false;
    win.destroy();
  }
}

// —— IPC ——

ipcMain.handle('file:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '打开文件',
    filters: EXT_FILTERS,
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  const p = r.filePaths[0];
  let content = await fs.readFile(p, 'utf8');
  content = content.replace(/^﻿/, '');
  currentPath = p;
  lastContent = content;
  lastWritten = content;
  dirty = false;
  return { canceled: false, path: p, content };
});

ipcMain.handle('file:read-path', async (e, p) => {
  try {
    let content = await fs.readFile(p, 'utf8');
    content = content.replace(/^﻿/, '');
    currentPath = p;
    lastContent = content;
    lastWritten = content;
    dirty = false;
    return { canceled: false, path: p, content };
  } catch (err) {
    return { canceled: true, error: String(err && err.message) };
  }
});

ipcMain.handle('file:save', async (e, content) => saveContent(content, false));
ipcMain.handle('file:save-as', async (e, content) => saveContent(content, true));

/* —— 外部实时同步 —— */

// 静默保存（外部同步自动写回，不弹对话框）
ipcMain.handle('file:save-quiet', async (e, content) => {
  if (!currentPath) return { canceled: true };
  await fs.writeFile(currentPath, content, 'utf8');
  lastContent = content;
  lastWritten = content;
  dirty = false;
  return { canceled: false, path: currentPath };
});

async function onFileChanged(p) {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(async () => {
    try {
      const content = await fs.readFile(p, 'utf8');
      if (content === lastWritten) return; // 我们自己的写入，忽略
      lastContent = content;
      if (win && !win.isDestroyed()) win.webContents.send('file:changed-external', content);
    } catch (e) { /* 文件暂时不可读 */ }
  }, 300);
}

ipcMain.handle('file:watch', async (e, p) => {
  try {
    if (watcher) { watcher.close(); watcher = null; }
    if (p) {
      // Windows 上直接监听文件不可靠，改为监听所在目录并按文件名过滤
      const dir = path.dirname(p);
      const base = path.basename(p);
      watcher = fsw.watch(dir, (evt, fname) => {
        if (!fname || fname === base) onFileChanged(p);
      });
    }
    return { canceled: false };
  } catch (err) {
    return { canceled: true, error: String(err && err.message) };
  }
});

ipcMain.handle('file:unwatch', () => {
  if (watcher) { watcher.close(); watcher = null; }
  return { canceled: false };
});

/* —— 文件管理器 —— */

ipcMain.handle('file:pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择文件夹',
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return { canceled: true };
  return { canceled: false, path: r.filePaths[0] };
});

ipcMain.handle('file:list-dir', async (e, dir) => {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const items = entries
      .map((d) => ({ name: d.name, isDir: d.isDirectory(), path: path.join(dir, d.name) }))
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh-CN') : (a.isDir ? -1 : 1)));
    return { canceled: false, dir, items };
  } catch (err) {
    return { canceled: true, error: String(err && err.message) };
  }
});

// 在文件资源管理器中显示当前文件 / 打开文档目录
ipcMain.handle('file:open-explorer', async () => {
  try {
    if (currentPath) {
      shell.showItemInFolder(currentPath);
    } else {
      await shell.openPath(app.getPath('documents'));
    }
    return { canceled: false };
  } catch (err) {
    return { canceled: true, error: String(err && err.message) };
  }
});

function exportDialog(defaultName, filters) {
  return dialog.showSaveDialog(win, { title: '导出', defaultPath: defaultName, filters });
}

ipcMain.handle('file:export-image', async (e, payload, defaultName) => {
  const r = await exportDialog(defaultName, [{ name: 'PNG 图片', extensions: ['png'] }]);
  if (r.canceled || !r.filePath) return { canceled: true };
  const p = payload || {};
  const w = Math.min(Math.max(Math.round(p.width || 800), 64), 8192);
  const h = Math.min(Math.max(Math.round(p.height || 600), 64), 8192);
  const win = new BrowserWindow({
    show: false,
    width: w * 2,
    height: h * 2,
    backgroundColor: p.bg || '#ffffff',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.setZoomFactor(2);
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(p.html || ''));
    await new Promise((res) => setTimeout(res, 600));
    const image = await win.webContents.capturePage();
    await fs.writeFile(r.filePath, image.toPNG());
  } finally {
    win.destroy();
  }
  return { canceled: false, path: r.filePath };
});

ipcMain.handle('file:export-svg', async (e, xml, defaultName) => {
  const r = await exportDialog(defaultName, [{ name: 'SVG 矢量图', extensions: ['svg'] }]);
  if (r.canceled || !r.filePath) return { canceled: true };
  await fs.writeFile(r.filePath, xml, 'utf8');
  return { canceled: false, path: r.filePath };
});

ipcMain.handle('file:export-md', async (e, text, defaultName) => {
  const r = await exportDialog(defaultName, [{ name: 'Markdown', extensions: ['md'] }]);
  if (r.canceled || !r.filePath) return { canceled: true };
  await fs.writeFile(r.filePath, text, 'utf8');
  return { canceled: false, path: r.filePath };
});

ipcMain.handle('file:export-pdf', async (e, html, defaultName) => {
  const r = await exportDialog(defaultName, [{ name: 'PDF 文档', extensions: ['pdf'] }]);
  if (r.canceled || !r.filePath) return { canceled: true };
  const pdfWin = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const buf = await pdfWin.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { marginType: 'none' },
  });
  pdfWin.destroy();
  await fs.writeFile(r.filePath, buf);
  return { canceled: false, path: r.filePath };
});

ipcMain.on('app:set-dirty', (e, d) => { dirty = !!d; });
ipcMain.on('app:set-content', (e, c) => { lastContent = c; });
ipcMain.on('app:exit', () => { if (win) win.close(); });

// —— 生命周期（仅作为应用入口运行时执行；被测试 require 时由测试自行创建窗口） ——

// —— 生命周期 ——
// 注意：Electron 主进程中 require.main !== module（指向内部引导模块），不能用作入口判断；
// 测试通过环境变量 MMD_NO_LIFECYCLE=1 跳过本段，自行创建窗口。
if (process.env.MMD_NO_LIFECYCLE !== '1') {
  logBoot('入口启动，请求单实例锁');
  if (!app.requestSingleInstanceLock()) {
    logBoot('单实例锁失败 → 已有实例在运行');
    // 已有实例在运行：明确提示，而不是静默退出（避免"打不开"的错觉）
    app.whenReady().then(() => {
      dialog.showMessageBox({
        type: 'info',
        title: APP_TITLE,
        message: '应用已在运行',
        detail: '请查看已打开的应用窗口。若看不到窗口，请在任务管理器中结束 MermaidEditor（electron.exe）进程后重试。',
        buttons: ['确定'],
      }).then(() => app.quit());
    });
  } else {
    logBoot('获得单实例锁');
    app.on('second-instance', () => {
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    });
    app.whenReady().then(() => {
      migrateUserData();
      logBoot('app ready → createWindow');
      createWindow();
    });
    app.on('window-all-closed', () => app.quit());
  }
}

/** 应用改名（Mermaid 离线编辑器 → MermaidEditor）后，迁移旧 userData 中的本地状态 */
function migrateUserData() {
  try {
    const fsx = require('node:fs');
    const oldData = path.join(app.getPath('appData'), 'Mermaid 离线编辑器');
    const newData = app.getPath('userData');
    if (oldData === newData || !fsx.existsSync(oldData)) return;
    if (fsx.existsSync(path.join(newData, 'Local Storage'))) return; // 已迁移过
    ['Local Storage', 'Session Storage', 'IndexedDB'].forEach((sub) => {
      const src = path.join(oldData, sub);
      if (fsx.existsSync(src)) fsx.cpSync(src, path.join(newData, sub), { recursive: true });
    });
    logBoot('已从旧 userData 迁移本地状态');
  } catch (e) {
    logErr('migrateUserData', e);
  }
}

module.exports = {
  createWindow: createWindow,
  getWindow: () => win,
  getState: () => ({ currentPath, dirty, lastWritten }),
};

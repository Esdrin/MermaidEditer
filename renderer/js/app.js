'use strict';
window.ME = window.ME || {};

/* ---------------- 主控制器：功能区 / 形状面板 / 文件 / 快捷键 ---------------- */
ME.app = (function () {
  const $ = (id) => document.getElementById(id);
  const DRAFT_KEY = 'mmd-draft-v1';
  const RECENT_KEY = 'mmd-recent-v1';
  const UI_ZOOM_KEY = 'mmd-uizoom-v1';

  let currentPath = null;
  let dirty = false;
  let autoRender = true;
  let draftTimer = null;
  let mode = 'source'; // 'source' | 'canvas'
  let uiZoom = 100;    // 界面缩放（%）

  function basename(p) { return String(p).split(/[\\/]/).pop(); }
  function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* ---------------- 提示（Naive n-message，未就绪时回退旧样式） ---------------- */
  let toastTimer = null;
  function toast(msg, type) {
    const n = ME.Naive && ME.Naive.message;
    const kind = type === 'error' ? 'error' : type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'info';
    if (n && (n[kind] || n.info)) {
      if (n[kind]) n[kind](msg); else n.info(msg);
      return;
    }
    const t = $('toast');
    t.textContent = msg;
    t.className = type === 'error' ? 'error show' : 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------------- 状态栏 ---------------- */
  function setStatus(msg, cls) {
    const s = $('status-msg');
    s.textContent = msg;
    s.className = cls || '';
  }
  function setCount(n, e) {
    $('status-count').textContent = '节点 ' + n + ' · 连线 ' + e;
  }
  function updateType() {
    const t = ME.Renderer.detectType(ME.Editor.getSource());
    $('status-type').textContent = ME.Renderer.typeName(t);
    const btnDir = $('btn-dir');
    if (btnDir) btnDir.disabled = t !== 'flow';
  }
  function setPageBg(color) {
    $('page').style.background = color;
  }

  /* ---------------- 图标填充 ---------------- */
  function fillIcons() {
    document.querySelectorAll('.ic[data-icon]').forEach((sp) => {
      const name = sp.getAttribute('data-icon');
      if (ME.ICONS[name]) sp.innerHTML = ME.ICONS[name];
    });
  }

  /* ---------------- 左侧文件管理器（Naive UI n-tree） ---------------- */
  const TREE_KEY = 'mmd-tree-v1';

  function saveTreeState(st) {
    try { localStorage.setItem(TREE_KEY, JSON.stringify(st)); } catch (e) { /* ignore */ }
  }

  /** 打开文件后：交由 n-tree 展开/重定根 */
  function expandToFile(p) {
    ME.Naive.tree.expandToFile(p);
  }

  function handleStencilPick(type, id, evt) {
    if (ME.Canvas && ME.Canvas.active) { ME.Canvas.pickStencil(type, id, evt); return; }
    if (type === 'shape') insertShape(id);
    else if (type === 'edge') insertEdge(id);
    else if (type === 'template') insertTemplate(id);
  }

  /* ---------------- 外部实时同步 ---------------- */
  let syncOn = false;
  let syncTimer = null;

  function toggleSync(on) {
    syncOn = on;
    document.querySelectorAll('[data-action="toggle-sync"]').forEach((b) => b.classList.toggle('on', syncOn));
    if (syncOn) {
      if (currentPath) {
        window.api.watchFile(currentPath);
        toast('外部同步已开启：外部修改自动载入，编辑自动写回');
        setStatus('外部同步中：' + basename(currentPath), 'ok');
      } else {
        toast('请先打开或保存一个文件，再开启外部同步', 'error');
        toggleSync(false);
      }
    } else {
      window.api.unwatchFile();
      setStatus('外部同步已关闭');
    }
  }

  function refreshSync() {
    if (!syncOn) return;
    window.api.watchFile(currentPath || null);
  }

  function scheduleAutoSave() {
    if (!syncOn || !currentPath) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      window.api.saveQuiet(ME.Editor.getSource()).then((r) => {
        if (!r.canceled) {
          dirty = false;
          window.api.setDirty(false);
          updateTitleBar();
        }
      });
    }, 900);
  }

  window.api.onExternalChange((content) => {
    if (!syncOn) return;
    if (content === ME.Editor.getSource()) return;
    ME.Editor.setSource(content);
    ME.Renderer.renderNow();
    toast('外部文件已更新，已自动同步');
  });

  /* ---------------- 插入 ---------------- */
  function nextNodeName() {
    const src = ME.Editor.getSource();
    let max = 0;
    const re = /\bN(\d+)\b/g;
    let m;
    while ((m = re.exec(src))) max = Math.max(max, +m[1]);
    return 'N' + (max + 1);
  }

  function selectedLineIdx() {
    return ME.Editor.currentLineIdx();
  }

  function selectedNodeName() {
    const idx = selectedLineIdx();
    const n = ME.Renderer.findNodeAtLine(idx);
    return n ? n.name : null;
  }

  function insertLines(lines) {
    const src = ME.Editor.getSource();
    const arr = src.split('\n');
    const at = arr[arr.length - 1] === '' ? arr.length - 1 : arr.length;
    arr.splice(at, 0, ...lines);
    ME.Editor.setSource(arr.join('\n'));
  }

  function insertShape(id) {
    const shape = ME.SHAPES.find((s) => s.id === id);
    if (!shape) return;
    if (ME.Renderer.detectType(ME.Editor.getSource()) !== 'flow') {
      toast('当前图类型不支持插入节点，请切换到流程图', 'error');
      return;
    }
    const selName = selectedNodeName();
    const name = nextNodeName();
    const line = selName
      ? selName + ' --> ' + name + shape.t[0] + '新节点' + shape.t[1]
      : name + shape.t[0] + '新节点' + shape.t[1];
    insertLines([line]);
    ME.Renderer.renderNow();
    toast('已插入「' + shape.label + '」');
  }

  function insertEdge(id) {
    const edge = ME.EDGES.find((e) => e.id === id);
    if (!edge) return;
    if (ME.Renderer.detectType(ME.Editor.getSource()) !== 'flow') {
      toast('连接线仅支持流程图', 'error');
      return;
    }
    const selName = selectedNodeName();
    if (!selName) {
      toast('请先在画布或代码中选中一个节点，再插入连接线', 'error');
      return;
    }
    const to = nextNodeName();
    const label = edge.hasLabel ? '|标签|' : '';
    insertLines([selName + ' ' + edge.conn + label + ' ' + to]);
    ME.Renderer.renderNow();
  }

  /** 确认对话框（Naive n-dialog；未就绪时回退原生 confirm） */
  function confirmAsync(msg) {
    if (ME.Naive && ME.Naive.dialog && ME.Naive.dialog.confirm) {
      return new Promise((resolve) => {
        ME.Naive.dialog.confirm({
          title: '确认',
          content: msg,
          positiveText: '确定',
          negativeText: '取消',
          onPositiveClick: () => resolve(true),
          onNegativeClick: () => resolve(false),
          onClose: () => resolve(false),
        });
      });
    }
    return Promise.resolve(confirm(msg));
  }

  async function insertTemplate(id) {
    const tpl = ME.TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    if (ME.Editor.getSource().trim()) {
      const ok = await confirmAsync('用「' + tpl.label + '」模板替换当前源代码？');
      if (!ok) return;
    }
    ME.Editor.setSource(tpl.code);
    ME.Renderer.renderNow();
    toast('已载入「' + tpl.label + '」模板');
    switchTab('home');
  }

  /* ---------------- 下拉面板 ---------------- */
  function ddItem(label, icon, onclick) {
    const b = document.createElement('button');
    b.className = 'dd-item';
    b.innerHTML = '<span class="ic">' + icon + '</span><span>' + escapeHtml(label) + '</span>';
    b.addEventListener('click', onclick);
    return b;
  }

  function buildColorPanel(panel, title, value, onchange) {
    const t = document.createElement('div');
    t.className = 'dd-title';
    t.textContent = title;
    panel.appendChild(t);
    const box = document.createElement('div');
    box.className = 'dd-color';
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = value;
    const hex = document.createElement('input');
    hex.type = 'text';
    hex.className = 'hex';
    hex.value = value;
    const commit = () => {
      const v = /^#[0-9a-fA-F]{6}$/.test(hex.value) ? hex.value : picker.value;
      hex.value = v; picker.value = v;
      onchange(v);
    };
    picker.addEventListener('change', () => { hex.value = picker.value; onchange(picker.value); });
    hex.addEventListener('change', commit);
    box.appendChild(picker);
    box.appendChild(hex);
    panel.appendChild(box);
    const sw = document.createElement('div');
    sw.className = 'dd-swatches';
    ME.SWATCHES.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'dd-swatch';
      b.style.background = c;
      b.addEventListener('click', () => {
        picker.value = c; hex.value = c;
        onchange(c);
      });
      sw.appendChild(b);
    });
    panel.appendChild(sw);
  }

  /** 插入页：形状/连接线做成功能区小格子 */
  function buildShapeCells() {
    const cell = (icon, title, onClick, dragType, dragId) => {
      const b = document.createElement('button');
      b.className = 'shape-cell';
      b.title = title;
      b.innerHTML = '<span class="ic">' + icon + '</span>';
      b.addEventListener('click', onClick);
      b.setAttribute('draggable', 'true');
      b.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-mmd-stencil', JSON.stringify({ type: dragType, id: dragId }));
        e.dataTransfer.effectAllowed = 'copy';
      });
      return b;
    };
    Object.keys(ME.SHAPE_GROUPS).forEach((key) => {
      const grid = $('sg-' + key);
      if (!grid) return;
      ME.SHAPE_GROUPS[key].ids.forEach((id) => {
        const s = ME.SHAPES.find((x) => x.id === id);
        if (!s) return;
        grid.appendChild(cell(ME.svg(s.icon), s.label + (s.sub ? '（' + s.sub + '）' : ''), () => handleStencilPick('shape', s.id), 'shape', s.id));
      });
    });
    const edgeGrid = $('sg-edges');
    if (edgeGrid) {
      ME.EDGES.forEach((e) => {
        edgeGrid.appendChild(cell(ME.svg(e.icon), e.label, () => handleStencilPick('edge', e.id), 'edge', e.id));
      });
    }
    // 模板也做成小方块（点击载入图类型模板）
    const typesGrid = $('sg-types');
    if (typesGrid) {
      ME.TEMPLATES.forEach((t) => {
        typesGrid.appendChild(cell(ME.svg(t.icon), t.label + '（' + t.sub + '）', () => insertTemplate(t.id), 'template', t.id));
      });
    }
    // 整理：对齐选中的多个节点（3×2 小格子）
    const alignGrid = $('sg-align');
    if (alignGrid) {
      const aligns = [
        ['align-left', '左对齐', 'left'],
        ['align-hcenter', '水平居中', 'hcenter'],
        ['align-right', '右对齐', 'right'],
        ['align-top', '上对齐', 'top'],
        ['align-vcenter', '垂直居中', 'vcenter'],
        ['align-bottom', '下对齐', 'bottom'],
      ];
      aligns.forEach(([icon, label, mode]) => {
        alignGrid.appendChild(cell(ME.svg(ME.ICONS[icon]), label, () => alignCanvasNodes(mode), null, null));
      });
    }
  }

  /** 画布节点对齐整理（需选中 ≥2 个节点；未在画布模式时提示） */
  function alignCanvasNodes(mode) {
    if (!ME.Canvas || !ME.Canvas.active) {
      toast('请先切换到「自由画布」模式并选中多个节点', 'warning');
      return;
    }
    ME.Canvas.alignNodes(mode);
  }

  function buildDropdowns() {
    // 形状格子由 Vue 渲染功能区后就绪后填充（buildShapeCells 在 init 中挂接 onRibbonReady）
    // 主题/方向/曲线/字体/字号/图类型 已由 Naive n-dropdown 提供（见 naive.js RIBBON_DATA）

    buildColorPanel($('dd-textcolor'), '文字颜色', ME.Renderer.getCfg().textColor || '#000000', (v) => {
      ME.Renderer.setCfg({ textColor: v });
      ME.Renderer.renderNow();
    });
    buildColorPanel($('dd-pagebg'), '页面背景色', ME.Renderer.getCfg().bg, (v) => {
      ME.Renderer.setCfg({ bg: v });
      setPageBg(v);
    });
  }

  function openPanel(btn, panel) {
    const rb = $('ribbon').getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    panel.classList.add('open');
    let left = b.left - rb.left;
    const pw = panel.offsetWidth;
    if (left + pw > rb.width - 8) left = Math.max(8, rb.width - pw - 8);
    panel.style.left = left + 'px';
  }

  function closeDropdowns() {
    document.querySelectorAll('.dd-panel.open').forEach((p) => p.classList.remove('open'));
  }

  function syncUiChecks() {
    const cfg = ME.Renderer.getCfg();
    document.querySelectorAll('#dd-themes .dd-item').forEach((b) => {
      b.classList.toggle('sel', b.getAttribute('data-val') === cfg.theme);
    });
  }

  /* ---------------- 功能区标签 ---------------- */
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.getAttribute('data-tab') === name));
    document.querySelectorAll('.ribbon-page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + name));
    closeDropdowns();
    if (name === 'file') renderRecent();
  }

  /* ---------------- 动作 ---------------- */
  function execCmd(cmd) {
    ME.Editor.ta.focus();
    try { document.execCommand(cmd); } catch (e) { /* ignore */ }
  }

  async function doPaste() {
    try {
      const text = await navigator.clipboard.readText();
      ME.Editor.ta.focus();
      ME.Editor.insertAtCursor(text);
    } catch (e) {
      toast('无法读取剪贴板', 'error');
    }
  }

  const ACTIONS = {
    'new': () => doNew(),
    'open': () => doOpen(),
    'save': () => doSave(false),
    'save-as': () => doSave(true),
    'exit': () => window.api.exit(),
    'undo': () => ME.Editor.undo(),
    'redo': () => ME.Editor.redo(),
    'cut': () => execCmd('cut'),
    'copy': () => execCmd('copy'),
    'paste': () => doPaste(),
    'render-now': () => ME.Renderer.renderNow(),
    'toggle-autorender': (btn) => {
      autoRender = !autoRender;
      document.querySelectorAll('[data-action="toggle-autorender"]').forEach((b) => b.classList.toggle('on', autoRender));
      if (autoRender) ME.Renderer.renderNow();
    },
    'zoom-in': () => zoomStep(1),
    'zoom-out': () => zoomStep(-1),
    'zoom-fit': () => zoomStep(1, true),
    'zoom-100': () => zoomStep(0),
    'ui-zoom-in': () => applyUiZoom(uiZoom + 10),
    'ui-zoom-out': () => applyUiZoom(uiZoom - 10),
    'mode-source': () => setMode('source'),
    'mode-canvas': () => setMode('canvas'),
    'toggle-sync': (btn) => toggleSync(!syncOn),
    'file-open-folder': async () => {
      const r = await window.api.pickFolder();
      if (r.canceled) return;
      ME.Naive.tree.setRoot(r.path);
    },
    'file-refresh': () => ME.Naive.tree.refresh(),
    'file-explorer': () => window.api.openExplorer(),
    'toggle-gutter': (btn) => toggleBodyClass(btn, 'no-gutter'),
    'toggle-grid': (btn) => {
      btn.classList.toggle('on');
      const on = btn.classList.contains('on');
      $('page').classList.toggle('show-grid', on);
      $('canvas-area').classList.toggle('show-dots', on);
    },
    'format-code': () => { ME.Editor.format(); ME.Renderer.renderNow(); toast('已整理代码'); },
    'draft-restore': () => restoreDraft(),
    'draft-discard': () => discardDraft(),
    'export-png': () => ME.Export.png(),
    'export-svg': () => ME.Export.svg(),
    'export-pdf': () => ME.Export.pdf(),
    'export-md': () => ME.Export.md(),
  };

  function toggleBodyClass(btn, cls) {
    btn.classList.toggle('on');
    document.body.classList.toggle(cls, btn.classList.contains('on'));
  }

  /** 事件委托：功能区按钮由 Vue 渲染（晚于 init 挂载），统一走 document 委托 */
  function bindActions() {
    document.addEventListener('click', (e) => {
      const dd = e.target.closest('[data-dropdown]');
      if (dd) {
        e.stopPropagation();
        const panel = $(dd.getAttribute('data-dropdown'));
        const was = panel.classList.contains('open');
        closeDropdowns();
        if (!was) openPanel(dd, panel);
        return;
      }
      closeDropdowns();
      const act = e.target.closest('[data-action]');
      if (act) {
        const fn = ACTIONS[act.getAttribute('data-action')];
        if (fn) {
          fn(act, e);
          if (act.closest('#page-file')) switchTab('home');
        }
        return;
      }
      const tab = e.target.closest('.tab');
      if (tab) { switchTab(tab.getAttribute('data-tab')); return; }
      const lay = e.target.closest('[data-layout]');
      if (lay) setLayout(lay.getAttribute('data-layout'));
    });
  }

  function setLayout(l) {
    // 开关式：点击 仅画布 / 仅代码 切换显示，再点一次恢复
    const on = document.body.classList.toggle('layout-' + l);
    document.querySelectorAll('.layout-btn').forEach((x) => {
      x.classList.toggle('active', x.getAttribute('data-layout') === l && on);
    });
  }

  /* ---------------- 可调大小分隔条 ---------------- */
  function bindResizers() {
    // invert=true：抓住面板边缘向外拉 → 面板变大（右栏往左拉变宽、代码往上拉变高）
    const bind = (rzId, targetId, axis, min, max, invert) => {
      const rz = $(rzId);
      if (!rz) return;
      rz.addEventListener('mousedown', (e) => {
        e.preventDefault();
        rz.classList.add('drag');
        const target = $(targetId);
        const startX = e.clientX, startY = e.clientY;
        const startSize = axis === 'x' ? target.offsetWidth : target.offsetHeight;
        const move = (ev) => {
          const d = axis === 'x' ? ev.clientX - startX : ev.clientY - startY;
          const delta = invert ? -d : d;
          const size = Math.min(Math.max(startSize + delta, min), max);
          if (axis === 'x') {
            target.style.width = size + 'px';
            target.style.minWidth = '0';
          } else {
            target.style.height = size + 'px';
            target.style.minHeight = '0';
          }
        };
        const up = () => {
          rz.classList.remove('drag');
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
    };
    // 左侧文件栏宽度（右边缘：往右拉变宽）
    bind('resizer-left', 'file-pane', 'x', 140, 480, false);
    // 右侧栏宽度（左边缘：往左拉变宽）
    bind('resizer-right', 'right-col', 'x', 240, 640, true);
    // 代码窗口高度（顶边缘：往上拉变高）
    bind('resizer-code', 'code-pane', 'y', 80, 640, true);
  }

  /* ---------------- 缩放 ---------------- */
  function updateZoomUI(z) {
    ME.Naive.slider.set(z);
    $('zoom-value').textContent = Math.round(z * 100) + '%';
  }

  /* ---------------- 界面缩放（整体 UI 放大/缩小） ---------------- */
  function applyUiZoom(z) {
    uiZoom = Math.min(200, Math.max(70, Math.round(z)));
    document.body.style.zoom = uiZoom / 100;
    const el = $('ui-zoom-value');
    if (el) el.textContent = uiZoom + '%';
    try { localStorage.setItem(UI_ZOOM_KEY, String(uiZoom)); } catch (e) { /* ignore */ }
  }
  function loadUiZoom() {
    try {
      const v = parseInt(localStorage.getItem(UI_ZOOM_KEY) || '100', 10);
      if (v && v >= 70 && v <= 200) applyUiZoom(v);
      else applyUiZoom(100);
    } catch (e) { applyUiZoom(100); }
  }

  /* ---------------- 文件 ---------------- */
  function updateTitleBar() {
    const name = currentPath ? basename(currentPath) : '未命名.mmd';
    document.title = (dirty ? '* ' : '') + name + ' — MermaidEditor';
  }

  function setDirty(d) {
    dirty = d;
    window.api.setDirty(d);
    window.api.setContent(ME.Editor.getSource());
    updateTitleBar();
  }

  async function doOpen() {
    const r = await window.api.openFile();
    if (r.canceled) return;
    currentPath = r.path;
    requestFitOnOpen();
    ME.Editor.setSource(r.content);
    setDirty(false);
    addRecent(r.path);
    // 自动切换编辑模式：流程图 → 自由画布；其他图类型 → 源码模式
    const type = ME.Renderer.detectType(r.content);
    if (type === 'flow') {
      if (!ME.Canvas.active) setMode('canvas');
    } else {
      if (ME.Canvas.active) setMode('source');
    }
    ME.Renderer.renderNow();
    expandToFile(r.path);
    refreshSync();
    toast('已打开 ' + basename(r.path) + (type === 'flow' ? '（自由画布）' : '（源码模式）'));
  }

  async function doSave(saveAs) {
    const r = saveAs
      ? await window.api.saveFileAs(ME.Editor.getSource())
      : await window.api.saveFile(ME.Editor.getSource());
    if (r.canceled) return;
    currentPath = r.path;
    setDirty(false);
    discardDraft();
    addRecent(r.path);
    expandToFile(r.path);
    refreshSync();
    toast('已保存');
  }

  async function doNew() {
    if (dirty) {
      const ok = await confirmAsync('当前文件有未保存的更改，新建将丢弃这些更改，是否继续？');
      if (!ok) return;
    }
    currentPath = null;
    ME.Editor.setSource(ME.DEFAULT_SRC);
    setDirty(false);
    ME.Renderer.renderNow();
    refreshSync();
  }

  /* ---------------- 最近文件 ---------------- */
  function getRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; }
  }
  function addRecent(p) {
    const list = getRecent().filter((x) => x !== p);
    list.unshift(p);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
  }
  function renderRecent() {
    const box = $('recent-ribbon');
    if (!box) return;
    const list = getRecent();
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = '<div id="recent-empty">暂无最近文件</div>';
      return;
    }
    list.forEach((p) => {
      const d = document.createElement('button');
      d.className = 'recent-item';
      d.title = p;
      d.innerHTML = '<span class="ic">' + ME.ICONS.mdfile + '</span><span class="rn">' + escapeHtml(basename(p)) + '</span>';
      d.addEventListener('click', async () => {
        await openPath(p);
        switchTab('home');
      });
      box.appendChild(d);
    });
  }

  async function openPath(p) {
    const r = await window.api.readPath(p);
    if (r.canceled) {
      toast('无法打开文件：' + (r.error || '未知错误'), 'error');
      return;
    }
    currentPath = r.path;
    requestFitOnOpen();
    ME.Editor.setSource(r.content);
    setDirty(false);
    addRecent(r.path);
    // 自动切换编辑模式：流程图 → 自由画布；其他图类型 → 源码模式
    const type = ME.Renderer.detectType(r.content);
    if (type === 'flow') {
      if (!ME.Canvas.active) setMode('canvas');
    } else {
      if (ME.Canvas.active) setMode('source');
    }
    ME.Renderer.renderNow();
    expandToFile(r.path);
    refreshSync();
    toast('已打开 ' + basename(r.path) + (type === 'flow' ? '（自由画布）' : '（源码模式）'));
  }

  /* ---------------- 草稿 ---------------- */
  function loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      return d && d.src ? d : null;
    } catch (e) { return null; }
  }
  function restoreDraft() {
    const d = loadDraft();
    if (d) {
      currentPath = null;
      ME.Editor.setSource(d.src);
      ME.Renderer.renderNow();
      toast('已恢复草稿');
    }
    discardDraft();
  }
  function discardDraft() {
    localStorage.removeItem(DRAFT_KEY);
    $('draft-banner').classList.add('hidden');
  }

  /* ---------------- 拖放 ---------------- */
  function bindDragDrop() {
    const canvasArea = $('canvas-area');
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
    canvasArea.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      canvasArea.classList.add('dragover');
    });
    canvasArea.addEventListener('dragleave', () => canvasArea.classList.remove('dragover'));
    canvasArea.addEventListener('drop', (e) => {
      e.preventDefault();
      canvasArea.classList.remove('dragover');
      const t = e.dataTransfer.getData('application/x-mmd-stencil');
      if (t) {
        try {
          const s = JSON.parse(t);
          handleStencilPick(s.type, s.id, e);
        } catch (err) { /* ignore */ }
        return;
      }
      if (e.dataTransfer.files.length) {
        const p = window.api.getPathForFile(e.dataTransfer.files[0]);
        if (p) openPath(p);
      }
    });
  }

  /* ---------------- 快捷键 ---------------- */
  function bindShortcuts() {
    document.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const k = (e.key || '').toLowerCase();
      if (!ctrl) return;
      if (k === 'n') { e.preventDefault(); ACTIONS['new'](); }
      else if (k === 'o') { e.preventDefault(); ACTIONS['open'](); }
      else if (k === 's') { e.preventDefault(); e.shiftKey ? ACTIONS['save-as']() : ACTIONS['save'](); }
      else if (k === '=') { e.preventDefault(); zoomStep(1); }
      else if (k === '-') { e.preventDefault(); zoomStep(-1); }
      else if (k === '0') { e.preventDefault(); zoomStep(0); }
      else if (k === '1') { e.preventDefault(); zoomStep(1, true); }
      else if (k === 'enter') { e.preventDefault(); ME.Renderer.renderNow(); }
    });
    const canvasArea = $('canvas-area');
    canvasArea.addEventListener('wheel', (e) => {
      // 画布模式：滚轮缩放由 svg 的 onWheel 处理
      if (ME.Canvas && ME.Canvas.active) return;
      // 源码模式：滚轮直接缩放（以鼠标为锚点），与自由画布一致
      e.preventDefault();
      ME.Renderer.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
    // 中键拖拽平移画布（源码模式；画布模式由 svg 的 onMouseDown 处理）
    let srcPan = null;
    canvasArea.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      // 先阻止浏览器中键自动滚动（四向箭头），无论哪种模式
      e.preventDefault();
      if (ME.Canvas && ME.Canvas.active) return; // 画布模式由 svg 的 onMouseDown 处理
      srcPan = { sx: e.clientX, sy: e.clientY, sl: canvasArea.scrollLeft, st: canvasArea.scrollTop };
      canvasArea.classList.add('panning-cursor');
    });
    document.addEventListener('mousemove', (e) => {
      if (!srcPan) return;
      canvasArea.scrollLeft = srcPan.sl - (e.clientX - srcPan.sx);
      canvasArea.scrollTop = srcPan.st - (e.clientY - srcPan.sy);
    });
    document.addEventListener('mouseup', () => {
      if (srcPan) { srcPan = null; canvasArea.classList.remove('panning-cursor'); }
    });
  }

  /** 缩放快捷键：画布模式缩放画布，源码模式缩放页面（fit=适应窗口） */
  function zoomStep(dir, fit) {
    if (ME.Canvas && ME.Canvas.active) {
      if (fit) { ME.Canvas.fitView(); return; }
      if (dir === 0) { ME.Canvas.setZoomFactor(1); return; }
      ME.Canvas.setZoomFactor(ME.Canvas.getZoomFactor() * (dir > 0 ? 1.12 : 1 / 1.12));
      return;
    }
    if (fit) ME.Renderer.zoomFit();
    else if (dir === 0) ME.Renderer.zoom100();
    else if (dir > 0) ME.Renderer.zoomIn();
    else ME.Renderer.zoomOut();
  }

  /* ---------------- 源码变更 ---------------- */
  function onSourceChange() {
    updateType();
    setDirty(true);
    scheduleAutoSave(); // 外部同步开启时自动写回
    if (ME.Canvas && ME.Canvas.active) { ME.Canvas.onSourceChanged(); return; }
    if (autoRender) ME.Renderer.scheduleRender();
  }

  /* ---------------- 编辑模式：源码 / 自由画布 ---------------- */
  /** 打开文件时调用：让即将导入的模块（画布或源码渲染）在内容就绪后强制适应窗口 */
  function requestFitOnOpen() {
    if (ME.Canvas && ME.Canvas.fitOnImport) ME.Canvas.fitOnImport();
    if (ME.Renderer && ME.Renderer.fitOnRender) ME.Renderer.fitOnRender();
  }

  function setMode(m) {
    if (m !== 'source' && m !== 'canvas') return;
    mode = m;
    document.querySelectorAll('[data-action^="mode-"]').forEach((b) => {
      b.classList.toggle('on', b.getAttribute('data-action') === 'mode-' + m);
    });
    const sm = $('status-mode');
    if (sm) {
      sm.textContent = m === 'canvas' ? '自由画布' : '源码模式';
      sm.style.display = m === 'canvas' ? '' : 'none';
    }
    if (m === 'canvas') ME.Canvas.enter();
    else ME.Canvas.exit();
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    fillIcons();
    buildDropdowns();
    ME.Naive.onRibbonReady(() => buildShapeCells());
    bindActions();
    bindResizers();
    bindDragDrop();
    bindShortcuts();
    updateZoomUI(1);
    loadUiZoom(); // 界面缩放（恢复上次设置）
    // Naive 缩放滑块联动：画布模式缩放画布，源码模式缩放页面
    ME.Naive.slider.onChange((z) => {
      if (ME.Canvas && ME.Canvas.active) ME.Canvas.setZoomFactor(z);
      else ME.Renderer.setZoom(z);
    });
    // 渲染错误条关闭
    const errClose = $('error-close');
    if (errClose) errClose.addEventListener('click', () => $('error-strip').classList.add('hidden'));
    // 文件树（Naive n-tree）：点击文件打开、状态持久化
    ME.Naive.tree.setOpenHandler((p) => openPath(p));
    ME.Naive.tree.setStateListener((st) => saveTreeState(st));
    try {
      const t = JSON.parse(localStorage.getItem(TREE_KEY) || 'null');
      if (t && t.root) ME.Naive.tree.setRoot(t.root, t.expanded || []);
    } catch (e) { /* ignore */ }

    // 双击 .mmd 文件（或命令行参数）打开：主进程发送路径，这里加载
    if (window.api.onOpenPath) {
      window.api.onOpenPath((p) => {
        if (p) { openPath(p); expandToFile(p); refreshSync(); }
      });
    }

    // 草稿恢复提示
    const d = loadDraft();
    if (d) {
      const time = new Date(d.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      $('draft-banner').querySelector('span').textContent = '检测到上次未保存的草稿（' + time + '）';
      $('draft-banner').classList.remove('hidden');
    }

    ME.Editor.setSource(d ? d.src : ME.DEFAULT_SRC);
    setDirty(false);
    updateType();
    ME.Renderer.renderNow();
    setMode('canvas'); // 默认进入自由画布

    // 草稿自动保存
    draftTimer = setInterval(() => {
      if (dirty) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ src: ME.Editor.getSource(), ts: Date.now() }));
      }
    }, 4000);
  }

  // 延迟到模块赋值完成后初始化（避免与 editor.js/render.js 的循环引用）
  setTimeout(init, 0);

  return {
    get currentPath() { return currentPath; },
    toast: toast,
    setStatus: setStatus,
    setCount: setCount,
    setPageBg: setPageBg,
    updateZoomUI: updateZoomUI,
    applyUiZoom: applyUiZoom,
    syncUiChecks: syncUiChecks,
    onSourceChange: onSourceChange,
    switchTab: switchTab,
    confirmAsync: confirmAsync,
    insertTemplate: insertTemplate,
  };
})();

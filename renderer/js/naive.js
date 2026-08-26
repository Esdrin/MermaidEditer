'use strict';
window.ME = window.ME || {};

/* ============================================================
   Naive UI 集成层（Vue3 运行时 + render 函数，兼容 CSP 无 unsafe-eval）
   提供：n-message / n-dialog / n-tree（文件树）/ n-slider（缩放）
   暴露：ME.Naive.message / dialog / tree / slider
   ============================================================ */
ME.Naive = (function () {
  const { createApp, h, ref, nextTick, getCurrentInstance, onMounted } = Vue;
  const N = window.naive;

  let messageApi = null;
  let dialogApi = null;
  let treeReady = false;
  let sliderReady = false;
  let ribbonReady = false;
  let treeCtl = null;
  let sliderCtl = null;
  const treeQueue = [];
  const sliderQueue = [];
  const ribbonQueue = [];

  const baseOf = (p) => String(p).split(/[\\/]/).pop();

  /** 任意颜色格式 → #rrggbb（Mermaid style 指令只支持 hex / 命名色，不支持 rgb()/hsl()） */
  function toHex(color) {
    if (!color) return color;
    const s = String(color).trim();
    if (s[0] === '#') return s.length >= 7 ? s.slice(0, 7) : s; // #rgb / #rrggbb / #rrggbbaa → 截断到 6 位
    const rgb = s.match(/^rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (rgb) {
      return '#' + [rgb[1], rgb[2], rgb[3]].map((n) => {
        const v = Math.min(255, Math.max(0, Math.round(parseFloat(n))));
        return v.toString(16).padStart(2, '0');
      }).join('');
    }
    const hsl = s.match(/^hsla?\(([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%/i);
    if (hsl) {
      const h = ((parseFloat(hsl[1]) % 360) + 360) % 360 / 360;
      const s2 = Math.min(1, Math.max(0, parseFloat(hsl[2]) / 100));
      const l = Math.min(1, Math.max(0, parseFloat(hsl[3]) / 100));
      const q = l < 0.5 ? l * (1 + s2) : l + s2 - l * s2;
      const p = 2 * l - q;
      const hue2rgb = (t) => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      return '#' + [hue2rgb(h + 1 / 3), hue2rgb(h), hue2rgb(h - 1 / 3)].map((v) =>
        Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
    }
    return s; // 命名色等原样保留
  }

  /* ============ 消息 / 对话框宿主 ============ */
  const MsgHost = {
    setup() {
      messageApi = N.useMessage();
      dialogApi = N.useDialog();
      return () => null;
    },
  };
  createApp({
    render() {
      return h(N.NConfigProvider, null, {
        default: () => h(N.NMessageProvider, null, {
          default: () => h(N.NDialogProvider, null, { default: () => h(MsgHost) }),
        }),
      });
    },
  }).mount('#naive-host');

  /* ============ 文件树（n-tree，懒加载） ============ */
  const dirCache = {};
  const pendingDirLoad = {};

  async function listDir(dir) {
    if (dirCache[dir]) return dirCache[dir];
    if (pendingDirLoad[dir]) return pendingDirLoad[dir];
    pendingDirLoad[dir] = window.api.listDir(dir).then((r) => {
      delete pendingDirLoad[dir];
      dirCache[dir] = r.canceled ? null : r.items;
      return dirCache[dir];
    });
    return pendingDirLoad[dir];
  }

  const TreeComponent = {
    setup() {
      const data = ref([]);
      const expandedKeys = ref([]);
      const selectedKeys = ref([]);
      let openHandler = null;
      let stateListener = null;
      let rootPath = null;

      function emitState() {
        if (stateListener && rootPath) {
          stateListener({ root: rootPath, expanded: expandedKeys.value.slice() });
        }
      }

      function nodeFor(dir) {
        const items = dirCache[dir];
        if (!items) return { key: dir, label: baseOf(dir), dir, children: undefined };
        return {
          key: dir,
          label: baseOf(dir),
          dir,
          children: items.map((it) => (it.isDir
            ? { key: it.path, label: it.name, dir: it.path, children: undefined }
            : { key: it.path, label: it.name, dir: it.path, isLeaf: true })),
        };
      }

      async function setRoot(dir, expandedList) {
        rootPath = dir;
        Object.keys(dirCache).forEach((k) => delete dirCache[k]);
        await listDir(dir);
        expandedKeys.value = expandedList && expandedList.length ? expandedList.slice() : [dir];
        selectedKeys.value = [];
        data.value = [nodeFor(dir)];
        emitState();
      }

      async function refresh() {
        if (!rootPath) return;
        Object.keys(dirCache).forEach((k) => delete dirCache[k]);
        await listDir(rootPath);
        data.value = [nodeFor(rootPath)];
        emitState();
      }

      function clear() {
        rootPath = null;
        data.value = [];
        expandedKeys.value = [];
        selectedKeys.value = [];
      }

      async function expandToFile(filePath) {
        if (!rootPath) {
          // 尚无根目录：以文件所在目录为根并展开
          await setRoot(String(filePath).split(/[\\/]/).slice(0, -1).join('\\'));
          selectedKeys.value = [filePath];
          await nextTick();
          return;
        }
        // 计算文件祖先链（到根为止），逐层加载并展开
        const chain = [];
        let d = String(filePath).split(/[\\/]/).slice(0, -1).join('\\');
        while (d && d.length >= rootPath.length &&
          (d === rootPath || d.indexOf(rootPath + '\\') === 0 || d.indexOf(rootPath + '/') === 0)) {
          chain.unshift(d);
          if (d === rootPath) break;
          d = String(d).split(/[\\/]/).slice(0, -1).join('\\');
        }
        await Promise.all(chain.map((dir) => listDir(dir)));
        // 重建树数据（已加载的目录展开，其余保持懒加载）
        const rebuild = (dir, depth) => {
          const items = dirCache[dir];
          if (!items) return { key: dir, label: baseOf(dir), dir, children: undefined };
          return {
            key: dir,
            label: baseOf(dir),
            dir,
            children: items.map((it) => (it.isDir
              ? { key: it.path, label: it.name, dir: it.path, children: depth < 0 || expandedKeys.value.indexOf(it.path) >= 0 ? rebuild(it.path, depth - 1) : undefined }
              : { key: it.path, label: it.name, dir: it.path, isLeaf: true })),
          };
        };
        // 先展开链上目录
        chain.forEach((dir) => {
          if (expandedKeys.value.indexOf(dir) < 0) expandedKeys.value.push(dir);
        });
        data.value = [rebuild(rootPath, 8)];
        selectedKeys.value = [filePath];
        await nextTick();
      }

      function onLoad(node) {
        return listDir(node.dir).then((items) => {
          node.children = (items || []).map((it) => (it.isDir
            ? { key: it.path, label: it.name, dir: it.path, children: undefined }
            : { key: it.path, label: it.name, dir: it.path, isLeaf: true }));
        });
      }

      function onUpdateExpanded(keys) {
        expandedKeys.value = keys;
        emitState();
      }
      function onUpdateSelected(keys) {
        selectedKeys.value = keys;
        const key = keys[0];
        if (key && openHandler && key !== rootPath) openHandler(key);
      }

      return {
        data, expandedKeys, selectedKeys,
        setRoot, refresh, clear, expandToFile,
        setOpenHandler(fn) { openHandler = fn; },
        setStateListener(fn) { stateListener = fn; },
        onLoad, onUpdateExpanded, onUpdateSelected,
        _getRoot: () => rootPath,
      };
    },
    expose: ['setRoot', 'refresh', 'clear', 'expandToFile', 'setOpenHandler', 'setStateListener', '_getRoot'],
    render() {
      const self = this;
      if (!self.data || !self.data.length) {
        // 未打开文件夹时的居中空状态
        return h('div', { class: 'file-empty-state' }, [
          h('div', { class: 'file-empty-icon', innerHTML: ME.ICONS.folder }),
          h('div', { class: 'file-empty-title' }, '未打开文件夹'),
          h('div', { class: 'file-empty-hint' }, '点击上方"打开文件夹"加载文件'),
        ]);
      }
      return h(N.NTree, {
        data: self.data,
        blockLine: true,
        'expanded-keys': self.expandedKeys,
        'on-update:expanded-keys': self.onUpdateExpanded,
        'selected-keys': self.selectedKeys,
        'on-update:selected-keys': self.onUpdateSelected,
        onLoad: self.onLoad,
      });
    },
  };

  const TreeHost = {
    setup() {
      const hostRef = ref(null);
      onMounted(() => {
        treeCtl = hostRef.value; // 子组件公开实例（expose 的方法）
        treeReady = true;
        while (treeQueue.length) treeQueue.shift()();
      });
      return { hostRef };
    },
    render() {
      return h(TreeComponent, { ref: 'hostRef' });
    },
  };
  createApp({ render: () => h(TreeHost) }).mount('#tree-host');

  function treeApi(fn) {
    if (treeReady && treeCtl) { fn(treeCtl); return; }
    treeQueue.push(() => { if (treeCtl) fn(treeCtl); });
  }

  /* ============ 缩放滑块（n-slider） ============ */
  const SliderComponent = {
    setup() {
      const val = ref(100);
      let onChange = null;
      function setValue(z) {
        val.value = Math.round(z * 100);
      }
      function onUpdate(v) { val.value = v; if (onChange) onChange(v / 100); }
      return { val, setValue, onUpdate, setChangeHandler(fn) { onChange = fn; } };
    },
    expose: ['setValue', 'setChangeHandler'],
    render() {
      const self = this;
      return h(N.NSlider, {
        value: self.val,
        min: 5, max: 300, step: 5,
        'on-update:value': self.onUpdate,
        style: { width: '110px' },
      });
    },
  };
  const SliderHost = {
    setup() {
      const hostRef = ref(null);
      onMounted(() => {
        sliderCtl = hostRef.value;
        sliderReady = true;
        while (sliderQueue.length) sliderQueue.shift()();
      });
      return { hostRef };
    },
    render() {
      return h(SliderComponent, { ref: 'hostRef' });
    },
  };
  createApp({ render: () => h(SliderHost) }).mount('#zoom-host');

  function sliderApi(fn) {
    if (sliderReady && sliderCtl) { fn(sliderCtl); return; }
    sliderQueue.push(() => { if (sliderCtl) fn(sliderCtl); });
  }

  /* ============ 功能区（Ribbon）：Naive n-button / n-dropdown ============ */
  const ic = (name) => h('span', { class: 'ic', innerHTML: ME.ICONS[name] || '' });

  /** n-dropdown 选中后的动作分发 */
  const RIBBON_SELECT = {
    theme: (k) => { ME.Renderer.setCfg({ theme: k }); ME.Renderer.renderNow(); },
    dir: (k) => { ME.Renderer.setDirection(k); ME.Renderer.renderNow(); },
    curve: (k) => { ME.Renderer.setCfg({ curve: k }); ME.Renderer.renderNow(); },
    font: (k) => { ME.Renderer.setCfg({ fontFamily: k }); ME.Renderer.renderNow(); },
    size: (k) => { ME.Renderer.setCfg({ fontSize: Number(k) }); ME.Renderer.renderNow(); },
  };

  function rbButton(it) {
    const attrs = { class: 'rb-nbtn' + (it.s ? ' small' : '') + (it.toggle ? ' toggle' : '') + (it.on ? ' on' : '') };
    if (it.action) attrs['data-action'] = it.action;
    if (it.dd) attrs['data-dropdown'] = it.dd;
    if (it.layout) attrs['data-layout'] = it.layout;
    if (it.id) attrs.id = it.id;
    if (it.title) attrs.title = it.title;
    const inner = () => h('span', { class: 'rb-inner' }, [
      ic(it.icon),
      it.label ? h('span', { class: 'rb-label' }, it.label) : null,
    ]);
    const btn = h(N.NButton, Object.assign({ size: 'small', secondary: true }, attrs), { default: inner });
    if (it.options) {
      return h(N.NDropdown, {
        options: it.options,
        trigger: 'click',
        onSelect: (key) => { if (RIBBON_SELECT[it.onsel]) RIBBON_SELECT[it.onsel](key); },
      }, { default: () => btn });
    }
    return btn;
  }

  function ribbonGroup(group) {
    if (group.recent) {
      return h('div', { class: 'ribbon-group ribbon-group-recent' }, [
        h('div', { id: 'recent-ribbon' }),
        h('div', { class: 'group-title' }, '最近文件'),
      ]);
    }
    return h('div', { class: 'ribbon-group' }, [
      h('div', { class: 'rb-row' }, group.items.map(rbButton)),
      h('div', { class: 'group-title' }, group.title),
    ]);
  }

  const RIBBON_DATA = {
    file: [
      { title: '文件', items: [
        { action: 'new', icon: 'new', label: '新建', title: 'Ctrl+N' },
        { action: 'open', icon: 'open', label: '打开', title: 'Ctrl+O' },
        { action: 'save', icon: 'save', label: '保存', title: 'Ctrl+S' },
        { action: 'save-as', icon: 'saveas', label: '另存为', title: 'Ctrl+Shift+S' },
      ] },
      { title: '系统', items: [
        { action: 'file-explorer', icon: 'folderopen', label: '资源管理器' },
        { action: 'exit', icon: 'power', label: '退出' },
      ] },
      { title: '导出', items: [
        { action: 'export-png', icon: 'png', label: 'PNG' },
        { action: 'export-svg', icon: 'svgfile', label: 'SVG' },
        { action: 'export-pdf', icon: 'pdffile', label: 'PDF' },
        { action: 'export-md', icon: 'mdfile', label: 'Markdown' },
      ] },
      { recent: 1 },
    ],
    home: [
      { title: '剪贴板', items: [
        { action: 'cut', icon: 'cut', label: '剪切' },
        { action: 'copy', icon: 'copy', label: '复制' },
        { action: 'paste', icon: 'paste', label: '粘贴' },
      ] },
      { title: '编辑', items: [
        { action: 'undo', icon: 'undo', label: '撤销', s: 1 },
        { action: 'redo', icon: 'redo', label: '重做', s: 1 },
      ] },
      { title: '渲染', items: [
        { action: 'render-now', icon: 'render', label: '渲染', title: '立即渲染 (Ctrl+Enter)' },
        { action: 'toggle-autorender', icon: 'eye', label: '自动渲染', s: 1, toggle: 1, on: 1 },
      ] },
      { title: '缩放', items: [
        { action: 'zoom-in', icon: 'zoomin', label: '放大', s: 1 },
        { action: 'zoom-out', icon: 'zoomout', label: '缩小', s: 1 },
        { action: 'zoom-fit', icon: 'fit', label: '适应窗口', s: 1 },
      ] },
    ],
    design: [
      { title: '主题', items: [
        { options: ME.THEMES.map((t) => ({ label: t.label, key: t.value })), label: '主题', icon: 'palette', onsel: 'theme' },
      ] },
      { title: '流程图', items: [
        { options: ME.DIRECTIONS.map((d) => ({ label: d[1], key: d[0] })), label: '方向', icon: 'dir', id: 'btn-dir', onsel: 'dir' },
        { options: ME.CURVES.map((c) => ({ label: c[1], key: c[0] })), label: '曲线', icon: 'curve', onsel: 'curve' },
      ] },
      { title: '文本', items: [
        { options: ME.FONTS.map((f) => ({ label: f[0], key: f[1] })), label: '字体', icon: 'font', onsel: 'font' },
        { options: ME.SIZES.map((s) => ({ label: s + ' pt', key: String(s) })), label: '字号', icon: 'size', onsel: 'size' },
        { dd: 'dd-textcolor', icon: 'textcolor', label: '文字色' },
      ] },
      { title: '页面', items: [{ dd: 'dd-pagebg', icon: 'pagebg', label: '页面背景' }] },
    ],
    view: [
      { title: '编辑模式', items: [
        { action: 'mode-source', icon: 'code', label: '源码', s: 1, toggle: 1, on: 1 },
        { action: 'mode-canvas', icon: 'canvas', label: '自由画布', s: 1, toggle: 1 },
      ] },
      { title: '布局', items: [
        { layout: 'canvas', icon: 'canvas', label: '仅画布', s: 1 },
        { layout: 'code', icon: 'code', label: '仅代码', s: 1 },
      ] },
      { title: '缩放', items: [
        { action: 'zoom-in', icon: 'zoomin', label: '放大', s: 1 },
        { action: 'zoom-out', icon: 'zoomout', label: '缩小', s: 1 },
        { action: 'zoom-fit', icon: 'fit', label: '适应窗口', s: 1 },
        { action: 'zoom-100', icon: 'zoom100', label: '100%', s: 1 },
      ] },
      { title: '显示', items: [
        { action: 'toggle-gutter', icon: 'linenums', label: '行号', s: 1, toggle: 1 },
        { action: 'toggle-grid', icon: 'griddots', label: '网格', s: 1, toggle: 1, on: 1 },
        { action: 'toggle-autorender', icon: 'eye', label: '自动渲染', s: 1, toggle: 1, on: 1 },
      ] },
      { title: '文件同步', items: [
        { action: 'toggle-sync', icon: 'sync', label: '外部同步', s: 1, toggle: 1, title: '外部文件改动自动载入，本应用编辑自动写回' },
      ] },
    ],
  };

  const RibbonComponent = {
    render() {
      const pages = ['home', 'insert', 'design', 'view'];
      const insertGroups = [
        ['流程', 'sg-flow'], ['数据', 'sg-data'], ['结构', 'sg-struct'], ['连接线', 'sg-edges'],
      ];
      return [
        h('div', { class: 'ribbon-page', id: 'page-file' }, RIBBON_DATA.file.map(ribbonGroup)),
        h('div', { class: 'ribbon-page active', id: 'page-home' }, RIBBON_DATA.home.map(ribbonGroup)),
        h('div', { class: 'ribbon-page', id: 'page-insert' }, [
          insertGroups.map((g) => h('div', { class: 'ribbon-group' }, [
            h('div', { class: 'shape-grid', id: g[1] }),
            h('div', { class: 'group-title' }, g[0]),
          ])),
          h('div', { class: 'ribbon-group' }, [
            h('div', { class: 'shape-grid', id: 'sg-types' }),
            h('div', { class: 'group-title' }, '模板'),
          ]),
          h('div', { class: 'ribbon-group' }, [
            h('div', { class: 'shape-grid', id: 'sg-align' }),
            h('div', { class: 'group-title' }, '整理'),
          ]),
        ]),
        h('div', { class: 'ribbon-page', id: 'page-design' }, RIBBON_DATA.design.map(ribbonGroup)),
        h('div', { class: 'ribbon-page', id: 'page-view' }, RIBBON_DATA.view.map(ribbonGroup)),
      ];
    },
  };

  createApp({
    setup() {
      onMounted(() => {
        ribbonReady = true;
        while (ribbonQueue.length) ribbonQueue.shift()();
      });
      return () => h(RibbonComponent);
    },
  }).mount('#ribbon-vue');

  return {
    message: {
      info: (m) => messageApi && messageApi.info(m),
      success: (m) => messageApi && messageApi.success(m),
      warning: (m) => messageApi && messageApi.warning(m),
      error: (m) => messageApi && messageApi.error(m),
    },
    dialog: {
      warn: (o) => dialogApi && dialogApi.warning(o),
      confirm: (o) => dialogApi && dialogApi.create(o),
    },
    tree: {
      setRoot: (dir, expanded) => treeApi((c) => c.setRoot(dir, expanded)),
      refresh: () => treeApi((c) => c.refresh()),
      clear: () => treeApi((c) => c.clear()),
      expandToFile: (p) => treeApi((c) => c.expandToFile(p)),
      setOpenHandler: (fn) => treeApi((c) => c.setOpenHandler(fn)),
      setStateListener: (fn) => treeApi((c) => c.setStateListener(fn)),
    },
    slider: {
      set: (z) => sliderApi((c) => c.setValue(z)),
      onChange: (fn) => sliderApi((c) => c.setChangeHandler(fn)),
    },
    /* 属性面板小控件工厂：mount 到指定容器 */
    widgets: {
      input(host, opts) {
        createApp({
          render: () => h(N.NInput, {
            value: opts.value,
            readonly: !!opts.readonly,
            placeholder: opts.placeholder || '',
            size: 'small',
            'on-update:value': (v) => opts.onchange && opts.onchange(v),
          }),
        }).mount(host);
      },
      select(host, opts) {
        createApp({
          render: () => h(N.NSelect, {
            value: opts.value == null ? null : String(opts.value),
            options: (opts.options || []).map((o) => ({ label: o.label, value: String(o.value) })),
            size: 'small',
            // 弹出层不 teleport 到 body：界面缩放（body zoom）会破坏 fixed 定位，
            // 渲染在宿主内可随缩放容器正确显示
            to: false,
            'on-update:value': (v) => opts.onchange && opts.onchange(v),
          }),
        }).mount(host);
      },
      color(host, opts) {
        createApp({
          render: () => h(N.NColorPicker, {
            // 只允许 hex 模式：Mermaid style 指令不支持 rgb()/hsl()，避免写入源码后解析报错
            value: opts.value,
            showAlpha: false,
            modes: ['hex'],
            size: 'small',
            'on-update:value': (v) => opts.onchange && opts.onchange(toHex(v)),
          }),
        }).mount(host);
      },
    },
    /* 功能区（Ribbon）：Naive n-button 渲染，事件经 app.js 委托处理 */
    onRibbonReady(cb) {
      if (ribbonReady) { cb(); return; }
      ribbonQueue.push(cb);
    },
  };
})();

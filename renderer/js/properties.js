'use strict';
window.ME = window.ME || {};

/* ---------------- 右侧属性面板 ---------------- */
ME.Props = (function () {
  const root = document.getElementById('props-content');
  let current = null; // {kind:'diagram'} | {kind:'node',node} | {kind:'edge',edge,idx}

  function el(tag, cls, text) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
  }

  function row(label, ctrl) {
    const r = el('div', 'prop-row');
    r.appendChild(el('label', '', label));
    r.appendChild(ctrl);
    return r;
  }

  /** 挂载 Naive 控件；属性面板每次重建会销毁旧挂载点（旧 Vue 应用随之释放） */
  function naiveHost() {
    return el('div', 'naive-ctl');
  }

  function textInput(v, onchange, readonly) {
    const host = naiveHost();
    if (ME.Naive && ME.Naive.widgets) {
      ME.Naive.widgets.input(host, { value: v, readonly: readonly, onchange: onchange });
      return host;
    }
    const i = el('input');
    i.type = 'text';
    i.value = v;
    if (readonly) i.readOnly = true;
    i.addEventListener('change', () => onchange(i.value));
    return i;
  }

  function selectCtrl(v, opts, onchange) {
    const host = naiveHost();
    if (ME.Naive && ME.Naive.widgets) {
      ME.Naive.widgets.select(host, { value: v, options: opts, onchange: onchange });
      return host;
    }
    const s = el('select');
    opts.forEach((o) => {
      const oo = el('option', '', o.label);
      oo.value = o.value;
      s.appendChild(oo);
    });
    s.value = v;
    s.addEventListener('change', () => onchange(s.value));
    return s;
  }

  function colorCtrl(v, onchange) {
    const host = naiveHost();
    if (ME.Naive && ME.Naive.widgets) {
      ME.Naive.widgets.color(host, { value: v, onchange: onchange });
      return host;
    }
    const c = el('input');
    c.type = 'color';
    c.value = v;
    c.addEventListener('change', () => onchange(c.value));
    return c;
  }

  /* ---- 样式指令解析 ---- */

  function getNodeStyle(name) {
    const re = new RegExp('^\\s*style\\s+' + ME.escapeRe(name) + '\\s+(.+)$');
    let fill = '', stroke = '', color = '', width = '';
    ME.Editor.getSource().split('\n').forEach((line) => {
      const m = line.match(re);
      if (!m) return;
      m[1].split(',').forEach((part) => {
        const kv = part.trim().split(':');
        const k = kv[0].trim(), v = kv.slice(1).join(':').trim();
        if (k === 'fill') fill = v;
        else if (k === 'stroke') stroke = v;
        else if (k === 'color') color = v;
        else if (k === 'stroke-width') width = parseFloat(v) ? String(parseFloat(v)) : '';
      });
    });
    return { fill: fill, stroke: stroke, color: color, width: width };
  }

  function getNodeStyleLine(srcArr, name) {
    const re = new RegExp('^\\s*style\\s+' + ME.escapeRe(name) + '\\b');
    for (let i = 0; i < srcArr.length; i++) if (re.test(srcArr[i])) return i;
    return -1;
  }

  function getEdgeStyle(idx) {
    const re = new RegExp('^\\s*linkStyle\\s+' + idx + '\\b[^:]*');
    let stroke = '', width = '';
    ME.Editor.getSource().split('\n').forEach((line) => {
      const m = line.match(re);
      if (!m) return;
      const rest = line.slice(m[0].length).replace(/^:/, '').trim();
      rest.split(',').forEach((part) => {
        const kv = part.trim().split(':');
        const k = kv[0].trim(), v = kv.slice(1).join(':').trim();
        if (k === 'stroke') stroke = v;
        else if (k === 'stroke-width') width = parseFloat(v) ? String(parseFloat(v)) : '';
      });
    });
    return { stroke: stroke, width: width };
  }

  /* ---- 图属性 ---- */

  function showDiagram() {
    current = { kind: 'diagram' };
    root.innerHTML = '';
    root.appendChild(el('div', 'prop-sec-title', '图属性'));
    const type = ME.Renderer.detectType(ME.Editor.getSource());
    const cfg = ME.Renderer.getCfg();

    root.appendChild(row('类型', textInput(ME.Renderer.typeName(type), () => {}, true)));
    root.appendChild(row('主题', selectCtrl(cfg.theme, ME.THEMES, (v) => {
      ME.Renderer.setCfg({ theme: v });
      ME.Renderer.renderNow();
    })));

    if (type === 'flow') {
      root.appendChild(row('方向', selectCtrl(cfg.direction, ME.DIRECTIONS.map((d) => ({ value: d[0], label: d[1] })), (v) => {
        ME.Renderer.setDirection(v);
        ME.Renderer.renderNow();
      })));
      root.appendChild(row('曲线', selectCtrl(cfg.curve, ME.CURVES.map((c) => ({ value: c[0], label: c[1] })), (v) => {
        ME.Renderer.setCfg({ curve: v });
        ME.Renderer.renderNow();
      })));
    }

    root.appendChild(row('字体', selectCtrl(cfg.fontFamily, ME.FONTS.map((f) => ({ value: f[1], label: f[0] })), (v) => {
      ME.Renderer.setCfg({ fontFamily: v });
      ME.Renderer.renderNow();
    })));
    root.appendChild(row('字号', selectCtrl(String(cfg.fontSize), ME.SIZES.map((s) => ({ value: String(s), label: String(s) + ' pt' })), (v) => {
      ME.Renderer.setCfg({ fontSize: +v });
      ME.Renderer.renderNow();
    })));
    root.appendChild(row('文字色', colorCtrl(cfg.textColor || '#000000', (v) => {
      ME.Renderer.setCfg({ textColor: v });
      ME.Renderer.renderNow();
    })));
    root.appendChild(row('背景色', colorCtrl(cfg.bg, (v) => {
      ME.Renderer.setCfg({ bg: v });
      ME.app.setPageBg(v);
    })));

    const hint = el('div', 'prop-hint',
      '提示：点击画布中的形状可选中并编辑其属性；双击形状跳转到源代码。\n元素级编辑仅支持流程图（flowchart），其他图类型请直接修改源代码。');
    root.appendChild(hint);
  }

  /* ---- 节点属性 ---- */

  function showNode(node) {
    current = { kind: 'node', node: node };
    root.innerHTML = '';
    root.appendChild(el('div', 'prop-sec-title', '节点属性'));

    const style = getNodeStyle(node.name);
    const implicit = !!node.inline; // 定义在连线行内（如 B --> C[结束] 中的 C）
    root.appendChild(row('名称', textInput(node.name, (v) => renameNode(node, v))));
    root.appendChild(row('文本', implicit ? textInput(node.text, () => {}, true) : textInput(node.text, (v) => applyNode({ text: v }))));
    root.appendChild(row('形状', implicit ? selectCtrl(node.shape, ME.SHAPES.map((s) => ({ value: s.id, label: s.label })), () => {}) : selectCtrl(node.shape, ME.SHAPES.map((s) => ({ value: s.id, label: s.label })), (v) => applyNode({ shape: v }))));
    // 颜色 / 线宽不再单独配置：颜色由主题统一管理，线宽统一默认 1px

    const del = el('button', 'prop-btn danger', '删除此节点');
    del.addEventListener('click', () => deleteNode(node));
    const wr = el('div', 'prop-row');
    wr.appendChild(del);
    root.appendChild(wr);
    root.appendChild(el('div', 'prop-hint',
      implicit
        ? '该节点定义在连线行内（未单独定义），文本 / 形状请在「自由画布」模式修改。'
        : '颜色由主题统一管理（设计页可调整），线宽固定 1px。'));
  }

  function applyNode(patch) {
    if (!current || current.kind !== 'node') return;
    const node = current.node;
    const shape = patch.shape
      ? ME.SHAPES.find((s) => s.id === patch.shape)
      : ME.SHAPES.find((s) => s.id === node.shape);
    if (!shape) return;
    const text = patch.text !== undefined ? patch.text : node.text;
    const name = node.name;
    const src = ME.Editor.getSource().split('\n');

    // 重写定义行（保留缩进）；隐式节点没有独立定义行，跳过
    if (!node.inline && node.line >= 0 && node.line < src.length) {
      const def = src[node.line];
      const dm = def && def.match(/^(\s*)([A-Za-z0-9_\-]+)(\s*).*$/);
      if (dm) {
        src[node.line] = dm[1] + name + dm[3] + shape.t[0] + text + shape.t[1];
      }
    }

    // 重写 / 追加 style 行（线宽统一默认 1px，不再写入 stroke-width）
    const merged = Object.assign(getNodeStyle(name), patch);
    const parts = [];
    if (merged.fill) parts.push('fill:' + merged.fill);
    if (merged.stroke) parts.push('stroke:' + merged.stroke);
    if (merged.color) parts.push('color:' + merged.color);
    const styleLine = getNodeStyleLine(src, name);
    if (parts.length) {
      const line = 'style ' + name + ' ' + parts.join(',');
      if (styleLine >= 0) src[styleLine] = line; else src.push(line);
    } else if (styleLine >= 0) {
      src.splice(styleLine, 1);
    }

    node.text = text;
    node.shape = shape.id;
    ME.Editor.setSource(src.join('\n'));
    ME.Renderer.markNodeSelected(name);
    ME.Renderer.renderNow();
  }

  function renameNode(node, newName) {
    if (newName === node.name) return;
    if (!/^[A-Za-z0-9_\-]+$/.test(newName)) {
      ME.app.toast('节点名称只能包含字母、数字、下划线和连字符', 'error');
      return;
    }
    const old = node.name;
    const src = ME.Editor.getSource().split('\n');
    const isEdgeOrStyle = (line) => line.includes('--') || line.includes('==') || /^\s*(style|linkStyle)\b/.test(line);
    const wordRe = new RegExp('\\b' + ME.escapeRe(old) + '\\b', 'g');
    for (let i = 0; i < src.length; i++) {
      // 隐式节点没有独立定义行，不要改写连线行开头的来源节点名
      if (i === node.line && !node.inline) {
        src[i] = src[i].replace(/^(\s*)[A-Za-z0-9_\-]+/, '$1' + newName);
      } else if (isEdgeOrStyle(src[i])) {
        src[i] = src[i].replace(wordRe, newName);
      }
    }
    ME.Editor.setSource(src.join('\n'));
    ME.Renderer.markNodeSelected(newName);
    ME.Renderer.renderNow();
    ME.app.toast('已重命名为 ' + newName);
  }

  function deleteNode(node) {
    const src = ME.Editor.getSource().split('\n');
    const styleRe = new RegExp('^\\s*style\\s+' + ME.escapeRe(node.name) + '\\b');
    const wordRe = new RegExp('\\b' + ME.escapeRe(node.name) + '\\b');
    const out = [];
    src.forEach((line, i) => {
      if (i === node.line) return;
      if (styleRe.test(line)) return;
      if (line.includes('--') || line.includes('==')) {
        // 连线行中只要出现该节点名（含 B{...} 内联定义形式）即删除
        if (wordRe.test(line)) return;
      }
      out.push(line);
    });
    ME.Editor.setSource(out.join('\n'));
    ME.Renderer.clearSel();
    ME.Renderer.renderNow();
    ME.app.toast('已删除节点「' + node.name + '」及其连线');
  }

  /* ---- 连线属性 ---- */

  function showEdge(edge, idx) {
    current = { kind: 'edge', edge: edge, idx: idx };
    root.innerHTML = '';
    root.appendChild(el('div', 'prop-sec-title', '连线属性'));

    const style = getEdgeStyle(idx);
    const seen = {};
    const connOpts = [];
    ME.EDGES.forEach((e) => {
      if (!seen[e.conn]) { seen[e.conn] = 1; connOpts.push({ value: e.conn, label: e.label }); }
    });

    root.appendChild(row('标签', textInput(edge.label, (v) => applyEdge({ label: v }))));
    root.appendChild(row('线型', selectCtrl(edge.connector, connOpts, (v) => applyEdge({ connector: v }))));
    root.appendChild(row('颜色', colorCtrl(style.stroke || '#333333', (v) => applyEdge({ color: v }))));

    const del = el('button', 'prop-btn danger', '删除此连线');
    del.addEventListener('click', deleteEdge);
    const wr = el('div', 'prop-row');
    wr.appendChild(del);
    root.appendChild(wr);
    root.appendChild(el('div', 'prop-hint',
      edge.from + ' → ' + edge.to + '（' + edge.connector + '）\n线宽统一 1px。'));
  }

  function applyEdge(patch) {
    if (!current || current.kind !== 'edge') return;
    const edge = current.edge;
    const idx = current.idx;
    const src = ME.Editor.getSource().split('\n');

    const label = patch.label !== undefined ? patch.label : edge.label;
    const conn = patch.connector || edge.connector;
    const text = conn + (label ? '|' + label + '|' : '');

    const line = src[edge.line];
    const indent = (line.match(/^\s*/) || [''])[0];
    src[edge.line] = indent + edge.from + ' ' + text + ' ' + edge.to;

    const merged = Object.assign(getEdgeStyle(idx), patch);
    const parts = [];
    if (merged.stroke) parts.push('stroke:' + merged.stroke);
    // 线宽统一默认 1px，不再写入 stroke-width
    const lsRe = new RegExp('^\\s*linkStyle\\s+' + idx + '\\b');
    const lsIdx = src.findIndex((l) => lsRe.test(l));
    if (parts.length) {
      const ls = 'linkStyle ' + idx + ' ' + parts.join(',');
      if (lsIdx >= 0) src[lsIdx] = ls; else src.push(ls);
    } else if (lsIdx >= 0) {
      src.splice(lsIdx, 1);
    }

    edge.label = label;
    edge.connector = conn;
    ME.Editor.setSource(src.join('\n'));
    ME.Renderer.markEdgeSelected(idx);
    ME.Renderer.renderNow();
  }

  function deleteEdge() {
    if (!current || current.kind !== 'edge') return;
    const edge = current.edge;
    const idx = current.idx;
    const src = ME.Editor.getSource().split('\n');
    const lsRe = new RegExp('^\\s*linkStyle\\s+' + idx + '\\b');
    const out = [];
    src.forEach((line, i) => {
      if (i === edge.line) return;
      if (lsRe.test(line)) return;
      out.push(line);
    });
    ME.Editor.setSource(out.join('\n'));
    ME.Renderer.clearSel();
    ME.Renderer.renderNow();
    ME.app.toast('已删除连线');
  }

  /* ---- 渲染后同步 ---- */

  function afterRender() {
    if (ME.Canvas && ME.Canvas.active) return; // 画布模式由画布自己刷新属性面板
    if (!current) { showDiagram(); return; }
    if (current.kind === 'diagram') { showDiagram(); return; }
    if (current.kind === 'node') {
      const fresh = ME.Renderer.parseNodes().find((n) => n.name === current.node.name);
      if (!fresh) { current = null; showDiagram(); return; }
      current.node = fresh;
      showNode(fresh);
      return;
    }
    if (current.kind === 'edge') {
      const fresh = ME.Renderer.parseEdges()[current.idx];
      if (!fresh) { current = null; showDiagram(); return; }
      current.edge = fresh;
      showEdge(fresh, current.idx);
    }
  }

  /* ---- 自由画布属性 ---- */

  function showCanvasDiagram() {
    current = { kind: 'canvas-diagram' };
    root.innerHTML = '';
    root.appendChild(el('div', 'prop-sec-title', '自由画布'));
    const m = ME.Canvas.getModel();
    root.appendChild(row('节点', textInput(String(m.nodes.length), () => {}, true)));
    root.appendChild(row('连线', textInput(String(m.edges.length), () => {}, true)));
    const hint = el('div', 'prop-hint',
      '· 从左侧形状面板拖形状到画布\n' +
      '· 单击选中，拖动移动（Shift 多选）\n' +
      '· 画箭头：点左侧「箭头」等连接线图标，再依次点两个节点；或拖动选中节点的 ● 端口\n' +
      '· 选中连线后拖动两端的小圆点可改接到其他节点\n' +
      '· 双击节点编辑文字，Delete 删除，Ctrl+D 复制\n' +
      '· 画布操作自动写回 Mermaid 源码\n' +
      '· 节点位置以 %% 注释保存在源码中，不影响渲染');
    root.appendChild(hint);
  }

  function showCanvasNode(node) {
    current = { kind: 'canvas-node', id: node.id };
    root.innerHTML = '';
    root.appendChild(el('div', 'prop-sec-title', '节点属性'));
    root.appendChild(row('文本', textInput(node.label, (v) => ME.Canvas.updateNode(node.id, { label: v }))));
    root.appendChild(row('形状', selectCtrl(node.shape, ME.SHAPES.map((s) => ({ value: s.id, label: s.label })), (v) => ME.Canvas.updateNode(node.id, { shape: v }))));
    // 颜色 / 线宽不再单独配置：颜色由主题统一管理，线宽统一默认 1px

    const del = el('button', 'prop-btn danger', '删除此节点');
    del.addEventListener('click', () => ME.Canvas.removeNodes([node.id]));
    const wr = el('div', 'prop-row');
    wr.appendChild(del);
    root.appendChild(wr);
    root.appendChild(el('div', 'prop-hint', '修改会立即写回 Mermaid 源码，并保留在 %% 注释中的画布位置。颜色由主题统一管理（设计页可调整），线宽固定 1px。'));
  }

  function showCanvasEdge(edge) {
    current = { kind: 'canvas-edge', id: edge.id };
    root.innerHTML = '';
    root.appendChild(el('div', 'prop-sec-title', '连线属性'));
    const seen = {};
    const connOpts = [];
    ME.EDGES.forEach((e) => {
      if (!seen[e.conn]) { seen[e.conn] = 1; connOpts.push({ value: e.conn, label: e.label }); }
    });
    root.appendChild(row('标签', textInput(edge.label, (v) => ME.Canvas.updateEdge(edge.id, { label: v }))));
    root.appendChild(row('线型', selectCtrl(edge.connector, connOpts, (v) => ME.Canvas.updateEdge(edge.id, { connector: v }))));
    root.appendChild(row('颜色', colorCtrl(edge.color || '#333333', (v) => ME.Canvas.updateEdge(edge.id, { color: v }))));

    const del = el('button', 'prop-btn danger', '删除此连线');
    del.addEventListener('click', () => ME.Canvas.removeEdge(edge.id));
    const wr = el('div', 'prop-row');
    wr.appendChild(del);
    root.appendChild(wr);
    root.appendChild(el('div', 'prop-hint', edge.from + ' → ' + edge.to + '（' + edge.connector + '）\n修改会以 linkStyle 指令写回 Mermaid 源码，线宽统一 1px。'));
  }

  function showCanvasMulti(count) {
    current = { kind: 'canvas-multi' };
    root.innerHTML = '';
    root.appendChild(el('div', 'prop-sec-title', '已选 ' + count + ' 个对象'));
    root.appendChild(el('div', 'prop-hint', '拖动可整体移动；按 Delete 删除所选（连线一并删除）。'));
    const del = el('button', 'prop-btn danger', '删除所选');
    del.addEventListener('click', () => ME.Canvas.removeNodes(ME.Canvas.selectedIds()));
    const wr = el('div', 'prop-row');
    wr.appendChild(del);
    root.appendChild(wr);
  }

  return {
    showDiagram: showDiagram,
    showNode: showNode,
    showEdge: showEdge,
    afterRender: afterRender,
    showCanvasDiagram: showCanvasDiagram,
    showCanvasNode: showCanvasNode,
    showCanvasEdge: showCanvasEdge,
    showCanvasMulti: showCanvasMulti,
  };
})();

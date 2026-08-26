'use strict';
window.ME = window.ME || {};

/* ---------------- Mermaid 渲染与交互 ---------------- */
ME.Renderer = (function () {
  const diagram = document.getElementById('diagram');
  const errorStrip = document.getElementById('error-strip');
  const errorText = document.getElementById('error-text');
  const page = document.getElementById('page');

  let renderSeq = 0;
  let zoom = 1;
  let timer = null;
  let selRef = null; // {kind:'node',name} | {kind:'edge',idx}
  let rawW = 0, rawH = 0; // 源码模式 svg 的原始内容尺寸（viewBox 像素，缩放基准）
  let fitOnRender = false; // 打开文件时置位：下次渲染后强制 zoomFit 适应窗口

  const cfg = {
    theme: 'default',
    curve: 'basis',
    direction: 'TB',
    fontSize: 16,
    fontFamily: '"Microsoft YaHei","微软雅黑",sans-serif',
    textColor: '',
    bg: '#ffffff',
  };

  /* ---- 图类型 ---- */
  const TYPE_RE = /^\s*(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram-v2|stateDiagram|erDiagram|gantt|pie|journey|mindmap|timeline|gitGraph)/;

  function detectType(src) {
    const m = String(src || '').match(TYPE_RE);
    if (!m) return 'flow';
    const kw = m[1];
    if (kw === 'flowchart' || kw === 'graph') return 'flow';
    if (kw === 'stateDiagram' || kw === 'stateDiagram-v2') return 'state';
    return ({
      sequenceDiagram: 'sequence', classDiagram: 'class', erDiagram: 'er',
      gantt: 'gantt', pie: 'pie', journey: 'journey', mindmap: 'mindmap',
      timeline: 'timeline', gitGraph: 'git',
    })[kw] || 'flow';
  }

  function typeName(t) { return ME.DIAGRAM_TYPES[t] || '未知'; }

  /** 标签写入 Mermaid 源码前的转义（与画布模式一致；mermaid htmlLabels 会把实体渲染回原字符） */
  function escLabel(t) {
    return String(t)
      .replace(/&/g, '&amp;')
      .replace(/\(/g, '&#40;').replace(/\)/g, '&#41;')
      .replace(/\|/g, '&#124;')
      .replace(/\[/g, '&#91;').replace(/\]/g, '&#93;')
      .replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  /** 从源码标签解码回原字符 */
  function unescLabel(t) {
    return String(t)
      .replace(/&#40;/g, '(').replace(/&#41;/g, ')')
      .replace(/&#124;/g, '|').replace(/&#91;/g, '[').replace(/&#93;/g, ']')
      .replace(/&#123;/g, '{').replace(/&#125;/g, '}')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  /* ---- 源代码解析（流程图） ---- */
  const TOKEN_MAP = new Map();
  ME.SHAPES.forEach((s) => {
    const st = s.t[0];
    if (!TOKEN_MAP.has(st)) TOKEN_MAP.set(st, []);
    TOKEN_MAP.get(st).push(s);
  });
  const TOKEN_STARTS = [...TOKEN_MAP.keys()].sort((a, b) => b.length - a.length);

  const CONNS = ['-.->', '==>', '--o', '--x', '-.-', '---', '-->', '===', '--', '-.'];

  /** 在 rest 中从 startLen 起匹配形状结束 token：优先正确 token（t[1]），
   *  找不到再尝试 legacyEnd（兼容旧版本错误的 stadium/database 结束符）。
   *  返回 { pos, end, shape }，pos<0 表示未匹配 */
  function matchShapeEnd(rest, cands, startLen) {
    let pos = -1, end = '', shape = cands[0];
    for (const c of cands) {
      let p = rest.indexOf(c.t[1], startLen);
      let e = c.t[1];
      if (p < 0 && c.legacyEnd) { p = rest.indexOf(c.legacyEnd, startLen); e = c.legacyEnd; }
      if (p >= 0 && (pos < 0 || p < pos)) { pos = p; end = e; shape = c; }
    }
    return { pos: pos, end: end, shape: shape };
  }

  /** 若 rest 以形状 token 开头（如 A[文本] --> B），消费掉该内联定义并返回剩余部分 */
  function skipInlineShape(rest) {
    for (const st of TOKEN_STARTS) {
      if (!rest.startsWith(st)) continue;
      const r = matchShapeEnd(rest, TOKEN_MAP.get(st), st.length);
      if (r.pos >= 0) return rest.slice(r.pos + r.end.length).trim();
    }
    return null;
  }

  /** 目标节点可能带形状后缀：B --> C[结束] → C；若带形状定义则返回内联节点信息 */
  function stripShapeSuffix(tok) {
    const m = String(tok).match(/^([A-Za-z0-9_\-]+)/);
    return m ? m[1] : tok;
  }

  function matchShapeSuffix(tok) {
    const m = String(tok).match(/^([A-Za-z0-9_\-]+)(.*)$/);
    if (!m || !m[2]) return null;
    const rest = m[2];
    for (const st of TOKEN_STARTS) {
      if (!rest.startsWith(st)) continue;
      const r = matchShapeEnd(rest, TOKEN_MAP.get(st), st.length);
      if (r.pos >= 0) {
        return { name: m[1], text: rest.slice(st.length, r.pos).trim(), shape: r.shape.id };
      }
    }
    return null;
  }

  function parseEdgeLine(line, idx, out, inlineOut) {
    const m = line.match(/^([A-Za-z0-9_\-]+)(.*)$/);
    if (!m) return;
    const from = m[1];
    let rest = m[2].trim();
    const skip = skipInlineShape(rest);
    if (skip !== null) rest = skip;
    const conn = CONNS.find((c) => rest.startsWith(c));
    if (!conn) return;
    rest = rest.slice(conn.length).trim();
    let label = '';
    if (rest.startsWith('|')) {
      const e = rest.indexOf('|', 1);
      if (e > 0) { label = rest.slice(1, e); rest = rest.slice(e + 1).trim(); }
    }
    let to = '';
    if (conn === '--' || conn === '-.') {
      // 形如 A -- 标签 --> B
      const p = rest.lastIndexOf('-->');
      if (p >= 0) {
        const pre = rest.slice(0, p).trim();
        if (pre) label = pre;
        to = rest.slice(p + 3).trim();
      } else {
        to = (rest.split(/\s+/)[0] || '').trim();
      }
    } else {
      to = (rest.split(/\s+/)[0] || '').trim();
    }
    const inline = matchShapeSuffix(to);
    to = inline ? inline.name : stripShapeSuffix(to);
    if (!/^[A-Za-z0-9_\-]+$/.test(to)) return;
    if (inline && inlineOut) inlineOut.push(Object.assign({}, inline, { line: idx }));
    out.push({ from: from, to: to, label: label, connector: conn, line: idx, raw: line });
  }

  function parseFlow(src) {
    const lines = String(src || '').split('\n');
    const nodes = [];
    const edges = [];
    const inlineNodes = [];
    lines.forEach((raw, idx) => {
      const line = raw.trim();
      if (!line || line.startsWith('%%')) return;
      const m = line.match(/^([A-Za-z0-9_\-]+)(.*)$/);
      if (!m) return;
      const name = m[1];
      const rest = m[2].trim();
      if (!rest) return;
      if (rest.startsWith('-') || rest.startsWith('=')) {
        parseEdgeLine(line, idx, edges, inlineNodes);
        return;
      }
      for (const st of TOKEN_STARTS) {
        if (rest.startsWith(st)) {
          const r = matchShapeEnd(rest, TOKEN_MAP.get(st), st.length);
          if (r.pos < 0) return;
          nodes.push({
            name: name,
            text: rest.slice(st.length, r.pos).trim(),
            shape: r.shape.id,
            line: idx,
            raw: line,
          });
          // 同行内联连线：A[文本] --> B
          const rem = rest.slice(r.pos + r.end.length).trim();
          if (rem && (rem.startsWith('-') || rem.startsWith('='))) {
            parseEdgeLine(name + ' ' + rem, idx, edges, inlineNodes);
          }
          return;
        }
      }
    });
    return { nodes: nodes, edges: edges, inlineNodes: inlineNodes };
  }

  /** 全部节点 = 显式定义 + 连线内联定义（B --> C[结束] 中的 C）+ 其余仅出现在连线中的端点
   *  隐式节点记录其所在的连线行号，便于点击时在代码中高亮定位 */
  function parseNodes() {
    const flow = parseFlow(ME.Editor.getSource());
    const byName = new Map();
    flow.nodes.forEach((n) => byName.set(n.name, n));
    (flow.inlineNodes || []).forEach((n) => {
      if (!byName.has(n.name)) byName.set(n.name, Object.assign({}, n, { inline: true, line: n.line >= 0 ? n.line : -1 }));
    });
    flow.edges.forEach((e) => {
      if (!byName.has(e.from)) byName.set(e.from, { name: e.from, text: e.from, shape: 'rect', inline: true, line: e.line });
      if (!byName.has(e.to)) byName.set(e.to, { name: e.to, text: e.to, shape: 'rect', inline: true, line: e.line });
    });
    return [...byName.values()];
  }
  function parseEdges() { return parseFlow(ME.Editor.getSource()).edges; }
  function findNodeAtLine(idx) {
    return parseNodes().find((n) => n.line === idx) || null;
  }

  /* ---- 渲染 ---- */
  /* mermaid 10.x 的 render 并发不安全（共享内部状态），所有渲染进串行队列 */
  let renderChain = Promise.resolve();
  function serialize(fn) {
    const run = renderChain.then(fn, fn);
    renderChain = run.catch(() => {});
    return run;
  }

  /** mermaid.render 失败时会把临时容器（id 形如 dlay-1 / dmmd-1）残留在 body 底部，
   *  内含 "Syntax error in text" 错误 SVG；渲染失败后必须手动清理 */
  function cleanupTempContainer(id) {
    try {
      const el = document.getElementById('d' + id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    } catch (e) { /* ignore */ }
  }

  /** 画布配色与界面（Naive UI）一致 */
  const UI_THEME_VARS = {
    primaryColor: '#18a058',
    primaryBorderColor: '#36ad6a',
    primaryTextColor: '#0C7A43',
    lineColor: '#666C75',
    textColor: '#333639',
    mainBkg: '#FFFFFF',
    nodeBorder: '#C9CDD4',
    clusterBkg: '#F5F5F7',
    clusterBorder: '#E0E0E6',
    edgeLabelBackground: '#FFFFFF',
    titleColor: '#333639',
    fontSize: '14px',
  };

  function getConfig() {
    const c = {
      startOnLoad: false,
      securityLevel: 'loose',
      theme: cfg.theme,
      fontFamily: cfg.fontFamily,
      fontSize: cfg.fontSize,
      useMaxWidth: false, // svg 按原始像素尺寸渲染，不压缩到容器宽度（画布显示范围跟随内容）
      flowchart: { curve: cfg.curve, htmlLabels: true },
      themeVariables: Object.assign({}, UI_THEME_VARS),
    };
    if (cfg.textColor) {
      c.themeVariables.fontColor = cfg.textColor;
      c.themeVariables.fontSize = cfg.fontSize;
    }
    return c;
  }

  function doRender() {
    return serialize(doRenderImpl);
  }

  async function doRenderImpl() {
    const src = ME.Editor.getSource();
    // 自由画布模式下 #diagram 由 ME.Canvas 接管，不在此渲染
    if (window.ME.Canvas && ME.Canvas.active) return;
    closeEditBox(); // 渲染重建 DOM 前关闭就地编辑框
    errorStrip.classList.add('hidden');
    if (!src.trim()) {
      diagram.innerHTML = '<div id="empty-hint">在下方编辑 Mermaid 源代码开始绘图\n或从左侧拖入形状</div>';
      selRef = null;
      ME.app.setStatus('就绪');
      ME.app.setCount(0, 0);
      ME.Props.afterRender();
      return;
    }
    const id = 'mmd-' + (++renderSeq);
    try {
      window.mermaid.initialize(getConfig());
      const res = await window.mermaid.render(id, src);
      diagram.innerHTML = res.svg;
      // mermaid 默认输出 width="100%" + style="max-width:…"，会把画布压缩到容器宽度；
      // 改为按 viewBox 原始像素尺寸显示（缩放时直接改 svg width/height，布局同步，滚动条正常）
      const svgEl = diagram.querySelector('svg');
      if (svgEl) {
        const vb = svgEl.getAttribute('viewBox');
        if (vb) {
          const parts = vb.trim().split(/\s+/).map(parseFloat);
          if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
            rawW = parts[2];
            rawH = parts[3];
            svgEl.setAttribute('width', Math.ceil(parts[2]));
            svgEl.setAttribute('height', Math.ceil(parts[3]));
          }
        }
        svgEl.removeAttribute('style');
      }
      attachClicks();
      restoreSel();
      const n = diagram.querySelectorAll('g.node').length;
      let e = diagram.querySelectorAll('.edgePath').length;
      if (!e) e = diagram.querySelectorAll('.edgePaths > path').length;
      // 渲染重建了 svg，重新应用当前缩放（缩放写在 svg 尺寸上，不重建即丢失）
      if (Math.abs(zoom - 1) >= 0.01) setZoom(zoom);
      // 打开文件时强制适应窗口（fitOnRender 由 app.js 打开文件时置位）
      if (fitOnRender) { fitOnRender = false; zoomFit(); }
      // 大流程自适应：内容超出可视区时自动缩放适应窗口，避免画布太小看不到全貌
      else autoFitIfOversized();
      ME.app.setStatus('渲染成功', 'ok');
      ME.app.setCount(n, e);
      ME.app.syncUiChecks();
      ME.Props.afterRender();
    } catch (err) {
      const msg = String((err && (err.message || err.str)) || err);
      cleanupTempContainer(id);
      if (errorText) errorText.textContent = '渲染错误：' + msg;
      errorStrip.classList.remove('hidden');
      ME.app.setStatus('渲染失败', 'error');
      ME.Props.afterRender();
    }
  }

  function scheduleRender() {
    clearTimeout(timer);
    timer = setTimeout(doRender, 800);
  }

  function renderNow() {
    clearTimeout(timer);
    doRender();
  }

  /* ---- 选中态 ---- */
  /** 获取所有连线元素（兼容 mermaid 10.x 的 g.flowchart-link 结构与旧版 .edgePath） */
  function edgeEls() {
    return diagram.querySelectorAll('g.flowchart-link, .edgePath, .edgePaths > path');
  }

  function clearSel() {
    selRef = null;
    diagram.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
    ME.Props.showDiagram();
  }

  function restoreSel() {
    diagram.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
    if (!selRef) return;
    if (selRef.kind === 'node') {
      const node = parseNodes().find((n) => n.name === selRef.name);
      if (!node) { selRef = null; ME.Props.showDiagram(); return; }
      const g = findNodeElByNode(node);
      if (g) g.classList.add('sel');
      ME.Props.showNode(node);
    } else if (selRef.kind === 'edge') {
      const edges = parseEdges();
      if (selRef.idx >= edges.length) { selRef = null; ME.Props.showDiagram(); return; }
      const all = edgeEls();
      if (all[selRef.idx]) all[selRef.idx].classList.add('sel');
      ME.Props.showEdge(edges[selRef.idx], selRef.idx);
    }
  }

  /** 源码节点文本 → DOM 标签文本：去掉定义引号并解码实体（如 "main.py&lt;br/&gt;x" → main.py<br/>x） */
  function nodeDomLabel(n) {
    return unescLabel(String(n.text || n.name).replace(/^"|"$/g, ''));
  }

  function findNodeElByLabel(label) {
    const els = diagram.querySelectorAll('g.node');
    for (const g of els) {
      const el = g.querySelector('.nodeLabel') || g.querySelector('span') || g.querySelector('text');
      if (el && (el.textContent || '').trim() === String(label).trim()) return g;
    }
    return null;
  }

  /** 按源码节点找对应渲染元素（文本经引号/实体规范化后匹配） */
  function findNodeElByNode(node) {
    const domLabel = nodeDomLabel(node);
    let g = findNodeElByLabel(domLabel);
    if (!g) g = findNodeElByLabel(node.name);
    return g;
  }

  function findNodeByDomLabel(label) {
    const nodes = parseNodes();
    return nodes.find((n) => nodeDomLabel(n) === label) || nodes.find((n) => n.name === label) || null;
  }

  function clearSelKeepProps() {
    diagram.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
  }

  function selectNode(node, gEl) {
    clearSelKeepProps();
    selRef = { kind: 'node', name: node.name };
    if (gEl) gEl.classList.add('sel');
    ME.Editor.selectLine(node.line, { onSelect: () => {} });
    ME.Props.showNode(node);
  }

  function selectEdge(edge, idx, el) {
    clearSelKeepProps();
    selRef = { kind: 'edge', idx: idx };
    if (el) el.classList.add('sel');
    else {
      const all = edgeEls();
      if (all[idx]) all[idx].classList.add('sel');
    }
    ME.Editor.selectLine(edge.line, { onSelect: () => {} });
    ME.Props.showEdge(edge, idx);
  }

  function attachClicks() {
    const nodes = parseNodes();
    diagram.querySelectorAll('g.node').forEach((g) => {
      const el = g.querySelector('.nodeLabel') || g.querySelector('span') || g.querySelector('text');
      const label = el ? (el.textContent || '').trim() : '';
      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const node = findNodeByDomLabel(label);
        if (node) selectNode(node, g); else clearSel();
      });
      g.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        const node = findNodeByDomLabel(label);
        if (node) {
          selRef = { kind: 'node', name: node.name };
          ME.Props.showNode(node);
          startNodeEdit(node, g);
        }
      });
    });
    const pathEls = edgeEls();
    const edges = parseEdges();
    pathEls.forEach((el, i) => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (edges[i]) selectEdge(edges[i], i, el);
      });
      el.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        if (edges[i]) {
          selectEdge(edges[i], i, el);
          startEdgeEdit(edges[i], el);
        }
      });
    });
    diagram.querySelectorAll('.edgeLabel').forEach((g) => {
      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const txt = (g.textContent || '').trim();
        const idx = edges.findIndex((e) => e.label === txt);
        if (idx >= 0) selectEdge(edges[idx], idx, null);
      });
      g.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        const txt = (g.textContent || '').trim();
        const idx = edges.findIndex((e) => e.label === txt);
        if (idx >= 0) startEdgeEdit(edges[idx], g);
      });
    });
    // 点击画布空白处取消选中
    diagram.addEventListener('click', (e) => {
      if (!e.target.closest('g.node') && !e.target.closest('.edgePath') && !e.target.closest('.edgeLabel')) {
        clearSel();
      }
    });
  }

  /* ---- 双击就地编辑（源码模式）：节点文本 / 连线标签 ---- */
  let editInput = null; // 当前就地编辑的输入框

  /** 在目标元素上方浮出编辑框，提交后把新值写回源码并重渲染 */
  function openEditBox(anchorEl, value, placeholder, onCommit) {
    closeEditBox();
    const r = anchorEl.getBoundingClientRect();
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.placeholder = placeholder || '';
    input.style.cssText = 'position:fixed;z-index:9999;min-width:140px;width:' +
      Math.max(140, Math.round(r.width)) + 'px;height:30px;padding:0 8px;font-size:13px;' +
      'border:2px solid #18a058;border-radius:4px;outline:none;box-shadow:0 4px 14px rgba(0,0,0,.18);' +
      'font-family:inherit;box-sizing:border-box;';
    input.style.left = Math.round(r.left + r.width / 2 - Math.max(140, r.width) / 2) + 'px';
    input.style.top = Math.round(r.top - 36) + 'px';
    document.body.appendChild(input);
    editInput = input;
    const finish = (commit) => {
      if (editInput !== input) return;
      editInput = null;
      input.remove();
      if (commit) onCommit(input.value);
    };
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') finish(true);
      else if (ev.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.focus();
    input.select();
  }

  function closeEditBox() {
    if (editInput) { editInput.remove(); editInput = null; }
  }

  /** 双击节点 → 就地编辑节点文本，写回源码对应行的定义 */
  function startNodeEdit(node, gEl) {
    if (node.inline) {
      // 内联节点（只在连线行里定义，如 B --> C[文本]）：直接定位源码行
      ME.Editor.selectLine(node.line, { focus: true });
      ME.app.toast('内联节点请在源码中编辑', 'info');
      return;
    }
    if (node.line < 0) return;
    // 找到源码中该节点的定义（形如 name["文本"]），取当前文本
    const lines = ME.Editor.getSource().split('\n');
    const raw = lines[node.line] || '';
    const def = extractNodeDef(raw, node.name);
    if (!def) { ME.Editor.selectLine(node.line, { focus: true }); return; }
    const shape = ME.SHAPES.find((s) => s.id === node.shape);
    const t0 = shape ? shape.t[0] : '[';
    const t1 = shape ? shape.t[1] : ']';
    const value = nodeDomLabel(node);
    openEditBox(gEl, value, '节点文本', (v) => {
      const next = lines.slice();
      // 保留原引号风格：name[t0] 后原有引号则保留，否则不加
      const afterTok = raw.slice(def.start + node.name.length + t0.length);
      const hasQuote = /^"/.test(afterTok);
      next[node.line] = raw.slice(0, def.start) + node.name + t0 +
        (hasQuote ? '"' : '') + escLabel(v) + (hasQuote ? '"' : '') + t1 + raw.slice(def.end);
      ME.Editor.setSource(next.join('\n'));
      selRef = { kind: 'node', name: node.name };
    });
  }

  /** 从节点定义行中提取 name[ 起始位置与定义结束位置（含结束 token） */
  function extractNodeDef(raw, name) {
    const shapes = ME.SHAPES.map((s) => s.t[0]).sort((a, b) => b.length - a.length);
    for (const t0 of shapes) {
      const idx = raw.indexOf(name + t0);
      if (idx < 0) continue;
      const t1 = (ME.SHAPES.find((s) => s.t[0] === t0) || {}).t[1] || ']';
      const end = raw.indexOf(t1, idx + name.length + t0.length);
      if (end >= 0) return { start: idx, end: end + t1.length };
    }
    return null;
  }

  /** 双击连线 → 就地编辑标签，写回源码对应行的 |标签| */
  function startEdgeEdit(edge, el) {
    const lines = ME.Editor.getSource().split('\n');
    const raw = lines[edge.line] || '';
    const conn = edge.connector || '-->';
    // 在行中定位标签位置：A -->|label| B（conn 后紧跟 |）
    const fromIdx = raw.indexOf(edge.from);
    const connIdx = fromIdx >= 0 ? raw.indexOf(conn, fromIdx + edge.from.length) : -1;
    if (connIdx < 0) { ME.Editor.selectLine(edge.line, { focus: true }); return; }
    let barStart = raw.indexOf('|', connIdx + conn.length);
    let hasBar = barStart >= 0;
    if (!hasBar) {
      // 兼容 A -- label --> B 形式：标签在 -- 与 --> 之间
      barStart = connIdx + conn.length;
      hasBar = true;
    }
    const barEnd = hasBar ? raw.indexOf('|', barStart + 1) : -1;
    openEditBox(el, unescLabel(edge.label || ''), '连线标签', (v) => {
      const next = lines.slice();
      if (barEnd >= 0) {
        next[edge.line] = raw.slice(0, barStart + 1) + escLabel(v) + raw.slice(barEnd);
      } else {
        // 无 | 包裹（-- label --> 形式）：替换 -- 与 --> 之间的文本
        const arrow = raw.indexOf('-->', barStart);
        if (arrow >= 0) {
          next[edge.line] = raw.slice(0, barStart) + (v ? ' ' + escLabel(v) + ' ' : ' ') + raw.slice(arrow);
        } else {
          next[edge.line] = raw.slice(0, barStart) + (v ? ' |' + escLabel(v) + '| ' : ' ') + raw.slice(barStart + conn.length);
        }
      }
      ME.Editor.setSource(next.join('\n'));
      selRef = { kind: 'edge', idx: edge.line >= 0 ? edgesIndexOf(edge) : 0 };
    });
  }

  function edgesIndexOf(edge) {
    return parseEdges().findIndex((e) => e.line === edge.line && e.from === edge.from && e.to === edge.to);
  }

  /* ---- 缩放 ---- */
  const ZOOM_MIN = 0.05; // 源码模式大图（如超宽横向布局）需要缩到很小才能完整可见
  /** 源码模式缩放：直接改 svg width/height（矢量缩放），布局尺寸同步 → 滚动条范围 = 实际显示范围 */
  function setZoom(z) {
    zoom = Math.min(3, Math.max(ZOOM_MIN, z));
    const svg = diagram.querySelector('svg');
    if (svg && rawW > 0 && rawH > 0) {
      svg.setAttribute('width', Math.round(rawW * zoom));
      svg.setAttribute('height', Math.round(rawH * zoom));
    }
    ME.app.updateZoomUI(zoom);
  }

  /** 以屏幕坐标 (clientX,clientY) 为锚点缩放（与自由画布滚轮行为一致）：锚点处内容保持不动 */
  function zoomAt(clientX, clientY, factor) {
    const svg = diagram.querySelector('svg');
    if (!svg || rawW <= 0 || rawH <= 0) return;
    const ca = document.getElementById('canvas-area');
    if (!ca) return;
    const oldSr = svg.getBoundingClientRect();
    if (oldSr.width <= 0 || oldSr.height <= 0) return;
    // 鼠标下的内容坐标（相对 svg 内容原点；getBoundingClientRect 已含滚动偏移）
    const contentX = (clientX - oldSr.left) / zoom;
    const contentY = (clientY - oldSr.top) / zoom;
    const nf = Math.min(3, Math.max(ZOOM_MIN, zoom * factor));
    if (nf === zoom) return;
    const sl0 = ca.scrollLeft, st0 = ca.scrollTop;
    zoom = nf;
    svg.setAttribute('width', Math.round(rawW * zoom));
    svg.setAttribute('height', Math.round(rawH * zoom));
    // 缩放后 svg 文档位置可能因居中布局变化：读新 rect（此时滚动未变），
    // 目标锚点不动：clientX = newSr.left + scrollLeft0 + contentX*zoom - scrollLeft1
    const newSr = svg.getBoundingClientRect();
    ca.scrollLeft = newSr.left + sl0 + contentX * zoom - clientX;
    ca.scrollTop = newSr.top + st0 + contentY * zoom - clientY;
    ME.app.updateZoomUI(zoom);
  }

  function zoomIn() { setZoom(zoom + 0.1); }
  function zoomOut() { setZoom(zoom - 0.1); }
  function zoom100() { setZoom(1); }
  function getZoom() { return zoom; }

  /** 隐藏渲染流程图，返回 节点文本 → {x,y,w,h} 的布局坐标表（自由画布导入用）
   *  注意：用 getBoundingClientRect 取全局坐标（getBBox 是局部坐标，不含祖先 transform）
   *  渲染走串行队列，失败自动重试（mermaid 并发渲染会抛错） */
  async function layoutFlow(src) {
    const box = document.getElementById('layout-src');
    if (!box) return null;
    const svgRectOf = (svgEl) => svgEl.getBoundingClientRect();
    return serialize(async () => {
      const id = 'lay-' + (++renderSeq);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          window.mermaid.initialize(getConfig());
          const res = await window.mermaid.render(id, src);
          box.innerHTML = res.svg;
          const svgEl = box.querySelector('svg');
          if (!svgEl) {
            console.warn('layoutFlow no svg element, svgLen=' + String(res && res.svg || '').length + ' id=' + id);
            box.innerHTML = '';
            return null;
          }
          const svgRect = svgRectOf(svgEl);
          const map = {};
          box.querySelectorAll('g.node').forEach((g) => {
            const el = g.querySelector('.nodeLabel') || g.querySelector('span') || g.querySelector('text');
            const label = el ? (el.textContent || '').trim() : '';
            if (!label) return;
            const r = g.getBoundingClientRect();
            map[label] = { x: r.left - svgRect.left, y: r.top - svgRect.top, w: r.width, h: r.height };
          });
          box.innerHTML = '';
          if (!Object.keys(map).length) console.warn('layoutFlow empty map, id=' + id);
          return map;
        } catch (e) {
          box.innerHTML = '';
          cleanupTempContainer(id);
          if (attempt === 2) { console.warn('layoutFlow failed:', String(e && (e.message || e))); return null; }
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      return null;
    });
  }

  function zoomFit() {
    const svg = diagram.querySelector('svg');
    if (!svg) return;
    const bb = svg.getBBox();
    const ca = document.getElementById('canvas-area');
    const cw = ca ? ca.clientWidth : window.innerWidth;
    const ch = ca ? ca.clientHeight : window.innerHeight;
    const s = Math.min((cw - 40) / Math.max(bb.width, 1), (ch - 40) / Math.max(bb.height, 1), 2);
    setZoom(Math.max(ZOOM_MIN, s));
    if (ca) { ca.scrollTop = 0; ca.scrollLeft = 0; }
  }

  function getSvg() { return diagram.querySelector('svg'); }

  /* ---- 配置 ---- */
  function getCfg() { return cfg; }

  function setCfg(patch) {
    Object.assign(cfg, patch);
  }

  function setDirection(d) {
    const src = ME.Editor.getSource();
    const m = src.match(/^(flowchart|graph)(\s+(TD|TB|BT|LR|RL))?\b/);
    let next;
    if (m) {
      next = src.slice(0, m[1].length) + ' ' + d + src.slice(m[0].length);
    } else {
      next = 'flowchart ' + d + '\n' + src;
    }
    cfg.direction = d;
    ME.Editor.setSource(next);
  }

  function markNodeSelected(name) { selRef = { kind: 'node', name: name }; }
  function markEdgeSelected(idx) { selRef = { kind: 'edge', idx: idx }; }

  /** 内容超出可视区时自动缩放适应窗口（大流程图自动缩小到完整可见） */
  function autoFitIfOversized() {
    const svgEl = diagram.querySelector('svg');
    if (!svgEl) return;
    const ca = document.getElementById('canvas-area');
    if (!ca) return;
    const bb = svgEl.getBBox();
    if (!bb || !bb.width || !bb.height) return;
    // 内容只要比可视区大（不限于 1.5 倍）就自动 fit，保证打开即完整可见且居中
    if (bb.width > ca.clientWidth || bb.height > ca.clientHeight) {
      if (Math.abs(zoom - 1) < 0.01) zoomFit();
    }
  }

  return {
    cfg: cfg,
    detectType: detectType,
    typeName: typeName,
    parseNodes: parseNodes,
    parseEdges: parseEdges,
    parseFlow: parseFlow,
    findNodeAtLine: findNodeAtLine,
    renderNow: renderNow,
    scheduleRender: scheduleRender,
    setZoom: setZoom,
    zoomAt: zoomAt,
    zoomIn: zoomIn,
    zoomOut: zoomOut,
    zoom100: zoom100,
    zoomFit: zoomFit,
    getZoom: getZoom,
    /** 打开文件时调用：下次渲染后强制适应窗口（无论内容大小/之前缩放状态） */
    fitOnRender: () => { fitOnRender = true; },
    layoutFlow: layoutFlow,
    getSvg: getSvg,
    getCfg: getCfg,
    setCfg: setCfg,
    setDirection: setDirection,
    markNodeSelected: markNodeSelected,
    markEdgeSelected: markEdgeSelected,
    clearSel: clearSel,
  };
})();

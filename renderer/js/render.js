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
      // 大流程自适应：内容超出可视区时自动缩放适应窗口，避免画布太小看不到全貌
      autoFitIfOversized();
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
      const g = findNodeElByLabel(node.text || node.name);
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

  function findNodeElByLabel(label) {
    const els = diagram.querySelectorAll('g.node');
    for (const g of els) {
      const el = g.querySelector('.nodeLabel') || g.querySelector('span') || g.querySelector('text');
      if (el && (el.textContent || '').trim() === String(label).trim()) return g;
    }
    return null;
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
        const node = nodes.find((n) => (n.text || n.name) === label) || nodes.find((n) => n.name === label);
        if (node) selectNode(node, g); else clearSel();
      });
      g.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        const node = nodes.find((n) => (n.text || n.name) === label) || nodes.find((n) => n.name === label);
        if (node) {
          selRef = { kind: 'node', name: node.name };
          ME.Props.showNode(node);
          ME.Editor.selectLine(node.line, { focus: true });
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
    });
    diagram.querySelectorAll('.edgeLabel').forEach((g) => {
      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const txt = (g.textContent || '').trim();
        const idx = edges.findIndex((e) => e.label === txt);
        if (idx >= 0) selectEdge(edges[idx], idx, null);
      });
    });
    // 点击画布空白处取消选中
    diagram.addEventListener('click', (e) => {
      if (!e.target.closest('g.node') && !e.target.closest('.edgePath') && !e.target.closest('.edgeLabel')) {
        clearSel();
      }
    });
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
    // 内容显著大于可视区（超出 1.5 倍）且当前未缩放时，自动 fit
    if (bb.width > ca.clientWidth * 1.5 || bb.height > ca.clientHeight * 1.5) {
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
    zoomIn: zoomIn,
    zoomOut: zoomOut,
    zoom100: zoom100,
    zoomFit: zoomFit,
    getZoom: getZoom,
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

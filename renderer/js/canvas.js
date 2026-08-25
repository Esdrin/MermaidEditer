'use strict';
window.ME = window.ME || {};

/* ============================================================
   自由画布（draw.io / Visio 式直接操作）
   - 从形状面板拖入形状自由摆放、拖动端口连线、选中/移动/改样式
   - 画布图形模型 ↔ Mermaid 流程图源码 双向同步
   - 节点位置以 %% pos: 注释保存在源码中（Mermaid 合法注释，不影响渲染）
   ============================================================ */
ME.Canvas = (function () {
  const diagram = document.getElementById('diagram');

  const GRID = 10;          // 对齐网格（像素）
  const MARGIN = 60;        // 画布边距
  const FONT = 14;          // 节点文字大小（svg 单位）
  // 默认配色与界面（Naive UI）一致
  const DEF_FILL = '#ffffff';
  const DEF_STROKE = '#666C75';
  const DEF_COLOR = '#333639';
  const DEF_WIDTH = 1;
  const DEF_ECOLOR = '#666C75';
  const DEF_EWIDTH = 1;

  let active = false;
  let model = { nodes: [], edges: [] };
  let selNodes = new Set();   // 选中的节点 id（支持 Shift 多选）
  let selEdgeId = null;
  let drag = null;            // {type:'move'|'edge'|'reconnect', ...}
  let connectTool = null;     // 连线工具 {conn, from, cur}：点两个节点画箭头
  let svg = null;
  let nodeEls = new Map();
  let edgeEls = new Map();
  let viewBox = { x: 0, y: 0, w: 800, h: 500 };
  let panX = 0, panY = 0;   // 空白拖拽平移产生的视口偏移（render 重绘后保留）
  let zoomFactor = 1;       // 画布缩放倍率（1 = 100%）
  let exportTimer = null;
  let importTimer = null;
  let selfEdit = false;       // 源码写入来自画布自身时跳过重导入
  let editInput = null;

  function num(v) { return Math.round(v * 100) / 100; }
  function escXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /** 标签写入 Mermaid 源码前的转义（mermaid htmlLabels 会把实体渲染回原字符，避免解析报错） */
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
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  function snap(v) { return Math.round(v / GRID) * GRID; }

  /* ---------------- 节点命名 ---------------- */
  function nextName() {
    let max = 0;
    model.nodes.forEach((n) => {
      const m = String(n.name).match(/^N(\d+)$/);
      if (m) max = Math.max(max, +m[1]);
    });
    const re = /\bN(\d+)\b/g;
    let m;
    while ((m = re.exec(ME.Editor.getSource()))) max = Math.max(max, +m[1]);
    return 'N' + (max + 1);
  }

  /* ---------------- 形状几何（w,h 为节点尺寸） ---------------- */
  function shapeGeom(id, w, h) {
    const cx = w / 2, cy = h / 2;
    switch (id) {
      case 'rect':
        return '<rect x="0" y="0" width="' + num(w) + '" height="' + num(h) + '"/>';
      case 'rounded': {
        const r = Math.min(10, h * 0.22);
        return '<rect x="0" y="0" width="' + num(w) + '" height="' + num(h) + '" rx="' + num(r) + '"/>';
      }
      case 'stadium':
        return '<rect x="0" y="0" width="' + num(w) + '" height="' + num(h) + '" rx="' + num(h / 2) + '"/>';
      case 'diamond':
        return '<path d="M ' + num(cx) + ' 0 L ' + num(w) + ' ' + num(cy) + ' L ' + num(cx) + ' ' + num(h) + ' L 0 ' + num(cy) + ' Z"/>';
      case 'parallelogram':
        return '<path d="M ' + num(w * 0.24) + ' 0 L ' + num(w) + ' 0 L ' + num(w * 0.76) + ' ' + num(h) + ' L 0 ' + num(h) + ' Z"/>';
      case 'parallelogram-alt':
        return '<path d="M 0 0 L ' + num(w * 0.76) + ' 0 L ' + num(w) + ' ' + num(h) + ' L ' + num(w * 0.24) + ' ' + num(h) + ' Z"/>';
      case 'trapezoid':
        return '<path d="M ' + num(w * 0.18) + ' 0 L ' + num(w * 0.82) + ' 0 L ' + num(w) + ' ' + num(h) + ' L 0 ' + num(h) + ' Z"/>';
      case 'trapezoid-alt':
        return '<path d="M 0 0 L ' + num(w) + ' 0 L ' + num(w * 0.82) + ' ' + num(h) + ' L ' + num(w * 0.18) + ' ' + num(h) + ' Z"/>';
      case 'hexagon':
        return '<path d="M ' + num(w * 0.2) + ' 0 L ' + num(w * 0.8) + ' 0 L ' + num(w) + ' ' + num(cy) + ' L ' + num(w * 0.8) + ' ' + num(h) + ' L ' + num(w * 0.2) + ' ' + num(h) + ' L 0 ' + num(cy) + ' Z"/>';
      case 'circle':
        return '<ellipse cx="' + num(cx) + '" cy="' + num(cy) + '" rx="' + num(w / 2) + '" ry="' + num(h / 2) + '"/>';
      case 'doublecircle':
        return '<ellipse cx="' + num(cx) + '" cy="' + num(cy) + '" rx="' + num(w / 2) + '" ry="' + num(h / 2) + '"/>' +
          '<ellipse cx="' + num(cx) + '" cy="' + num(cy) + '" rx="' + num(Math.max(6, w / 2 - 6)) + '" ry="' + num(Math.max(6, h / 2 - 6)) + '"/>';
      case 'subroutine':
        return '<rect x="0" y="0" width="' + num(w) + '" height="' + num(h) + '"/>' +
          '<path d="M 12 0 L 12 ' + num(h) + ' M ' + num(w - 12) + ' 0 L ' + num(w - 12) + ' ' + num(h) + '"/>';
      case 'database': {
        const r = Math.min(8, h * 0.16);
        return '<path d="M 0 ' + num(r) + ' a ' + num(w / 2) + ' ' + num(r) + ' 0 0 1 ' + num(w) + ' 0 v ' + num(Math.max(0, h - 2 * r)) +
          ' a ' + num(w / 2) + ' ' + num(r) + ' 0 0 1 ' + num(-w) + ' 0 Z"/>';
      }
      case 'asymmetric':
        return '<path d="M 0 0 L ' + num(w * 0.72) + ' 0 L ' + num(w) + ' ' + num(cy) + ' L ' + num(w * 0.72) + ' ' + num(h) + ' L 0 ' + num(h) + ' Z"/>';
      default:
        return '<rect x="0" y="0" width="' + num(w) + '" height="' + num(h) + '"/>';
    }
  }

  /* ---------------- 文本测量 / 节点尺寸 ---------------- */
  function isCJK(ch) { return /[\u2E80-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/.test(ch); }
  function measureWidth(label) {
    let w = 0;
    String(label || '').split('').forEach((ch) => { w += isCJK(ch) ? FONT : FONT * 0.62; });
    return w;
  }
  function nodeSize(label, shapeId) {
    const tw = measureWidth(label);
    let w = Math.max(84, tw + 28);
    let h = Math.max(44, FONT * 2 + 16);
    if (shapeId === 'circle' || shapeId === 'doublecircle') { const s = Math.max(w, h); w = s; h = s; }
    if (shapeId === 'diamond' || shapeId === 'hexagon') { w += 24; h += 18; }
    return { w: Math.round(w), h: Math.round(h) };
  }

  /* ---------------- 默认样式 ---------------- */
  function defaultNodeStyle() { return { fill: DEF_FILL, stroke: DEF_STROKE, color: DEF_COLOR, width: DEF_WIDTH }; }
  function defaultEdgeStyle() { return { color: DEF_ECOLOR, width: DEF_EWIDTH }; }
  function nodeStyleStr(n) {
    const parts = [];
    if (n.fill !== DEF_FILL) parts.push('fill:' + n.fill);
    if (n.stroke !== DEF_STROKE) parts.push('stroke:' + n.stroke);
    if (n.color !== DEF_COLOR) parts.push('color:' + n.color);
    if (n.width !== DEF_WIDTH) parts.push('stroke-width:' + n.width + 'px');
    return parts.join(',');
  }
  function edgeStyleStr(e) {
    const parts = [];
    if (e.color !== DEF_ECOLOR) parts.push('stroke:' + e.color);
    if (e.width !== DEF_EWIDTH) parts.push('stroke-width:' + e.width + 'px');
    return parts.join(',');
  }

  /* ---------------- 模型操作 ---------------- */
  function addNode(shapeId, x, y) {
    const shape = ME.SHAPES.find((s) => s.id === shapeId);
    if (!shape) return null;
    const name = nextName();
    const label = '新节点';
    const size = nodeSize(label, shapeId);
    const node = Object.assign({
      id: name, name: name, label: label, shape: shapeId,
      x: Math.round(x - size.w / 2), y: Math.round(y - size.h / 2),
      w: size.w, h: size.h,
    }, defaultNodeStyle());
    model.nodes.push(node);
    render();
    scheduleExport(true);
    return node;
  }

  function addEdge(fromId, toId, connector) {
    if (fromId === toId) return null;
    const edge = Object.assign({
      id: 'e' + Date.now(),
      from: fromId, to: toId, label: '', connector: connector || '-->',
    }, defaultEdgeStyle());
    model.edges.push(edge);
    render();
    scheduleExport(true);
    return edge;
  }

  function removeNodes(ids) {
    const set = new Set(ids);
    model.nodes = model.nodes.filter((n) => !set.has(n.id));
    model.edges = model.edges.filter((e) => !(set.has(e.from) || set.has(e.to)));
    set.forEach((id) => selNodes.delete(id));
    selEdgeId = null;
    render();
    scheduleExport(true);
    ME.Props.showCanvasDiagram();
  }

  function removeEdge(id) {
    model.edges = model.edges.filter((e) => e.id !== id);
    if (selEdgeId === id) selEdgeId = null;
    render();
    scheduleExport(true);
    ME.Props.showCanvasDiagram();
  }

  function duplicateNodes() {
    const ids = [...selNodes];
    if (!ids.length) return;
    const offset = 30;
    ids.forEach((id) => {
      const src = model.nodes.find((n) => n.id === id);
      if (!src) return;
      const name = nextName();
      const copy = Object.assign({}, src, { id: name, name: name, x: src.x + offset, y: src.y + offset });
      model.nodes.push(copy);
    });
    selNodes.clear();
    render();
    scheduleExport(true);
    ME.Props.showCanvasDiagram();
    ME.app.toast('已复制 ' + ids.length + ' 个节点（连线不随复制）');
  }

  function updateNode(id, patch) {
    const n = model.nodes.find((x) => x.id === id);
    if (!n) return;
    if (patch.label !== undefined) n.label = patch.label;
    if (patch.shape !== undefined) n.shape = patch.shape;
    Object.assign(n, patch);
    const size = nodeSize(n.label, n.shape);
    n.w = size.w; n.h = size.h;
    render();
    scheduleExport(true);
  }

  function updateEdge(id, patch) {
    const e = model.edges.find((x) => x.id === id);
    if (!e) return;
    Object.assign(e, patch);
    render();
    scheduleExport(true);
  }

  /* ---------------- 端口 ---------------- */
  function portPos(n, side) {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    if (side === 'n') return { x: cx, y: n.y };
    if (side === 's') return { x: cx, y: n.y + n.h };
    if (side === 'e') return { x: n.x + n.w, y: cy };
    return { x: n.x, y: cy };
  }

  /* ---------------- 连线几何 ---------------- */
  function borderPoint(n, dx, dy) {
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    let t = Infinity;
    if (Math.abs(ux) > 1e-6) t = Math.min(t, (n.w / 2) / Math.abs(ux));
    if (Math.abs(uy) > 1e-6) t = Math.min(t, (n.h / 2) / Math.abs(uy));
    t = t === Infinity ? 1 : t;
    return { x: n.x + n.w / 2 + ux * t, y: n.y + n.h / 2 + uy * t };
  }

  function edgeGeometry(e) {
    const a = model.nodes.find((n) => n.id === e.from);
    const b = model.nodes.find((n) => n.id === e.to);
    if (!a || !b) return null;
    const dx = (b.x + b.w / 2) - (a.x + a.w / 2);
    const dy = (b.y + b.h / 2) - (a.y + a.h / 2);
    const p1 = borderPoint(a, dx, dy);
    const p2 = borderPoint(b, -dx, -dy);
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2 };
  }

  function arrowMarkup(e, g) {
    const ang = Math.atan2(g.y2 - g.y1, g.x2 - g.x1);
    const a = Math.cos(ang), b = Math.sin(ang);
    const s = 11, wdt = 6;
    const tip = g.x2, tipy = g.y2;
    const baseX = tip - a * s, baseY = tipy - b * s;
    const px = -b, py = a;
    const cx1 = baseX + px * wdt, cy1 = baseY + py * wdt;
    const cx2 = baseX - px * wdt, cy2 = baseY - py * wdt;
    if (e.connector === '-->' || e.connector === '-.->' || e.connector === '==>') {
      return '<polygon points="' + num(tip) + ',' + num(tipy) + ' ' + num(cx1) + ',' + num(cy1) + ' ' + num(cx2) + ',' + num(cy2) + '" fill="' + e.color + '"/>';
    }
    if (e.connector === '--o') {
      return '<circle cx="' + num(tip) + '" cy="' + num(tipy) + '" r="5.2" fill="#fff" stroke="' + e.color + '" stroke-width="2"/>';
    }
    if (e.connector === '--x') {
      const k = 5.2;
      return '<path d="M ' + num(tip - a * k) + ' ' + num(tipy - b * k) + ' L ' + num(tip + a * k) + ' ' + num(tipy + b * k) +
        ' M ' + num(tip + b * k) + ' ' + num(tipy - a * k) + ' L ' + num(tip - b * k) + ' ' + num(tipy + a * k) +
        '" stroke="' + e.color + '" stroke-width="2"/>';
    }
    return '';
  }

  function edgeInner(e) {
    const g = edgeGeometry(e);
    if (!g) return '';
    const dash = (e.connector === '-.->' || e.connector === '-.-') ? ' stroke-dasharray="6 4"' : '';
    const w = e.connector === '==>' ? e.width + 1 : e.width;
    // 透明加宽命中路径：扩大点击/双击热区（视觉上仍是细线）
    return '<path class="fc-edge-hit" d="M ' + num(g.x1) + ' ' + num(g.y1) + ' L ' + num(g.x2) + ' ' + num(g.y2) +
      '" fill="none" stroke="transparent" stroke-width="16" stroke-linecap="round"' + dash + '/>' +
      '<path class="fc-edge-path" d="M ' + num(g.x1) + ' ' + num(g.y1) + ' L ' + num(g.x2) + ' ' + num(g.y2) +
      '" fill="none" stroke="' + e.color + '" stroke-width="' + w + '"' + dash + '/>' +
      arrowMarkup(e, g) +
      (e.label ? '<text class="fc-edge-label" x="' + num(g.mx) + '" y="' + num(g.my) +
        '" text-anchor="middle" dominant-baseline="central" font-size="12" stroke="#ffffff" stroke-width="4" paint-order="stroke" fill="' + e.color + '">' +
        escXml(e.label) + '</text>' : '');
  }

  /* ---------------- 渲染 ---------------- */
  /** 画布基础尺寸：内容 bounds + 边距，且至少铺满 canvas-area 可视区（窗口 100%） */
  function baseSize(bb) {
    let vx = Math.floor((bb.x - MARGIN) / GRID) * GRID;
    let vy = Math.floor((bb.y - MARGIN) / GRID) * GRID;
    let vw = Math.max(300, Math.ceil(bb.w + MARGIN * 2));
    let vh = Math.max(200, Math.ceil(bb.h + MARGIN * 2));
    // 画布至少与 canvas-area 可视区一样大（内容少时也铺满窗口）
    const ca = document.getElementById('canvas-area');
    if (ca) {
      const cw = ca.clientWidth, ch = ca.clientHeight;
      if (cw > 0 && cw > vw) { vw = cw; if (vx > 0) vx = 0; }
      if (ch > 0 && ch > vh) { vh = ch; if (vy > 0) vy = 0; }
    }
    return { vx: vx, vy: vy, vw: vw, vh: vh };
  }

  function contentBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    model.nodes.forEach((n) => {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h);
    });
    if (!model.nodes.length) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function portsMarkup() {
    if (connectTool) {
      // 连线模式下所有节点都显示端口，方便从任意节点起线
      let html = '<g class="fc-ports">';
      model.nodes.forEach((n) => {
        ['n', 's', 'e', 'w'].forEach((side) => {
          const p = portPos(n, side);
          html += '<circle class="fc-port" data-node="' + n.id + '" data-side="' + side + '" cx="' + num(p.x) + '" cy="' + num(p.y) + '" r="4.5"/>';
        });
      });
      html += '</g>';
      return html;
    }
    if (!(selNodes.size || selEdgeId)) return '';
    let html = '<g class="fc-ports">';
    selNodes.forEach((id) => {
      const n = model.nodes.find((x) => x.id === id);
      if (!n) return;
      ['n', 's', 'e', 'w'].forEach((side) => {
        const p = portPos(n, side);
        html += '<circle class="fc-port" data-node="' + id + '" data-side="' + side + '" cx="' + num(p.x) + '" cy="' + num(p.y) + '" r="5"/>';
      });
    });
    html += '</g>';
    return html;
  }

  /** 选中连线时在其两端显示改接手柄（拖到其他节点可重连） */
  function edgeHandlesMarkup() {
    if (!selEdgeId) return '';
    const e = model.edges.find((x) => x.id === selEdgeId);
    if (!e) return '';
    const g = edgeGeometry(e);
    if (!g) return '';
    return '<g class="fc-ehandles">' +
      '<circle class="fc-ehandle" data-edge="' + e.id + '" data-end="from" cx="' + num(g.x1) + '" cy="' + num(g.y1) + '" r="5.5"/>' +
      '<circle class="fc-ehandle" data-edge="' + e.id + '" data-end="to" cx="' + num(g.x2) + '" cy="' + num(g.y2) + '" r="5.5"/>' +
      '</g>';
  }

  function render() {
    if (!active) return;
    if (!model.nodes.length && !model.edges.length) {
      diagram.innerHTML = '<div id="empty-hint">自由画布模式：\n从左侧形状面板把形状拖到此处\n拖动选中节点边缘的 ● 端口到另一节点可连线\n双击节点编辑文字 · Delete 删除 · Shift 多选</div>';
      svg = null; nodeEls.clear(); edgeEls.clear();
      return;
    }
    const bb = contentBounds();
    // 允许负坐标：节点可放置在原点左上（窗口放大后画布左侧/上方空白区），viewBox 必须覆盖全部内容
    const base = baseSize(bb);
    const vx = base.vx, vy = base.vy, vw = base.vw, vh = base.vh;
    // 缩放：viewBox 越小内容越大；pan 偏移叠加在基础起点上
    viewBox = {
      x: vx + panX,
      y: vy + panY,
      w: vw / zoomFactor,
      h: vh / zoomFactor,
    };

    let html = '<svg class="fc-svg" viewBox="' + viewBox.x + ' ' + viewBox.y + ' ' + viewBox.w + ' ' + viewBox.h + '" width="' + vw + '" height="' + vh + '">';
    html += '<g class="fc-edges">';
    model.edges.forEach((e) => {
      const cls = 'fc-edge' + (selEdgeId === e.id ? ' sel' : '');
      html += '<g class="' + cls + '" data-id="' + e.id + '">' + edgeInner(e) + '</g>';
    });
    html += '</g><g class="fc-nodes">';
    model.nodes.forEach((n) => {
      const sel = selNodes.has(n.id) || (connectTool && connectTool.from === n.id);
      const cls = 'fc-node' + (sel ? ' sel' : '');
      const style = 'fill:' + n.fill + ';stroke:' + n.stroke + ';stroke-width:' + n.width;
      html += '<g class="' + cls + '" data-id="' + n.id + '" transform="translate(' + n.x + ' ' + n.y + ')">' +
        (sel ? '<rect class="fc-sel-rect" x="-6" y="-6" width="' + num(n.w + 12) + '" height="' + num(n.h + 12) + '"/>' : '') +
        '<g class="fc-shape" style="' + style + '">' + shapeGeom(n.shape, n.w, n.h) + '</g>' +
        '<text class="fc-label" x="' + num(n.w / 2) + '" y="' + num(n.h / 2) + '" text-anchor="middle" dominant-baseline="central" font-size="' + FONT + '" fill="' + n.color + '">' + escXml(n.label) + '</text>' +
        '</g>';
    });
    html += '</g>' + portsMarkup() + edgeHandlesMarkup();
    if (drag && (drag.type === 'edge' || drag.type === 'reconnect' || drag.type === 'connect')) {
      html += '<path class="fc-temp-edge" d="M ' + num(drag.x1) + ' ' + num(drag.y1) + ' L ' + num(drag.x2) + ' ' + num(drag.y2) +
        '" fill="none" stroke="#18a058" stroke-width="2" stroke-dasharray="6 4"/>';
    } else if (connectTool && connectTool.from && connectTool.cur) {
      const src = model.nodes.find((n) => n.id === connectTool.from);
      if (src) {
        const sx2 = src.x + src.w / 2, sy2 = src.y + src.h / 2;
        html += '<path class="fc-temp-edge" d="M ' + num(sx2) + ' ' + num(sy2) + ' L ' + num(connectTool.cur.x) + ' ' + num(connectTool.cur.y) +
          '" fill="none" stroke="#18a058" stroke-width="2" stroke-dasharray="6 4"/>';
      }
    }
    html += '</svg>';

    diagram.innerHTML = html;
    svg = diagram.querySelector('svg.fc-svg');
    nodeEls.clear(); edgeEls.clear();
    svg.querySelectorAll('.fc-node').forEach((g) => nodeEls.set(g.getAttribute('data-id'), g));
    svg.querySelectorAll('.fc-edge').forEach((g) => edgeEls.set(g.getAttribute('data-id'), g));
    svg.addEventListener('mousedown', onMouseDown);
    svg.addEventListener('dblclick', onDblClick);
    svg.addEventListener('mousemove', onSvgMove);
    svg.addEventListener('wheel', onWheel, { passive: false });
  }

  /** 滚轮缩放画布：以鼠标位置为锚点缩放 viewBox（Ctrl+滚轮同样缩放） */
  function onWheel(ev) {
    if (!active || !svg || editInput) return;
    ev.preventDefault();
    const p = svgPoint(ev);
    if (!p) return;
    const k = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    const nf = Math.min(8, Math.max(0.2, zoomFactor * k));
    if (nf === zoomFactor) return;
    // 鼠标在视口中的相对位置（缩放锚点）
    const ratioX = (p.x - viewBox.x) / viewBox.w;
    const ratioY = (p.y - viewBox.y) / viewBox.h;
    zoomFactor = nf;
    rebuildViewport(ratioX, ratioY, p, true);
  }

  /** 滑块/按钮联动：以视口中心为锚设置画布缩放 */
  function setZoomFactor(z) {
    const nf = Math.min(8, Math.max(0.2, z));
    if (nf === zoomFactor) return;
    zoomFactor = nf;
    rebuildViewport(0.5, 0.5, null, true);
  }

  function getZoomFactor() { return zoomFactor; }

  /** 适应窗口：调整缩放使内容完整可见（不改变 pan 偏移） */
  function fitView() {
    if (!svg) return;
    const bb = contentBounds();
    if (!bb) return;
    const rect = svg.parentElement ? svg.parentElement.getBoundingClientRect() : null;
    const base = baseSize(bb);
    const vw = base.vw, vh = base.vh;
    let f = 1;
    if (rect && rect.width > 0 && rect.height > 0) {
      // svg 显示尺寸 = viewBox.w/h（width/height 属性），容器为 #page（canvas 模式 padding 10px）
      f = Math.min((rect.width - 20) / vw, (rect.height - 20) / vh, 3);
      f = Math.max(0.2, f);
    }
    zoomFactor = f;
    rebuildViewport(0.5, 0.5, null, true);
  }

  /** 按当前 zoomFactor 重算 viewBox：锚点（ratioX,ratioY 相对旧视口）处的内容坐标保持不动 */
  function rebuildViewport(ratioX, ratioY, anchor, updateUI) {
    const bb = contentBounds();
    if (!bb) return;
    const base = baseSize(bb);
    const vx = base.vx, vy = base.vy, vw = base.vw, vh = base.vh;
    const nw = vw / zoomFactor, nh = vh / zoomFactor;
    // 锚点处的内容坐标（缩放前后不变）
    const ax = anchor ? anchor.x : (viewBox.x + viewBox.w * ratioX);
    const ay = anchor ? anchor.y : (viewBox.y + viewBox.h * ratioY);
    const nx = ax - ratioX * nw;
    const ny = ay - ratioY * nh;
    viewBox = { x: nx, y: ny, w: nw, h: nh };
    panX = viewBox.x - vx;
    panY = viewBox.y - vy;
    if (svg) svg.setAttribute('viewBox', viewBox.x + ' ' + viewBox.y + ' ' + viewBox.w + ' ' + viewBox.h);
    if (updateUI && ME.app && ME.app.updateZoomUI) ME.app.updateZoomUI(zoomFactor);
  }

  /** 连线工具模式下跟踪鼠标位置，实时画预览线 */
  function onSvgMove(ev) {
    if (!connectTool || !connectTool.from) return;
    const cur = svgPoint(ev);
    if (!cur) return;
    connectTool.cur = cur;
    render();
  }

  /* ---------------- 交互 ---------------- */
  function svgPoint(ev) {
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const sx = viewBox.w / rect.width, sy = viewBox.h / rect.height;
    return { x: viewBox.x + (ev.clientX - rect.left) * sx, y: viewBox.y + (ev.clientY - rect.top) * sy };
  }

  function nodeAt(p) {
    for (const n of model.nodes) {
      if (p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h) return n.id;
    }
    return null;
  }

  function onMouseDown(ev) {
    if (editInput) return;
    if (ev.button !== 0) return;
    const t = ev.target;
    // 连线工具模式：按住节点拖到另一节点直接画线；不拖动则是点击-点击
    if (connectTool) {
      const port = t.closest('.fc-port');
      const nodeG = port ? null : t.closest('.fc-node');
      const fromId = port ? port.getAttribute('data-node') : (nodeG ? nodeG.getAttribute('data-id') : null);
      if (fromId) startConnectDrag(ev, fromId);
      else cancelConnectTool();
      return;
    }
    const ehandle = t.closest('.fc-ehandle');
    if (ehandle) { startEdgeReconnectDrag(ev, ehandle); return; }
    const port = t.closest('.fc-port');
    if (port) { startEdgeDrag(ev, port); return; }
    const nodeG = t.closest('.fc-node');
    if (nodeG) { startMoveDrag(ev, nodeG); return; }
    const edgeG = t.closest('.fc-edge');
    if (edgeG) { selectEdge(edgeG.getAttribute('data-id')); return; }
    if (!ev.shiftKey) clearSelection();
    // 空白处：拖动画布平移（单击仍取消选中）
    startPanDrag(ev);
  }

  /** 空白处按住拖动 → 平移画布视口（不改变节点坐标，仅移动 viewBox） */
  function startPanDrag(ev) {
    if (!svg) return;
    drag = {
      type: 'pan',
      sx: ev.clientX, sy: ev.clientY,
      baseX: viewBox.x - panX, baseY: viewBox.y - panY,
      vx: viewBox.x, vy: viewBox.y,
      moved: 0,
    };
    svg.classList.add('panning');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    ev.preventDefault();
  }

  /** 连线工具：从节点（或端口）按住拖出箭头；不动则为点击选择起点/终点 */
  function startConnectDrag(ev, fromId) {
    const n = model.nodes.find((x) => x.id === fromId);
    if (!n) return;
    const cur = svgPoint(ev);
    if (!cur) return;
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    const bp = borderPoint(n, cur.x - cx, cur.y - cy);
    drag = { type: 'connect', conn: connectTool.conn, fromId: fromId, x1: bp.x, y1: bp.y, x2: cur.x, y2: cur.y, moved: 0 };
    svg.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    ev.preventDefault();
  }

  function cancelConnectTool() {
    connectTool = null;
    document.body.classList.remove('connect-mode');
    ME.app.setStatus('自由画布：拖入形状 · 拖动端口连线 · 双击编辑 · Delete 删除');
    render();
  }

  /** 拖动连线端点手柄 → 改接到其他节点 */
  function startEdgeReconnectDrag(ev, handle) {
    const edgeId = handle.getAttribute('data-edge');
    const end = handle.getAttribute('data-end'); // 'from' | 'to'
    const edge = model.edges.find((x) => x.id === edgeId);
    if (!edge) return;
    const g = edgeGeometry(edge);
    if (!g) return;
    const cur = svgPoint(ev);
    if (!cur) return;
    const fixed = end === 'from' ? { x: g.x2, y: g.y2 } : { x: g.x1, y: g.y1 };
    drag = { type: 'reconnect', edgeId: edgeId, end: end, x1: fixed.x, y1: fixed.y, x2: cur.x, y2: cur.y };
    svg.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    ev.preventDefault();
  }

  function startMoveDrag(ev, nodeG) {
    const id = nodeG.getAttribute('data-id');
    if (!selNodes.has(id)) {
      if (!ev.shiftKey) selNodes.clear();
      selNodes.add(id);
      selEdgeId = null;
      refreshPropsForSelection();
    }
    render();
    const start = svgPoint(ev);
    if (!start) return;
    const origins = model.nodes.filter((n) => selNodes.has(n.id)).map((n) => ({ id: n.id, x: n.x, y: n.y }));
    drag = { type: 'move', start: start, origins: origins };
    svg.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    ev.preventDefault();
  }

  function startEdgeDrag(ev, port) {
    const fromId = port.getAttribute('data-node');
    const side = port.getAttribute('data-side');
    const n = model.nodes.find((x) => x.id === fromId);
    if (!n) return;
    const p = portPos(n, side);
    const cur = svgPoint(ev);
    if (!cur) return;
    drag = { type: 'edge', fromId: fromId, x1: p.x, y1: p.y, x2: cur.x, y2: cur.y };
    svg.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    ev.preventDefault();
  }

  function onMove(ev) {
    if (!drag) return;
    if (drag.type === 'pan') {
      drag.moved += Math.abs(ev.clientX - drag.sx) + Math.abs(ev.clientY - drag.sy);
      // 画布坐标 → 屏幕像素换算（viewBox 与 svg 实际尺寸比例）
      if (svg) {
        const rect = svg.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const kx = viewBox.w / rect.width, ky = viewBox.h / rect.height;
          panX = Math.round((drag.vx - (ev.clientX - drag.sx) * kx - drag.baseX) * 100) / 100;
          panY = Math.round((drag.vy - (ev.clientY - drag.sy) * ky - drag.baseY) * 100) / 100;
          viewBox.x = drag.baseX + panX;
          viewBox.y = drag.baseY + panY;
          svg.setAttribute('viewBox', viewBox.x + ' ' + viewBox.y + ' ' + viewBox.w + ' ' + viewBox.h);
        }
      }
      return;
    }
    const cur = svgPoint(ev);
    if (!cur) return;
    if (drag.type === 'move') {
      const dx = cur.x - drag.start.x, dy = cur.y - drag.start.y;
      drag.origins.forEach((o) => {
        const n = model.nodes.find((x) => x.id === o.id);
        if (n) { n.x = snap(o.x + dx); n.y = snap(o.y + dy); }
      });
      render();
    } else if (drag.type === 'edge' || drag.type === 'reconnect' || drag.type === 'connect') {
      drag.moved = (drag.moved || 0) + Math.hypot(cur.x - drag.x2, cur.y - drag.y2);
      drag.x2 = cur.x; drag.y2 = cur.y;
      render();
    }
  }

  function onUp(ev) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (!drag) return;
    if (drag.type === 'pan') {
      const moved = drag.moved;
      drag = null;
      if (svg) svg.classList.remove('panning');
      if (moved < 5) {
        // 单击空白：取消选中（onMouseDown 已清空，仅恢复状态提示）
        ME.Props.showCanvasDiagram();
      }
      return;
    }
    if (drag.type === 'move') {
      drag = null;
      svg.classList.remove('dragging');
      scheduleExport(true);
    } else if (drag.type === 'edge') {
      const cur = svgPoint(ev);
      const target = cur ? nodeAt(cur) : null;
      const fromId = drag.fromId;
      drag = null;
      svg.classList.remove('dragging');
      render();
      if (target && target !== fromId) {
        const edge = addEdge(fromId, target);
        if (edge) { selNodes.clear(); selEdgeId = edge.id; ME.Props.showCanvasEdge(edge); }
      }
    } else if (drag.type === 'connect') {
      // 连线工具：拖到另一节点 → 直接连线；未拖动（单击）→ 点击-点击模式
      const cur = svgPoint(ev);
      const target = cur ? nodeAt(cur) : null;
      const fromId = drag.fromId;
      const conn = drag.conn;
      const wasClick = (drag.moved || 0) < 6;
      drag = null;
      svg.classList.remove('dragging');
      if (target && target !== fromId) {
        const edge = addEdge(fromId, target, conn);
        connectTool.cur = null;
        render();
        if (edge) { selNodes.clear(); selEdgeId = edge.id; ME.Props.showCanvasEdge(edge); }
        ME.app.setStatus('连线模式：已画箭头，可继续（Esc 取消）');
      } else if (wasClick && target === fromId) {
        // 单击节点：记录/配对起点终点
        if (connectTool.from === null) {
          connectTool.from = fromId;
          ME.app.setStatus('连线模式：已选起点「' + fromId + '」，请点击终点节点（Esc 取消）');
          render();
        } else if (connectTool.from !== fromId) {
          const edge = addEdge(connectTool.from, fromId, conn);
          connectTool.from = null;
          connectTool.cur = null;
          render();
          if (edge) { selNodes.clear(); selEdgeId = edge.id; ME.Props.showCanvasEdge(edge); }
          ME.app.setStatus('连线模式：已画箭头，可继续（Esc 取消）');
        } else {
          connectTool.from = null;
          ME.app.setStatus('连线模式：请点击「起点节点」（Esc 取消）');
          render();
        }
      } else {
        render(); // 拖到空白处 → 取消预览，保持连线模式
      }
    } else if (drag.type === 'reconnect') {
      const cur = svgPoint(ev);
      const target = cur ? nodeAt(cur) : null;
      const edgeId = drag.edgeId;
      const end = drag.end;
      drag = null;
      svg.classList.remove('dragging');
      render();
      const edge = model.edges.find((x) => x.id === edgeId);
      if (!edge || !target) return;
      const other = end === 'from' ? edge.to : edge.from;
      if (target === other || target === (end === 'from' ? edge.from : edge.to)) return; // 自环或未变化
      if (end === 'from') edge.from = target; else edge.to = target;
      render();
      scheduleExport(true);
      ME.Props.showCanvasEdge(edge);
    }
  }

  function onDblClick(ev) {
    const g = ev.target.closest('.fc-node');
    if (g) { startLabelEdit(g.getAttribute('data-id')); return; }
    const eg = ev.target.closest('.fc-edge');
    if (eg) { startEdgeLabelEdit(eg.getAttribute('data-id')); }
  }

  /** 双击连线 → 在连线中点就地编辑标签（Enter 确认 / Esc 取消 / 失焦确认；留空则删除标签） */
  function startEdgeLabelEdit(id) {
    const e = model.edges.find((x) => x.id === id);
    if (!e) return;
    const g = edgeGeometry(e);
    if (!g || !svg) return;
    selNodes.clear(); selEdgeId = id;
    render();
    const NS = 'http://www.w3.org/2000/svg';
    const fo = document.createElementNS(NS, 'foreignObject');
    const w = Math.max(120, measureWidth(e.label || '') + 40);
    fo.setAttribute('x', g.mx - w / 2);
    fo.setAttribute('y', g.my - 12);
    fo.setAttribute('width', w);
    fo.setAttribute('height', 24);
    const div = document.createElement('div');
    div.style.cssText = 'text-align:center;';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = e.label || '';
    input.placeholder = '连线标签';
    input.style.cssText = 'width:100%;height:22px;font-size:13px;border:1px solid #18a058;border-radius:3px;padding:0 4px;outline:none;box-sizing:border-box;font-family:inherit;';
    div.appendChild(input);
    fo.appendChild(div);
    svg.appendChild(fo);
    editInput = input;
    input.focus();
    input.select();
    const commit = () => {
      if (editInput !== input) return;
      editInput = null;
      svg.removeChild(fo);
      const v = input.value.trim();
      if (v !== (e.label || '')) {
        updateEdge(id, { label: v });
        ME.Props.showCanvasEdge(model.edges.find((x) => x.id === id));
      } else {
        render();
        refreshPropsForSelection();
      }
    };
    input.addEventListener('keydown', (evt) => {
      evt.stopPropagation();
      if (evt.key === 'Enter') { evt.preventDefault(); commit(); }
      else if (evt.key === 'Escape') { editInput = null; svg.removeChild(fo); render(); }
    });
    input.addEventListener('blur', commit);
  }

  function startLabelEdit(id) {
    const n = model.nodes.find((x) => x.id === id);
    if (!n) return;
    selNodes.clear(); selNodes.add(id); selEdgeId = null;
    render();
    const g = nodeEls.get(id);
    if (!g || !svg) return;
    const NS = 'http://www.w3.org/2000/svg';
    const fo = document.createElementNS(NS, 'foreignObject');
    const w = Math.max(n.w + 40, 160);
    fo.setAttribute('x', n.x + n.w / 2 - w / 2);
    fo.setAttribute('y', n.y + n.h / 2 - 12);
    fo.setAttribute('width', w);
    fo.setAttribute('height', 24);
    const div = document.createElement('div');
    div.style.cssText = 'text-align:center;';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = n.label;
    input.style.cssText = 'width:100%;height:22px;font-size:13px;border:1px solid #18a058;border-radius:3px;padding:0 4px;outline:none;box-sizing:border-box;font-family:inherit;';
    div.appendChild(input);
    fo.appendChild(div);
    svg.appendChild(fo);
    editInput = input;
    input.focus();
    input.select();
    const commit = () => {
      if (editInput !== input) return;
      editInput = null;
      svg.removeChild(fo);
      const v = input.value.trim();
      if (v && v !== n.label) { updateNode(id, { label: v }); }
      else render();
      refreshPropsForSelection();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { editInput = null; svg.removeChild(fo); render(); }
    });
    input.addEventListener('blur', commit);
  }

  function selectEdge(id) {
    selNodes.clear();
    selEdgeId = id;
    render();
    const e = model.edges.find((x) => x.id === id);
    if (e) ME.Props.showCanvasEdge(e);
  }

  function clearSelection() {
    selNodes.clear();
    selEdgeId = null;
    render();
    ME.Props.showCanvasDiagram();
  }

  function refreshPropsForSelection() {
    if (selNodes.size > 1) ME.Props.showCanvasMulti(selNodes.size);
    else if (selNodes.size === 1) {
      const n = model.nodes.find((x) => x.id === [...selNodes][0]);
      if (n) ME.Props.showCanvasNode(n);
    }
  }

  function deleteSelection() {
    if (selNodes.size) { removeNodes([...selNodes]); return; }
    if (selEdgeId) removeEdge(selEdgeId);
  }

  function onKeyDown(e) {
    if (!active || editInput) return;
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || (t.closest && t.closest('input,textarea,select')))) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = (e.key || '').toLowerCase();
    if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? ME.Editor.redo() : ME.Editor.undo(); return; }
    if (ctrl && k === 'y') { e.preventDefault(); ME.Editor.redo(); return; }
    if (ctrl && k === 'd') { e.preventDefault(); duplicateNodes(); return; }
    if (ctrl) return;
    if (k === 'delete' || k === 'backspace') {
      if (selNodes.size || selEdgeId) { e.preventDefault(); deleteSelection(); }
      return;
    }
    if (k === 'escape') {
      if (connectTool) { cancelConnectTool(); return; }
      if (drag) {
        if (drag.type === 'pan') {
          // 取消平移：回滚视口偏移
          panX = 0; panY = 0;
          if (svg) {
            const base = contentBounds();
            const bs = baseSize(base);
            viewBox = { x: bs.vx, y: bs.vy, w: viewBox.w, h: viewBox.h };
            svg.setAttribute('viewBox', viewBox.x + ' ' + viewBox.y + ' ' + viewBox.w + ' ' + viewBox.h);
          }
          drag = null;
          if (svg) svg.classList.remove('panning');
          return;
        }
        drag = null; render();
      }
      else clearSelection();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!selNodes.size) return;
      e.preventDefault();
      const dx = e.key === 'ArrowLeft' ? -GRID : e.key === 'ArrowRight' ? GRID : 0;
      const dy = e.key === 'ArrowUp' ? -GRID : e.key === 'ArrowDown' ? GRID : 0;
      model.nodes.forEach((n) => { if (selNodes.has(n.id)) { n.x += dx; n.y += dy; } });
      render();
      scheduleExport(true);
    }
  }
  document.addEventListener('keydown', onKeyDown);

  // 窗口尺寸变化时：画布铺满区域跟随更新（内容保持 1:1 不缩放）
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!active) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { render(); }, 120);
  });

  /* ---------------- 源码 ↔ 模型 同步 ---------------- */
  function parsePosComments(src) {
    const map = {};
    String(src || '').split('\n').forEach((line) => {
      const m = line.match(/^%%\s*pos:([A-Za-z0-9_\-]+):(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
      if (m) map[m[1]] = { x: +m[2], y: +m[3] };
    });
    return map;
  }

  function getNodeStyles(src) {
    const map = {};
    String(src || '').split('\n').forEach((line) => {
      const m = line.match(/^\s*style\s+([A-Za-z0-9_\-]+)\s+(.+)$/);
      if (!m) return;
      const s = { fill: '', stroke: '', color: '', width: '' };
      m[2].split(',').forEach((part) => {
        const kv = part.trim().split(':');
        const k = kv[0].trim(), v = kv.slice(1).join(':').trim();
        if (k === 'fill') s.fill = v;
        else if (k === 'stroke') s.stroke = v;
        else if (k === 'color') s.color = v;
        else if (k === 'stroke-width') s.width = parseFloat(v) ? String(parseFloat(v)) : '';
      });
      map[m[1]] = s;
    });
    return map;
  }

  function getEdgeStyles(src) {
    const arr = [];
    String(src || '').split('\n').forEach((line) => {
      const m = line.match(/^\s*linkStyle\s+(\d+)\b[^:]*/);
      if (!m) return;
      const rest = line.slice(m[0].length).replace(/^:/, '').trim();
      const s = { stroke: '', width: '' };
      rest.split(',').forEach((part) => {
        const kv = part.trim().split(':');
        const k = kv[0].trim(), v = kv.slice(1).join(':').trim();
        if (k === 'stroke') s.stroke = v;
        else if (k === 'stroke-width') s.width = parseFloat(v) ? String(parseFloat(v)) : '';
      });
      arr[+m[1]] = s;
    });
    return arr;
  }

  async function importFromSource() {
    const src = ME.Editor.getSource();
    if (ME.Renderer.detectType(src) !== 'flow') {
      model = { nodes: [], edges: [] };
      selNodes.clear(); selEdgeId = null;
      diagram.innerHTML = '<div id="empty-hint">自由画布模式仅支持流程图（flowchart）\n请切换到源码模式修改图类型\n或在「插入」标签页中选择流程图模板</div>';
      svg = null; nodeEls.clear(); edgeEls.clear();
      ME.Props.showCanvasDiagram();
      return;
    }
    const flow = ME.Renderer.parseFlow(src);
    const posMap = parsePosComments(src);
    const nodeStyles = getNodeStyles(src);
    const edgeStyles = getEdgeStyles(src);
    const layout = await ME.Renderer.layoutFlow(src);

    // 节点 = 显式定义行 + 连线端点的内联定义（B --> C[结束] 中的 C）+ 其余隐式端点
    const byName = new Map();
    flow.nodes.forEach((n) => byName.set(n.name, n));
    (flow.inlineNodes || []).forEach((n) => {
      if (!byName.has(n.name)) byName.set(n.name, n);
    });
    flow.edges.forEach((e) => {
      if (!byName.has(e.from)) byName.set(e.from, { name: e.from, text: e.from, shape: 'rect' });
      if (!byName.has(e.to)) byName.set(e.to, { name: e.to, text: e.to, shape: 'rect' });
    });

    const nodes = [...byName.values()].map((n) => {
      const st = nodeStyles[n.name] || {};
      const text = unescLabel(n.text);
      const size = (layout && layout[text])
        ? { w: Math.max(60, Math.ceil(layout[text].w) + 16), h: Math.max(36, Math.ceil(layout[text].h) + 14) }
        : nodeSize(text, n.shape);
      return {
        id: n.name, name: n.name, label: text, shape: n.shape,
        x: 0, y: 0, w: size.w, h: size.h,
        fill: st.fill || DEF_FILL, stroke: st.stroke || DEF_STROKE,
        color: st.color || DEF_COLOR, width: DEF_WIDTH, // 线宽统一默认 1px
      };
    });

    // 位置：优先源码中的 %% pos: 注释；缺失的节点用 mermaid 自动布局补齐
    let baseX = MARGIN, baseY = MARGIN;
    const posKeys = Object.keys(posMap);
    if (posKeys.length) {
      baseX = Math.min.apply(null, posKeys.map((k) => posMap[k].x));
      baseY = Math.min.apply(null, posKeys.map((k) => posMap[k].y));
    }
    let layoutMinX = Infinity, layoutMinY = Infinity;
    let fallbackIdx = 0;
    nodes.forEach((n) => {
      if (posMap[n.name]) { n.x = posMap[n.name].x; n.y = posMap[n.name].y; return; }
      const l = layout && layout[n.label];
      if (l) {
        n.x = l.x; n.y = l.y;
        layoutMinX = Math.min(layoutMinX, l.x);
        layoutMinY = Math.min(layoutMinY, l.y);
      } else {
        // 布局缺失（渲染失败 / 标签被转义）：从左上角依次排开，避免重叠
        n.x = baseX + (fallbackIdx % 8) * 120;
        n.y = baseY + Math.floor(fallbackIdx / 8) * 90;
        fallbackIdx++;
      }
    });
    if (layoutMinX !== Infinity) {
      const dx = baseX - layoutMinX;
      const dy = baseY - layoutMinY;
      nodes.forEach((n) => {
        if (!posMap[n.name] && layout && layout[n.label]) { n.x += dx; n.y += dy; }
      });
    }
    nodes.forEach((n) => {
      if (!posMap[n.name]) { n.x = Math.round(n.x); n.y = Math.round(n.y); }
    });

    const edges = flow.edges.map((e, i) => {
      const st = edgeStyles[i] || {};
      return {
        id: 'e' + i, from: e.from, to: e.to, label: unescLabel(e.label || ''), connector: e.connector,
        color: st.stroke || DEF_ECOLOR, width: DEF_EWIDTH, // 线宽统一默认 1px
      };
    });

    model = { nodes: nodes, edges: edges };
    selNodes.clear(); selEdgeId = null;
    render();
    ME.Props.showCanvasDiagram();
    ME.app.setStatus('自由画布已同步源码', 'ok');
  }

  function flowHeader(src) {
    const m = String(src || '').match(/^(flowchart|graph)(\s+(TD|TB|BT|LR|RL))?\b/);
    if (m) return m[1] + (m[2] || ' TD');
    return 'flowchart ' + (ME.Renderer.getCfg().direction || 'TD');
  }

  function exportToSource() {
    if (!active) return;
    const cur = ME.Editor.getSource();
    if (ME.Renderer.detectType(cur) !== 'flow') return; // 非流程图不写回，避免覆盖

    const lines = [flowHeader(cur)];
    if (!model.nodes.length && !model.edges.length) {
      selfEdit = true;
      ME.Editor.setSource(lines[0] + '\n');
      selfEdit = false;
      return;
    }
    model.nodes.forEach((n) => {
      const shape = ME.SHAPES.find((s) => s.id === n.shape) || ME.SHAPES[0];
      lines.push('    ' + n.name + shape.t[0] + escLabel(n.label) + shape.t[1]);
    });
    model.edges.forEach((e) => {
      let conn = e.connector;
      const label = e.label ? '|' + escLabel(e.label) + '|' : '';
      // '--' 与 '-.' 带标签时改用三字符形式，避免源码解析歧义
      if (label && conn === '--') conn = '---';
      if (label && conn === '-.') conn = '-.-';
      lines.push('    ' + e.from + ' ' + conn + label + ' ' + e.to);
    });
    model.nodes.forEach((n) => {
      const s = nodeStyleStr(n);
      if (s) lines.push('    style ' + n.name + ' ' + s);
    });
    model.edges.forEach((e, i) => {
      const s = edgeStyleStr(e);
      if (s) lines.push('    linkStyle ' + i + ' ' + s);
    });
    if (model.nodes.length) {
      lines.push('%% 自由画布布局（mermaid 注释，不影响渲染）');
      model.nodes.forEach((n) => lines.push('%% pos:' + n.name + ':' + Math.round(n.x) + ',' + Math.round(n.y)));
    }
    selfEdit = true;
    ME.Editor.setSource(lines.join('\n') + '\n');
    selfEdit = false;
  }

  function scheduleExport(now) {
    clearTimeout(exportTimer);
    exportTimer = setTimeout(exportToSource, now ? 0 : 300);
  }

  function onSourceChanged() {
    if (selfEdit) return;
    clearTimeout(importTimer);
    importTimer = setTimeout(importFromSource, 400);
  }

  /* ---------------- 模式生命周期 ---------------- */
  function enter() {
    if (active) return;
    active = true;
    document.body.classList.add('canvas-mode');
    diagram.classList.add('fc');
    ME.Props.showCanvasDiagram();
    importFromSource();
    // 进入画布模式：把状态栏缩放滑块同步到画布缩放
    if (ME.app && ME.app.updateZoomUI) ME.app.updateZoomUI(zoomFactor);
    ME.app.setStatus('自由画布：拖入形状 · 拖动端口连线 · 双击编辑 · Delete 删除');
  }

  function exit() {
    if (!active) return;
    exportToSource();
    active = false;
    document.body.classList.remove('canvas-mode');
    document.body.classList.remove('connect-mode');
    diagram.classList.remove('fc');
    if (editInput) { editInput.blur(); editInput = null; }
    selNodes.clear(); selEdgeId = null; drag = null; connectTool = null;
    ME.Renderer.renderNow();
  }

  /* ---------------- 形状面板 / 插入 ---------------- */
  function pickStencil(type, id, evt) {
    if (type === 'template') {
      const tpl = ME.TEMPLATES.find((t) => t.id === id);
      if (!tpl) return;
      const ok = ME.Editor.getSource().trim()
        ? ME.app.confirmAsync ? ME.app.confirmAsync('用「' + tpl.label + '」模板替换当前源代码？') : Promise.resolve(true)
        : Promise.resolve(true);
      ok.then((confirmed) => {
        if (!confirmed) return;
        ME.Editor.setSource(tpl.code);
        ME.app.toast('已载入「' + tpl.label + '」模板（自由画布已同步）');
        ME.app.switchTab('home');
      });
      return; // setSource → onSourceChange → 画布自动重新导入
    }
    if (type === 'edge') {
      const edge = ME.EDGES.find((e) => e.id === id);
      if (!edge) return;
      // 进入连线工具：按住节点拖到另一节点，或依次点击两个节点（可连续画，Esc 取消）
      connectTool = { conn: edge.conn, from: null, cur: null };
      document.body.classList.add('connect-mode');
      selNodes.clear(); selEdgeId = null;
      render();
      ME.app.toast('连线模式：按住节点拖到另一节点画箭头（Esc 取消）');
      ME.app.setStatus('连线模式：请点击「起点节点」（Esc 取消）');
      return;
    }
    if (type === 'shape') {
      const shape = ME.SHAPES.find((s) => s.id === id);
      if (!shape) return;
      let pt = null;
      if (evt && svg) pt = svgPoint(evt);
      if (!pt) pt = { x: viewBox.x + viewBox.w / 2, y: viewBox.y + viewBox.h / 2 };
      const node = addNode(id, pt.x, pt.y);
      if (node) {
        selNodes.clear(); selNodes.add(node.id); selEdgeId = null;
        ME.Props.showCanvasNode(node);
        ME.app.toast('已添加「' + shape.label + '」');
      }
    }
  }

  return {
    get active() { return active; },
    getModel: () => model,
    selectedIds: () => [...selNodes],
    enter: enter,
    exit: exit,
    onSourceChanged: onSourceChanged,
    pickStencil: pickStencil,
    updateNode: updateNode,
    updateEdge: updateEdge,
    removeNodes: removeNodes,
    removeEdge: removeEdge,
    setZoomFactor: setZoomFactor,
    getZoomFactor: getZoomFactor,
    fitView: fitView,
  };
})();

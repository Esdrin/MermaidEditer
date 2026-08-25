'use strict';
window.ME = window.ME || {};

/* ---------------- 导出（PNG / SVG / PDF / Markdown） ---------------- */
ME.Export = (function () {
  function baseName() {
    const p = ME.app.currentPath || '';
    if (p) {
      const b = p.split(/[\\/]/).pop();
      const n = b.replace(/\.[^.]+$/, '');
      return n || 'diagram';
    }
    return 'diagram';
  }

  /** 序列化当前 SVG（显式尺寸 + viewBox + xmlns） */
  function svgXml() {
    const svg = ME.Renderer.getSvg();
    if (!svg) return null;
    const clone = svg.cloneNode(true);
    // 自由画布：剥离交互辅助元素（端口、临时连线、选中态）
    clone.querySelectorAll('.fc-ports, .fc-temp-edge').forEach((x) => x.remove());
    clone.querySelectorAll('.fc-edge.sel, .fc-node.sel').forEach((x) => x.classList.remove('sel'));
    const bb = svg.getBBox();
    clone.removeAttribute('style');
    clone.removeAttribute('width');
    clone.removeAttribute('height');
    clone.setAttribute('width', Math.ceil(bb.width));
    clone.setAttribute('height', Math.ceil(bb.height));
    clone.setAttribute('viewBox', bb.x + ' ' + bb.y + ' ' + bb.width + ' ' + bb.height);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return new XMLSerializer().serializeToString(clone);
  }

  function png() {
    const svg = ME.Renderer.getSvg();
    if (!svg) { ME.app.toast('没有可导出的图形', 'error'); return; }
    const xml = svgXml();
    const bb = svg.getBBox();
    const w = Math.ceil(bb.width) + 8;
    const h = Math.ceil(bb.height) + 8;
    const bg = ME.Renderer.getCfg().bg || '#ffffff';
    // 隐藏窗口真实渲染后捕获（foreignObject 会污染 canvas，不能用 canvas.toDataURL）
    const html = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<style>html,body{margin:0;padding:0;background:' + bg + ';}' +
      'svg{display:block;margin:0 auto;}</style></head><body>' + xml + '</body></html>';
    window.api.exportImage({ html: html, width: w, height: h, bg: bg }, baseName() + '.png')
      .then((r) => { if (!r.canceled) ME.app.toast('已导出 PNG 图片'); });
  }

  function svg() {
    const xml = svgXml();
    if (!xml) { ME.app.toast('没有可导出的图形', 'error'); return; }
    window.api.exportSvg(xml, baseName() + '.svg')
      .then((r) => { if (!r.canceled) ME.app.toast('已导出 SVG 矢量图'); });
  }

  function pdf() {
    const xml = svgXml();
    if (!xml) { ME.app.toast('没有可导出的图形', 'error'); return; }
    const html = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<style>html,body{margin:0;padding:0;} body{padding:28px;box-sizing:border-box;}' +
      'svg{width:100%;height:auto;}</style></head><body>' + xml + '</body></html>';
    window.api.exportPdf(html, baseName() + '.pdf')
      .then((r) => { if (!r.canceled) ME.app.toast('已导出 PDF 文档'); });
  }

  function md() {
    const src = ME.Editor.getSource();
    if (!src.trim()) { ME.app.toast('没有可导出的内容', 'error'); return; }
    const text = '```mermaid\n' + src.replace(/\s+$/, '') + '\n```\n';
    window.api.exportMd(text, baseName() + '.md')
      .then((r) => { if (!r.canceled) ME.app.toast('已导出 Markdown'); });
  }

  return {
    png: png,
    svg: svg,
    pdf: pdf,
    md: md,
    svgXml: svgXml,
  };
})();

'use strict';
window.ME = window.ME || {};

/** 生成内联 SVG（描边风格，24×24） */
ME.svg = function (inner, extra) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"' +
    (extra ? ' ' + extra : '') + '>' + inner + '</svg>';
};

ME.escapeRe = function (s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

ME.ICONS = {
  new: ME.svg('<path d="M7 3h8l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M12 10v6M9 13h6"/>'),
  open: ME.svg('<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M13 9.5l3.5 3.5-3.5 3.5"/><path d="M16.5 13H8.5"/>'),
  save: ME.svg('<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M7.5 3.5V9h9V3.5"/><rect x="7.5" y="13.5" width="9" height="7"/>'),
  saveas: ME.svg('<rect x="3.5" y="4.5" width="13" height="13" rx="1.5"/><path d="M7.5 4.5V9h5.5V4.5"/><rect x="7" y="12" width="6" height="5.5"/><path d="M18 12.5l3.5-3.5 1.5 1.5-3.5 3.5z"/><path d="M20 11v7.5"/>'),
  undo: ME.svg('<path d="M9 7L4 12l5 5"/><path d="M4 12h9a6.5 6.5 0 0 1 6.5 6.5v1"/>'),
  redo: ME.svg('<path d="M15 7l5 5-5 5"/><path d="M20 12h-9a6.5 6.5 0 0 0-6.5 6.5v1"/>'),
  cut: ME.svg('<circle cx="6.5" cy="6.5" r="2.5"/><circle cx="6.5" cy="17.5" r="2.5"/><path d="M8.6 8.4L19 19"/><path d="M8.6 15.6L19 5"/>'),
  copy: ME.svg('<rect x="9" y="9" width="11.5" height="11.5" rx="1"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>'),
  paste: ME.svg('<rect x="5" y="4" width="14" height="17" rx="1"/><path d="M9 4a3 3 0 0 1 6 0"/><path d="M9 10h6M9 14h6M9 18h4"/>'),
  render: ME.svg('<path d="M21 12a9 9 0 1 1-2.7-6.4"/><path d="M21 3v5h-5"/>'),
  eye: ME.svg('<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  zoomin: ME.svg('<circle cx="11" cy="11" r="6.5"/><path d="M15.5 15.5L20 20"/><path d="M11 8.5v5M8.5 11h5"/>'),
  zoomout: ME.svg('<circle cx="11" cy="11" r="6.5"/><path d="M15.5 15.5L20 20"/><path d="M8.5 11h5"/>'),
  fit: ME.svg('<path d="M4 9V6a2 2 0 0 1 2-2h3"/><path d="M20 9V6a2 2 0 0 0-2-2h-3"/><path d="M4 15v3a2 2 0 0 0 2 2h3"/><path d="M20 15v3a2 2 0 0 1-2 2h-3"/>'),
  zoom100: ME.svg('<text x="12" y="15.5" text-anchor="middle" font-size="8.5" font-weight="700" fill="currentColor" stroke="none">100</text>'),
  shapes: ME.svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><rect x="13.5" y="13.5" width="7" height="7" rx="1"/><path d="M7 14.5v5M4.5 17h5"/>'),
  arrow: ME.svg('<path d="M3 12h14.5"/><path d="M14.5 7.5L19 12l-4.5 4.5"/>'),
  layers: ME.svg('<path d="M12 3l9 4.5L12 12 3 7.5z"/><path d="M3 12.5l9 4.5 9-4.5"/>'),
  palette: ME.svg('<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.8 2-1.8s-.9-1.7-.1-2.7c.5-.7 1.3-.5 2.3-.5h2.3a3.4 3.4 0 0 0 3.4-3.4C21.9 7.8 17.5 3 12 3z"/><circle cx="7.8" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.2" r="1" fill="currentColor" stroke="none"/><circle cx="16.4" cy="10.5" r="1" fill="currentColor" stroke="none"/>'),
  dir: ME.svg('<path d="M12 4v16"/><path d="M8 8l4-4 4 4"/><path d="M8 16l4 4 4-4"/>'),
  curve: ME.svg('<path d="M4 17c0-9 13-10 16-11"/><circle cx="4" cy="17" r="1.6" fill="currentColor" stroke="none"/><circle cx="20" cy="6" r="1.6" fill="currentColor" stroke="none"/>'),
  font: ME.svg('<path d="M4 20l6.5-16h3L20 20"/><path d="M7.3 14h9.4"/>'),
  size: ME.svg('<path d="M3.5 20l5-16h2l5 16"/><path d="M6.2 13.5h7.5"/>'),
  textcolor: ME.svg('<path d="M4 20l6.5-16h3L20 20"/><path d="M7.3 14h9.4"/><path d="M5.5 22h13"/>'),
  pagebg: ME.svg('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="8.8" cy="9.2" r="1.5" fill="currentColor" stroke="none"/>'),
  split: ME.svg('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M12 4.5v15"/>'),
  sidesplit: ME.svg('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 12h17"/>'),
  canvas: ME.svg('<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><circle cx="9" cy="9.8" r="1.6"/><path d="M3.5 15l4.5-3.5 4 3 4-2.5 4.5 3.5"/>'),
  code: ME.svg('<path d="M8.5 7.5L4 12l4.5 4.5"/><path d="M15.5 7.5L20 12l-4.5 4.5"/>'),
  linenums: ME.svg('<path d="M4 6.5h3M4 12h3M4 17.5h3"/><path d="M11 6.5h9M11 12h9M11 17.5h9"/>'),
  griddots: ME.svg('<circle cx="4" cy="4" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="4" r="1.1" fill="currentColor" stroke="none"/><circle cx="20" cy="4" r="1.1" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="20" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="4" cy="20" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="20" r="1.1" fill="currentColor" stroke="none"/><circle cx="20" cy="20" r="1.1" fill="currentColor" stroke="none"/>'),
  png: ME.svg('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="9" cy="9.5" r="1.8"/><path d="M3.5 15.5l4.5-4 4 3.5 3.5-3 5 4.5"/>'),
  svgfile: ME.svg('<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4"/><path d="M8 15l-2 2 2 2"/><path d="M16 15l2 2-2 2"/><path d="M13.5 12.5L11 19"/>'),
  pdffile: ME.svg('<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4"/><rect x="7.5" y="13" width="9" height="5" rx=".5"/>'),
  mdfile: ME.svg('<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4"/><path d="M8.5 15V9l2.5 4 2.5-4v6"/>'),
  power: ME.svg('<path d="M12 3v9"/><path d="M6.3 6.5a8 8 0 1 0 11.4 0"/>'),
  sync: ME.svg('<path d="M20 11a8 8 0 0 0-14.9-3.5"/><path d="M4 5v5h5"/><path d="M4 13a8 8 0 0 0 14.9 3.5"/><path d="M20 19v-5h-5"/>'),
  folder: ME.svg('<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  refresh: ME.svg('<path d="M21 12a9 9 0 1 1-2.7-6.4"/><path d="M21 3v5h-5"/>'),
  folderopen: ME.svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 10h18"/>'),
  // 对齐整理
  'align-left': ME.svg('<path d="M4 5.5h16"/><rect x="4" y="9" width="6" height="6" rx="1"/><path d="M4 19.5h12"/>'),
  'align-hcenter': ME.svg('<path d="M4 5.5h16"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M4 19.5h16"/>'),
  'align-right': ME.svg('<path d="M4 5.5h16"/><rect x="14" y="9" width="6" height="6" rx="1"/><path d="M8 19.5h12"/>'),
  'align-top': ME.svg('<path d="M5.5 4h13"/><rect x="9" y="8" width="6" height="6" rx="1"/><path d="M5.5 18h13"/>'),
  'align-vcenter': ME.svg('<path d="M5.5 4h13"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M5.5 20h13"/>'),
  'align-bottom': ME.svg('<path d="M5.5 4h13"/><rect x="9" y="14" width="6" height="6" rx="1"/><path d="M5.5 20h13"/>'),
};

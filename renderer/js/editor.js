'use strict';
window.ME = window.ME || {};

/* ---------------- 代码编辑器（textarea + 行号 + 撤销历史） ---------------- */
ME.Editor = (function () {
  const ta = document.getElementById('code');
  const gutter = document.getElementById('gutter');
  const posEl = document.getElementById('code-pos');

  const undoStack = [];
  const redoStack = [];
  const MAX_HISTORY = 300;
  const LINE_H = 20; // 12.5px × 1.6

  let composing = false;
  let beforeValue = '';
  let highlightLine = -1;

  function lineCount() {
    let n = 1;
    const v = ta.value;
    for (let i = 0; i < v.length; i++) if (v[i] === '\n') n++;
    return n;
  }

  function updateGutter() {
    const n = lineCount();
    let html = '';
    for (let i = 1; i <= n; i++) {
      html += '<div class="ln' + (i === highlightLine ? ' hl' : '') + '">' + i + '</div>';
    }
    gutter.innerHTML = html;
  }

  function updatePos() {
    const v = ta.value;
    let line = 1, col = 1;
    const end = Math.min(ta.selectionEnd, v.length);
    for (let i = 0; i < end; i++) {
      if (v[i] === '\n') { line++; col = 1; } else col++;
    }
    posEl.textContent = line + ' : ' + col;
  }

  function pushHistory(v) {
    const now = Date.now();
    const top = undoStack[undoStack.length - 1];
    if (top && now - top.t < 800) {
      top.v = v; top.t = now; // 合并连续输入
    } else {
      undoStack.push({ v: v, t: now });
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
    }
    redoStack.length = 0;
  }

  function applyValue(v) {
    ta.value = v;
    updateGutter();
    updatePos();
    ME.app.onSourceChange();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push({ v: ta.value, t: Date.now() });
    applyValue(undoStack.pop().v);
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push({ v: ta.value, t: Date.now() });
    applyValue(redoStack.pop().v);
  }

  /* ---- 事件 ---- */
  ta.addEventListener('beforeinput', () => { beforeValue = ta.value; });
  ta.addEventListener('compositionstart', () => { composing = true; beforeValue = ta.value; });
  ta.addEventListener('compositionend', () => {
    composing = false;
    if (beforeValue !== ta.value) pushHistory(beforeValue);
    updateGutter(); updatePos();
    ME.app.onSourceChange();
  });
  ta.addEventListener('input', () => {
    if (!composing && beforeValue !== ta.value) pushHistory(beforeValue);
    updateGutter(); updatePos();
    ME.app.onSourceChange();
  });
  ta.addEventListener('keyup', updatePos);
  ta.addEventListener('click', updatePos);
  ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
  ta.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = (e.key || '').toLowerCase();
    if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (ctrl && k === 'y') { e.preventDefault(); redo(); }
  });
  // 点击行号 → 跳转光标
  gutter.addEventListener('mousedown', (e) => {
    const ln = e.target.closest('.ln');
    if (!ln) return;
    e.preventDefault();
    selectLine(parseInt(ln.textContent, 10) - 1, { focus: true });
  });

  /* ---- 对外 API ---- */
  function getSource() { return ta.value; }

  function setSource(src, opts) {
    opts = opts || {};
    if (src === ta.value) return;
    if (!opts.noHist) pushHistory(ta.value);
    ta.value = src;
    updateGutter(); updatePos();
    ME.app.onSourceChange();
  }

  function insertAtCursor(text) {
    pushHistory(ta.value);
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    applyValue(ta.value);
  }

  function selectLine(idx, opts) {
    opts = opts || {};
    const lines = ta.value.split('\n');
    if (idx < 0 || idx >= lines.length) return;
    let start = 0;
    for (let i = 0; i < idx; i++) start += lines[i].length + 1;
    const end = start + lines[idx].length;
    highlightLine = idx + 1;
    updateGutter();
    ta.focus();
    ta.setSelectionRange(start, end);
    // 滚动到该行
    const top = idx * LINE_H;
    if (top < ta.scrollTop) ta.scrollTop = top;
    else if (top + LINE_H > ta.scrollTop + ta.clientHeight) ta.scrollTop = top + LINE_H - ta.clientHeight + 10;
    gutter.scrollTop = ta.scrollTop;
    updatePos();
    if (opts.onSelect) opts.onSelect();
  }

  function clearHighlight() {
    if (highlightLine >= 0) { highlightLine = -1; updateGutter(); }
  }

  function currentLineIdx() {
    let line = 0;
    const end = Math.min(ta.selectionStart, ta.value.length);
    for (let i = 0; i < end; i++) if (ta.value[i] === '\n') line++;
    return line;
  }

  function format() {
    let v = ta.value.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\s+$/, '');
    v += '\n';
    setSource(v);
    return v;
  }

  return {
    ta: ta,
    getSource: getSource,
    setSource: setSource,
    insertAtCursor: insertAtCursor,
    selectLine: selectLine,
    clearHighlight: clearHighlight,
    currentLineIdx: currentLineIdx,
    undo: undo,
    redo: redo,
    format: format,
    updateGutter: updateGutter,
  };
})();

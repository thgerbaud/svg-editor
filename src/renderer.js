const DEFAULT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <circle cx="100" cy="100" r="80" fill="#7c6af7" opacity="0.8"/>
  <text x="100" y="108" text-anchor="middle" font-family="sans-serif" font-size="20" fill="white">
    SVG Editor
  </text>
</svg>`;

// -------------------- App state --------------------

let tabs = []; // { id, name, path, content, savedContent, cm }
let activeTabId = null;
let tabCounter = 0;
let zoom = 1;
let lightBg = true;
let previewUpdateTimer = null;

// -------------------- DOM refs --------------------

const tabsBar = document.getElementById('tabs-bar');
const tabNewBtn = document.getElementById('tab-new-btn');
const emptyState = document.getElementById('empty-state');
const editorPane = document.getElementById('editor-pane');
const resizer = document.getElementById('resizer');
const previewPane = document.getElementById('preview-pane');
const previewWrap = document.getElementById('preview-svg-wrap');
const previewError = document.getElementById('preview-error');
const zoomIndicator = document.getElementById('zoom-indicator');
const statusText = document.getElementById('status-text');
const statusSize = document.getElementById('status-size');
const statusPath = document.getElementById('status-path');

// -------------------- Code mirror --------------------

let cm = CodeMirror.fromTextArea(document.getElementById('codemirror-target'), {
  mode: 'xml',
  theme: 'dracula',
  keyMap: 'sublime',
  lineNumbers: true,
  matchBrackets: true,
  autoCloseTags: true,
  foldGutter: true,
  gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
  indentUnit: 2,
  tabSize: 2,
  indentWithTabs: false,
  lineWrapping: true,
  extraKeys: { //* Always use this order : Ctrl - Shift - Alt - Cmd - Any key
    'Ctrl-S': () => saveActiveTab(),
    'Cmd-S':  () => saveActiveTab(),
    'Tab': (cm) => {
      if (cm.somethingSelected()) cm.indentSelection('add');
      else cm.replaceSelection('  ', 'end');
    },
    // Duplicate line downwards
    'Shift-Alt-Down': (cm) => {
      const ranges = cm.listSelections();
      cm.operation(() => {
        ranges.forEach(range => {
          const line = range.head.line;
          const content = cm.getLine(line);
          cm.replaceRange('\n' + content, { line, ch: content.length });
        });
      });
    },
    // Duplicate line upwards
    'Shift-Alt-Up': (cm) => {
      const ranges = cm.listSelections();
      cm.operation(() => {
        ranges.forEach(range => {
          const line = range.head.line;
          const content = cm.getLine(line);
          cm.replaceRange('\n' + content, { line, ch: content.length });
          cm.setCursor({ line, ch: range.head.ch });
        });
      });
    },
    // Move line downwards
    'Alt-Down': (cm) => {
      const cursor = cm.getCursor();
      const line = cursor.line;
      if (line === cm.lastLine()) return;
      cm.operation(() => {
        const current = cm.getLine(line);
        const next = cm.getLine(line + 1);
        cm.replaceRange(next, { line, ch: 0 }, { line, ch: current.length });
        cm.replaceRange(current, { line: line + 1, ch: 0 }, { line: line + 1, ch: next.length });
        cm.setCursor({ line: line + 1, ch: cursor.ch });
      });
    },
    // Move line upwards
    'Alt-Up': (cm) => {
      const cursor = cm.getCursor();
      const line = cursor.line;
      if (line === 0) return;
      cm.operation(() => {
        const current = cm.getLine(line);
        const prev = cm.getLine(line - 1);
        cm.replaceRange(current, { line: line - 1, ch: 0 }, { line: line - 1, ch: prev.length });
        cm.replaceRange(prev, { line, ch: 0 }, { line, ch: current.length });
        cm.setCursor({ line: line - 1, ch: cursor.ch });
      });
    },
    // Comment/uncomment line or selection
    'Ctrl-/': (cm) => cm.toggleComment({ lineComment: null, blockCommentStart: '<!--', blockCommentEnd: '-->' }),
    'Shift-Alt-A': (cm) => cm.toggleComment({ lineComment: null, blockCommentStart: '<!--', blockCommentEnd: '-->' }),
  },
});

// Fit CodeMirror to container
function resizeCM() {
  const wrap = document.getElementById('editor-wrap');
  cm.setSize('100%', wrap.offsetHeight + 'px');
}
window.addEventListener('resize', resizeCM);

// -------------------- Tabs management --------------------

function createTab({ name, path, content }) {
  const id = ++tabCounter;
  const tab = { id, name, path, content, savedContent: content };
  tabs.push(tab);
  renderTabsBar();
  activateTab(id);
  return id;
}

function activateTab(id) {
  activeTabId = id;
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  
  // Show panes
  emptyState.style.display = 'none';
  editorPane.style.display = 'flex';
  resizer.style.display = 'block';
  previewPane.style.display = 'flex';
  
  // Load content into CM
  cm.off('change', onEditorChange);
  cm.setValue(tab.content || '');
  cm.off('change', onEditorChange);
  cm.on('change', onEditorChange);
  cm.clearHistory();
  cm.refresh();
  
  renderTabsBar();
  updatePreview(tab.content);
  updateStatusBar(tab);
  setTimeout(resizeCM, 10);
  setTimeout(updateColorDecorators, 100);
}

function renderTabsBar() {
  // Remove old tab elements
  const existing = tabsBar.querySelectorAll('.tab');
  existing.forEach(el => el.remove());
  
  tabs.forEach(tab => {
    const isActive   = tab.id === activeTabId;
    const isModified = tab.content !== tab.savedContent;
    
    const el = document.createElement('div');
    el.className = `tab${isActive ? ' active' : ''}${isModified ? ' modified' : ''}`;
    el.dataset.id = tab.id;
    el.innerHTML = `
      <span class="tab-dot"></span>
      <span class="tab-icon">⟨/⟩</span>
      <span class="tab-name">${escHtml(tab.name)}</span>
      <button class="tab-close" data-id="${tab.id}" title="Fermer">×</button>
    `;
    el.addEventListener('click', (e) => {
      if (!e.target.classList.contains('tab-close')) activateTab(tab.id);
    });
    el.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    tabsBar.insertBefore(el, tabNewBtn);
  });
}

async function closeTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  
  if (tab.content !== tab.savedContent) {
    const resp = await window.electronAPI.confirmClose(tab.name);
    if (resp === 0) { // save
      const saved = await saveTab(tab);
      if (!saved) return;
    } else if (resp === 2) { // cancel
      return;
    }
  }
  
  const idx = tabs.findIndex(t => t.id === id);
  tabs.splice(idx, 1);
  
  if (tabs.length === 0) {
    activeTabId = null;
    emptyState.style.display = 'flex';
    editorPane.style.display = 'none';
    resizer.style.display = 'none';
    previewPane.style.display = 'none';
    renderTabsBar();
    updateStatusBar(null);
  } else {
    const nextIdx = Math.min(idx, tabs.length - 1);
    activateTab(tabs[nextIdx].id);
  }
}

function onEditorChange() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  tab.content = cm.getValue();
  renderTabsBar();
  updateStatusBar(tab);
  clearTimeout(previewUpdateTimer);
  previewUpdateTimer = setTimeout(() => updatePreview(tab.content), 300);
}

async function saveTab(tab) {
  if (!tab) tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return false;
  
  if (tab.path) {
    const r = await window.electronAPI.saveFile(tab.path, tab.content);
    if (r.success) {
      tab.savedContent = tab.content;
      renderTabsBar();
      setStatus('Enregistré', 1500);
      return true;
    } else {
      setStatus('Erreur lors de l\'enregistrement', 2000);
      return false;
    }
  } else {
    return saveTabAs(tab);
  }
}

async function saveTabAs(tab) {
  if (!tab) tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return false;
  
  const result = await window.electronAPI.saveFileDialog(tab.path || tab.name);
  if (result.canceled) return false;
  
  const r = await window.electronAPI.saveFile(result.filePath, tab.content);
  if (r.success) {
    tab.path = result.filePath;
    tab.name = result.filePath.split(/[\\/]/).pop();
    tab.savedContent = tab.content;
    renderTabsBar();
    updateStatusBar(tab);
    setStatus('Enregistré sous ' + tab.name, 2000);
    return true;
  }
  return false;
}

function saveActiveTab() { saveTab(); }

tabNewBtn.addEventListener('click', newFile);

// -------------------- Preview --------------------

function updatePreview(svgCode) {
  previewError.style.display = 'none';
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgCode, 'image/svg+xml');
    const parseErr = doc.querySelector('parsererror');
    if (parseErr) throw new Error(parseErr.textContent.split('\n')[0]);
    
    const svgEl = doc.documentElement;
    if (svgEl.tagName.toLowerCase() !== 'svg') throw new Error('Le document ne contient pas de balise <svg>');
    
    previewWrap.innerHTML = '';
    previewWrap.appendChild(document.importNode(svgEl, true));
    applyZoom();
    updateStatusSize(svgCode);
  } catch (err) {
    previewError.textContent = '⚠ ' + err.message;
    previewError.style.display = 'block';
  }
}

// Zoom 
function applyZoom() {
  previewWrap.style.transform = `scale(${zoom})`;
  previewWrap.style.transformOrigin = 'center center';
  zoomIndicator.textContent = Math.round(zoom * 100) + '%';
  zoomIndicator.classList.add('visible');
}

document.getElementById('btn-zoom-in').addEventListener('click', () => { zoom = Math.min(zoom + 0.25, 5); applyZoom(); });
document.getElementById('btn-zoom-out').addEventListener('click', () => { zoom = Math.max(zoom - 0.25, 0.1); applyZoom(); });
document.getElementById('btn-zoom-reset').addEventListener('click', () => { zoom = 1; applyZoom(); });

previewWrap.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    zoom = Math.min(Math.max(zoom - e.deltaY * 0.001, 0.1), 5);
    applyZoom();
  }
}, { passive: false });

// Background toggle 
document.getElementById('btn-bg-toggle').addEventListener('click', () => {
  lightBg = !lightBg;
  document.getElementById('preview-container').style.background = lightBg ? '' : 'repeating-conic-gradient(#151520 0% 25%, #111118 0% 50%) 0 0 / 24px 24px';
});

// -------------------- Status bar --------------------

function updateStatusBar(tab) {
  if (!tab) {
    statusText.textContent = 'Prêt';
    statusSize.textContent = '-';
    statusPath.textContent = 'Aucun fichier';
    return;
  }
  statusText.textContent = tab.content !== tab.savedContent ? 'Modifié' : 'Enregistré';
  statusPath.textContent = tab.path || '(nouveau fichier)';
  updateStatusSize(tab.content);
}

function updateStatusSize(content) {
  const bytes = new Blob([content]).size;
  statusSize.textContent = bytes < 1024 ? bytes + ' o' : (bytes / 1024).toFixed(1) + ' Ko';
}

function setStatus(msg, duration = 2000) {
  statusText.textContent = msg;
  if (duration) setTimeout(() => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) updateStatusBar(tab);
  }, duration);
}

// -------------------- Resizer --------------------

let isResizing = false;

resizer.addEventListener('mousedown', (e) => {
  isResizing = true;
  resizer.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});

document.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const main = document.getElementById('main');
  const rect = main.getBoundingClientRect();
  const pct = ((e.clientX - rect.left) / rect.width) * 100;
  const clamped = Math.min(Math.max(pct, 20), 80);
  editorPane.style.width = clamped + '%';
  resizeCM();
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

// -------------------- Electron menu events --------------------

window.electronAPI.onMenuNew(() => newFile());
window.electronAPI.onMenuSave(() => saveActiveTab());
window.electronAPI.onMenuSaveAs(() => saveTabAs());
window.electronAPI.onMenuCloseTab(() => { if (activeTabId) closeTab(activeTabId); });
window.electronAPI.onMenuFormat(() => format());
window.electronAPI.onMenuSelectAll(() => {
  cm.execCommand('selectAll');
  cm.focus();
});
window.electronAPI.onMenuRefresh(() => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) updatePreview(tab.content);
});

async function openFile() {
  await window.electronAPI.openFileDialog();
}

function newFile() {
  createTab({ name: 'nouveau.svg', path: null, content: DEFAULT_SVG });
}

function format() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  try {
    const formatted = formatXml(cm.getValue());
    cm.setValue(formatted);
  } catch (e) {
    setStatus('Erreur de formatage', 1500);
  }
}

function formatXml(xml) {
  let indent = 0;
  const lines = xml
  .replace(/>\s*</g, '>\n<')
  .split('\n')
  .map(line => line.trim())
  .filter(l => l);
  
  return lines.map(line => {
    if (line.startsWith('</')) indent = Math.max(0, indent - 1);
    const out = '  '.repeat(indent) + line;
    if (line.startsWith('<') && !line.startsWith('</') && !line.endsWith('/>') && !line.includes('</')) indent++;
    return out;
  }).join('\n');
}

// -------------------- Files management --------------------

window.electronAPI.onFileOpened(({ path, content }) => {
  // check if already open
  const existing = tabs.find(t => t.path === path);
  if (existing) { activateTab(existing.id); return; }
  createTab({ name: path.split(/[\\/]/).pop(), path, content });
});

// Drag and drop files
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  Array.from(e.dataTransfer.files).forEach(file => {
    if (file.name.endsWith('.svg') || file.type === 'image/svg+xml') {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const existing = tabs.find(t => t.path === file.path);
        if (existing) { activateTab(existing.id); return; }
        createTab({ name: file.name, path: file.path || null, content: ev.target.result });
      };
      reader.readAsText(file);
    }
  });
});

// -------------------- Utilities --------------------

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// -------------------- Color decorators --------------------

const COLOR_REGEX = /#([0-9a-fA-F]{3,8})\b|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)/g;

function updateColorDecorators() {

  if (document.querySelector('.cm-color-swatch:focus')) return;

  document.querySelectorAll('.cm-color-swatch').forEach((input) => document.body.removeChild(input));

  cm.getAllMarks().forEach(mark => {
    if (mark._isColorDecorator) {
      mark.clear();
    };
  });

  const content = cm.getValue();
  let match;
  COLOR_REGEX.lastIndex = 0;

  while ((match = COLOR_REGEX.exec(content)) !== null) {
    const color = match[0];
    
    const from = cm.posFromIndex(match.index);
    const to = cm.posFromIndex(match.index + color.length);

    const swatch = document.createElement('span');
    swatch.style.cssText = `
      display: inline-block;
      width: 10px; height: 10px;
      background: ${color};
      border: 1px solid rgba(255,255,255,0.3);
      border-radius: 2px;
      margin-right: 4px;
      cursor: pointer;
      vertical-align: middle;
      position: relative;
      top: -1px;
    `;

    const marker = cm.setBookmark(from, {
      widget: swatch,
      handleMouseEvents: true,
    });
    marker._isColorDecorator = true;

    addColorPicker(color, from, to, swatch);
  }
}

function addColorPicker(currentColor, from, to, anchor) {
  const input = document.createElement('input');
  input.type = 'color';
  input.value = normalizeToHex(currentColor);

  const rect = anchor.getBoundingClientRect();
  input.style.cssText = `
    position: fixed;
    left: ${rect.left}px;
    top: ${rect.top}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    opacity: 0;
    cursor: pointer;
    padding: 0;
    border: none;
  `;
  input.className = 'cm-color-swatch';
  document.body.appendChild(input);

  input.addEventListener('input', () => {
    applyColor(input.value, from, to);
    anchor.style.background = input.value;
  });

  input.addEventListener('change', () => {
    applyColor(input.value, from, to);
  });
}

function applyColor(newColor, from, to) {
  // recalculate `to` if text changed
  const line = cm.getLine(from.line);
  COLOR_REGEX.lastIndex = 0;
  let match;
  while ((match = COLOR_REGEX.exec(line)) !== null) {
    if (match.index === from.ch) {
      to = { line: from.line, ch: match.index + match[0].length };
      break;
    }
  }
  cm.replaceRange(newColor, from, to);
}

function normalizeToHex(color) {
  // convert rgb() to hex for native input color
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.fillStyle = color;
  return ctx.fillStyle; // always return hex
}

// Upadte decorators after each change
let colorDecoratorTimer;
cm.on('change', () => {
  clearTimeout(colorDecoratorTimer);
  colorDecoratorTimer = setTimeout(updateColorDecorators, 400);
});
cm.on('swapDoc', updateColorDecorators);
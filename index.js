/* ----------------------------------------------------------------------------- */
/* ------------------------- Draw grid on app start up ------------------------- */
/* ----------------------------------------------------------------------------- */
window.addEventListener('DOMContentLoaded', () => {
  updateCamera();
});

const svg = document.getElementById('svgCanvas');

/* ----------------------------------------------------------------------------- */
/* -------------Prevent browser auto-scroll on middle mouse -------------------- */
/* ----------------------------------------------------------------------------- */
window.addEventListener('mousedown', e => {
  if (e.button === 1) {
    e.preventDefault();
  }
}, { passive: false });

// Start camera pan (middle mouse)
window.addEventListener('mousedown', e => {
  if (e.button !== 1) return;

  panning = true;
  panStart = { x: e.clientX, y: e.clientY };
  camStart = { x: camX, y: camY };
});

/* ----------------------------------------------------------------------------- */
/* ----------------------------- Helper functions ------------------------------ */
/* ----------------------------------------------------------------------------- */
function getScreenPoint(evt) {
  return {x: evt.clientX, y: evt.clientY};
}


/* ----------------------------------------------------------------------------- */
/* ----------------------------- Camera zoom limit ----------------------------- */
/* ----------------------------------------------------------------------------- */
const camera = document.getElementById('camera');

let camX = 0;
let camY = 0;
let camScale = 1;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 10;

function updateCamera() {
  camera.setAttribute(
    'transform',
    `translate(${camX}, ${camY}) scale(${camScale})`
  );

  drawGrid(); // ✅ keep grid visually constant
  drawRulers();
}

/* ----------------------------------------------------------------------------- */
/* -------------------------------- Menu actions ------------------------------- */
/* ----------------------------------------------------------------------------- */
const menus = document.querySelectorAll('.menu');

let menuActive = false;

menus.forEach(menu => {
  // Click to activate menu system
  menu.addEventListener('mousedown', e => {
    e.stopPropagation();
    openMenu(menu);
    menuActive = true;
  });

  // Hover switches menus *only when active*
  menu.addEventListener('mouseenter', () => {
    if (menuActive) {
      openMenu(menu);
    }
  });
});

// Click outside closes everything
document.addEventListener('mousedown', () => {
  closeAll();
  menuActive = false;
});

function openMenu(menu) {
  closeAll();
  menu.classList.add('open');
}

function closeAll() {
  menus.forEach(m => m.classList.remove('open'));
}

/*--------- hide sub menu on click --------------*/
document.querySelectorAll('.menu .item').forEach(item => {
  item.addEventListener('click', () => {
    closeAll();
    menuActive = false;
  });
});

document.getElementById('newFile').onclick = () => {
  console.log('New file');
};

document.getElementById('saveFile').onclick = () => {
  console.log('Save');
};

document.getElementById('undo').onclick = () => {
  console.log('Undo');
};

document.getElementById('duplicate').onclick = () => {
  duplicateSelected();
};

document.getElementById('delete').onclick = () => {
  deleteSelected();
};

document.getElementById('zoomIn').onclick = () => {
  console.log('Zoom in');
  // camera.zoomBy(1.2);
};

document.getElementById('zoomOut').onclick = () => {
  console.log('Zoom out');
};

document.getElementById('zoomReset').onclick = () => {
  resetZoom();
};

document.getElementById('fitToScreen').onclick = () => {
  console.log('Fit to screen');
};

document.getElementById('bringToFront').onclick = () => {
  bringToFront();
};

document.getElementById('bringForward').onclick = () => {
  bringForward();
};

document.getElementById('sendBackward').onclick = () => {
  sendBackward();
};

document.getElementById('sendToBack').onclick = () => {
  sendToBack();
};

/*-------- Grid rulers ----------*/
const RULER_SIZE = 20;
const RULER_STEP = 50; // same feel as Boxy

function drawRulers() {
  const rulerX = document.getElementById('rulerX');
  const rulerY = document.getElementById('rulerY');

  const contentX = rulerX.querySelector('.ruler-content');
  const contentY = rulerY.querySelector('.ruler-content');

  rulerX.innerHTML = '';
  rulerY.innerHTML = '';

  const rect = svg.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  const step = RULER_STEP * camScale;
  if (step < 25) return;

  /* ---------- Horizontal ruler ---------- */
  for (let x = camX % step; x < width; x += step) {
    const value = Math.round((x - camX) / camScale);

    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', x);
    line.setAttribute('y1', 0);
    line.setAttribute('x2', x);
    line.setAttribute('y2', RULER_SIZE);
    line.classList.add('ruler-line');

    if (value % (RULER_STEP * 5) === 0) {
      line.classList.add('major');

      const text = document.createElementNS(NS, 'text');
      text.setAttribute('x', x + 2);
      text.setAttribute('y', 12);
      text.textContent = value;
      text.classList.add('ruler-text');
      rulerX.appendChild(text);
    }

    rulerX.appendChild(line);
  }

  /* ---------- Vertical ruler ---------- */
  for (let y = camY % step; y < height; y += step) {
    const value = Math.round((y - camY) / camScale);

    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', 0);
    line.setAttribute('y1', y);
    line.setAttribute('x2', RULER_SIZE);
    line.setAttribute('y2', y);
    line.classList.add('ruler-line');

    if (value % (RULER_STEP * 5) === 0) {
      line.classList.add('major');

      const text = document.createElementNS(NS, 'text');
      text.setAttribute('x', 2);
      text.setAttribute('y', y - 2);
      text.textContent = value;
      text.classList.add('ruler-text');
      rulerY.appendChild(text);
    }

    rulerY.appendChild(line);
  }
}

/*-------- Toggle grid ----------*/
const toggleGridBtn = document.getElementById('toggleGrid');
const grid = document.getElementById('gridLayer');
const gridCheck = document.getElementById('gridCheck');

let gridVisible = true;

const NS = 'http://www.w3.org/2000/svg';
const BASE_GRID_SIZE = 25;   // Boxy-like
const MAJOR_STEP = 5;

// initial state
grid.style.display = 'block';
gridCheck.textContent = '✓';
gridCheck.style.visibility = 'visible';

toggleGridBtn.addEventListener('click', e => {
  e.stopPropagation();

  if (gridVisible === true) {
    // hide
    gridVisible = false;
    grid.style.display = 'none';
    gridCheck.style.visibility = 'hidden';
    gridCheck.textContent = '';
  } else {
    // show
    gridVisible = true;
    grid.style.display = 'block';
    gridCheck.textContent = '✓';
    gridCheck.style.visibility = 'visible';
  }
});

/* --------- Draw grid ---------*/
function drawGrid() {
  gridLayer.innerHTML = '';

  const rect = svg.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  const gridSize = BASE_GRID_SIZE * camScale; // ✅ FIX
  if (gridSize < 8) return; // optional safety

  const offsetX = camX % gridSize;
  const offsetY = camY % gridSize;

  for (let x = offsetX; x < width; x += gridSize) {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', x);
    line.setAttribute('y1', 0);
    line.setAttribute('x2', x);
    line.setAttribute('y2', height);

    const i = Math.round((x - offsetX) / gridSize);
    line.classList.add(
      'grid-line',
      i % MAJOR_STEP === 0 ? 'major' : 'minor'
    );

    gridLayer.appendChild(line);
  }

  for (let y = offsetY; y < height; y += gridSize) {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', 0);
    line.setAttribute('y1', y);
    line.setAttribute('x2', width);
    line.setAttribute('y2', y);

    const i = Math.round((y - offsetY) / gridSize);
    line.classList.add(
      'grid-line',
      i % MAJOR_STEP === 0 ? 'major' : 'minor'
    );

    gridLayer.appendChild(line);
  }
}

/* ---- Toolbar actions ---- */
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const resetZoomBtn = document.getElementById('resetZoomBtn');

undoBtn.onclick = () => {
  console.log('Undo');
  // editor.undo();
};

redoBtn.onclick = () => {
  console.log('Redo');
  // editor.redo();
};

/* Optional state update example */
function updateUndoRedo(canUndo, canRedo) {
  undoBtn.disabled = !canUndo;
  redoBtn.disabled = !canRedo;
}

/* Reset zoom */
function resetZoom() {
  camX = 0;
  camY = 0;
  camScale = 1;
  updateCamera();
}

resetZoomBtn.addEventListener('click', resetZoom);
/* ----------------------------------------------------------------------------- */
/* ---------------------------- Left toolbar actions --------------------------- */
/* ----------------------------------------------------------------------------- */
const transformTool = document.getElementById('transformTool');
const editTool = document.getElementById('editTool');

let activeTool = 'transform'; // transform | edit | draw

function setActiveTool(tool) {
  transformTool.classList.remove('active');
  editTool.classList.remove('active');
  tool.classList.add('active');
}

transformTool.onclick = () => {
  setActiveTool(transformTool);
  activeTool = 'transform';
  svg.classList.remove('draw-cursor');
};

editTool.onclick = () => {
  setActiveTool(editTool);
  activeTool = 'edit';
};

drawTool.onclick = () => {
  setActiveTool(drawTool);
  activeTool = 'draw';
  svg.classList.add('draw-cursor');
};

/* ----------------------------------------------------------------------------- */
/* ----------------------------- Canvas drawing -------------------------------- */
/* ----------------------------------------------------------------------------- */
const contentLayer = document.getElementById('contentLayer');

let drawing = false;
let path = null;

let panning = false;
let panStart = null;
let camStart = null;

function getSVGPoint(evt) {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;

  const screenCTM = svg.getScreenCTM();
  const camCTM = camera.getCTM();

  return pt.matrixTransform(screenCTM.inverse()).matrixTransform(camCTM.inverse());
}

function handleDrawStart(e) {
  drawing = true;

  const pt = getSVGPoint(e);

  path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', `M ${pt.x} ${pt.y}`);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#000');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');

  contentLayer.appendChild(path);
}

function handleTransformStart(e) {
  const target = e.target;

  // ─────────────────────────────────────────
  // 1️⃣ Clicked EMPTY canvas → deselect + marquee
  // ─────────────────────────────────────────
  if (target === svg || target.parentNode !== contentLayer) {
    clearSelection();
    startMarquee(e);
    return;
  }

  // ─────────────────────────────────────────
  // 2️⃣ Clicked a PATH
  // ─────────────────────────────────────────
  const additive = e.shiftKey;

  // If clicking a non-selected path → select it
  if (!selectedElements.includes(target)) {
    selectElement(target, additive);
  }

  // Start dragging ONLY when clicking on a path
  isDragging = true;
  dragStart = getSVGPoint(e);

  startTransforms.clear();
  selectedElements.forEach(el => {
    startTransforms.set(el, getTranslate(el));
  });

  e.preventDefault();
}

document.addEventListener('DOMContentLoaded', () => {

  svg.addEventListener('mousedown', () => {
    console.log('SVG mousedown');
  });

  if (!svg) {
    console.error('SVG canvas (#svgCanvas) not found');
    return;
  }

svg.addEventListener('mousedown', e => {

  // Middle mouse = camera pan
  if (e.button === 1) return;

  if (activeTool === 'draw') {
    handleDrawStart(e);
    return;
  }

  if (activeTool === 'transform') {
    handleTransformStart(e);
    return;
  }

  if (activeTool === 'edit') {
    handleEditStart(e);
  }
});

  svg.addEventListener('mousemove', e => {
    if (!drawing || activeTool !== 'draw' || !path) return;

    const pt = getSVGPoint(e, svg);
    path.setAttribute('d', path.getAttribute('d') + ` L ${pt.x} ${pt.y}`);
  });
});

/* -------------------------------------------------------------------- */
/* ---------------------------- Mouse zoom ---------------------------- */
/* -------------------------------------------------------------------- */
svg.addEventListener('wheel', e => {
  e.preventDefault();

  const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
  const pt = getSVGPoint(e);

  const newScale = camScale * zoomFactor;

  // ⛔ clamp zoom
  if (newScale < MIN_ZOOM || newScale > MAX_ZOOM) return;

  camX = pt.x - (pt.x - camX) * zoomFactor;
  camY = pt.y - (pt.y - camY) * zoomFactor;
  camScale = newScale;

  updateCamera();
}, { passive: false });

/* ----------------------------------------------------------------------------- */
/* ------------------------------ Marquee selection ---------------------------- */
/* ----------------------------------------------------------------------------- */
const overlayLayer = document.getElementById('overlayLayer');

let marqueeRect = null;
let marqueeStart = null;
let marqueeActive = false;
let marqueeBounds = null;

function startMarquee(e) {
  marqueeActive = true;
  marqueeStart = getSVGPoint(e);

  marqueeRect = document.createElementNS(NS, 'rect');
  marqueeRect.classList.add('marquee-rect');

  overlayLayer.appendChild(marqueeRect);
}

function handleMarqueeMove(e) {
  if (!marqueeActive || !marqueeRect) return;

  const pt = getSVGPoint(e);

  const x = Math.min(pt.x, marqueeStart.x);
  const y = Math.min(pt.y, marqueeStart.y);
  const w = Math.abs(pt.x - marqueeStart.x);
  const h = Math.abs(pt.y - marqueeStart.y);

  marqueeRect.setAttribute('x', x);
  marqueeRect.setAttribute('y', y);
  marqueeRect.setAttribute('width', w);
  marqueeRect.setAttribute('height', h);
}

function endMarquee() {
  marqueeActive = false;
  marqueeStart = null;

  // 🔥 ALWAYS remove marquee visuals
  const rects = overlayLayer.querySelectorAll('.marquee-rect');
  rects.forEach(r => r.remove());

  marqueeRect = null;
}

function selectByMarquee(additive = false) {
  if (!marqueeRect) return;

  if (!additive) clearSelection();

  const marqueeScreen = marqueeRect.getBoundingClientRect();

  for (const el of contentLayer.children) {
    const elScreen = el.getBoundingClientRect();

    const intersects =
      elScreen.left < marqueeScreen.right &&
      elScreen.right > marqueeScreen.left &&
      elScreen.top < marqueeScreen.bottom &&
      elScreen.bottom > marqueeScreen.top;

    if (intersects && !selectedElements.includes(el)) {
      selectedElements.push(el);
    }
  }

  if (selectedElements.length) {
    selectedElement = selectedElements[selectedElements.length - 1];
    drawSelectionBoxes();
  }
}

/* ----------------------------------------------------------------------------- */
/* ---------------------------- Selection rectangle ---------------------------- */
/* ----------------------------------------------------------------------------- */
const selectionLayer = document.getElementById('selectionLayer');

let selectedElement = null;
let selectionRect = null;
let selectedElements = [];
let startTransforms = new Map();

let isDragging = false;
let dragStart = null;
let startTranslate = { x: 0, y: 0 };

function getSelectedInDOMOrder() {
  return [...contentLayer.children].filter(el =>
    selectedElements.includes(el)
  );
}

function selectElement(el, additive = false) {
  if (!additive) {
    clearSelection();
  }

  if (!selectedElements.includes(el)) {
    selectedElements.push(el);
  }

  selectedElement = el; // last selected
  drawSelectionBoxes();
}

//--------------- Clear selection -----------------
function clearSelection() {
  selectedElements = [];
  selectedElement = null;
  selectionLayer.innerHTML = '';
  selectionLayer.removeAttribute('transform');
}

//--------------- Duplicate selected path -----------------
function duplicateSelected() {
  if (!selectedElements.length) return;

  const OFFSET = 10;
  const newSelection = [];

  selectedElements.forEach(el => {
    const clone = el.cloneNode(true);

    const t = getTranslate(el);
    clone.setAttribute(
      'transform',
      `translate(${t.x + OFFSET}, ${t.y + OFFSET})`
    );

    contentLayer.appendChild(clone);
    newSelection.push(clone);
  });

  // Replace selection with duplicates
  clearSelection();
  newSelection.forEach(el => selectedElements.push(el));
  selectedElement = newSelection[newSelection.length - 1];

  drawSelectionBoxes();
}

//--------------- Delete selected path -----------------
function deleteSelected() {
  if (!selectedElements.length) return;

  selectedElements.forEach(el => {
    if (el.parentNode === contentLayer) {
      el.remove();
    }
  });

  clearSelection();
}

/* ---------------- Arrange logic ---------------- */
function bringToFront() {
  const ordered = getSelectedInDOMOrder();
  ordered.forEach(el => contentLayer.appendChild(el));
  drawSelectionBoxes();
}

function sendToBack() {
  const ordered = getSelectedInDOMOrder();
  ordered.reverse().forEach(el =>
    contentLayer.insertBefore(el, contentLayer.firstChild)
  );
  drawSelectionBoxes();
}

function bringForward() {
  const ordered = getSelectedInDOMOrder();

  // move topmost first to avoid leapfrogging
  ordered.slice().reverse().forEach(el => {
    const next = el.nextSibling;
    if (next) {
      contentLayer.insertBefore(next, el);
    }
  });

  drawSelectionBoxes();
}

function sendBackward() {
  const ordered = getSelectedInDOMOrder();

  ordered.forEach(el => {
    const prev = el.previousSibling;
    if (prev) {
      contentLayer.insertBefore(el, prev);
    }
  });

  drawSelectionBoxes();
}

//--------------- Get translation -----------------
function getTranslate(el) {
  const t = el.getAttribute('transform');
  if (!t) return { x: 0, y: 0 };

  const m = t.match(/translate\(([^)]+)\)/);
  if (!m) return { x: 0, y: 0 };

  const [x, y] = m[1].split(',').map(Number);
  return { x, y };
}

//--------------- Draw selection boxes -----------------
function drawSelectionBoxes() {
  selectionLayer.innerHTML = '';

  selectedElements.forEach(el => {
    const bbox = el.getBBox();
    const t = getTranslate(el);

    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', bbox.x);
    rect.setAttribute('y', bbox.y);
    rect.setAttribute('width', bbox.width);
    rect.setAttribute('height', bbox.height);
    rect.setAttribute('class', 'selection-rect');

    const g = document.createElementNS(NS, 'g');
    g.setAttribute('transform', `translate(${t.x}, ${t.y})`);
    g.appendChild(rect);

    selectionLayer.appendChild(g);
  });
}

/*------------ Start drag ---------------*/
function handleTransformMove(e) {
  if (!isDragging || !selectedElements.length) return;

  const pt = getSVGPoint(e);
  const dx = pt.x - dragStart.x;
  const dy = pt.y - dragStart.y;

  selectedElements.forEach(el => {
    const start = startTransforms.get(el) || { x: 0, y: 0 };
    el.setAttribute(
      'transform',
      `translate(${start.x + dx}, ${start.y + dy})`
    );
  });

  drawSelectionBoxes();
}

function handleDrawMove(e) {
  if (!drawing || !path) return;

  const pt = getSVGPoint(e);
  path.setAttribute(
    'd',
    path.getAttribute('d') + ` L ${pt.x} ${pt.y}`
  );
}

window.addEventListener('mousemove', e => {
  // Camera pan has priority
  if (panning) {
    camX = camStart.x + (e.clientX - panStart.x);
    camY = camStart.y + (e.clientY - panStart.y);
    updateCamera();
    return;
  }
  /*--------------- Left toolbar -----------------*/
  if (activeTool === 'draw') {
    handleDrawMove(e);
  }

  if (activeTool === 'transform') {
    handleTransformMove(e);
    handleMarqueeMove(e);
  }

  /*--------------- Camera pan -----------------*/
  if (!panning) return;

  camX = camStart.x + (e.clientX - panStart.x);
  camY = camStart.y + (e.clientY - panStart.y);
  updateCamera();
});

window.addEventListener('mouseup', e => {

  path = null;
  panning = false;
  isDragging = false;

  if (marqueeRect) {
    selectByMarquee(e.shiftKey);
  }

  endMarquee(); // 🔥 unconditional cleanup
});

window.addEventListener('keydown', e => {
  // Ignore if user is typing in an input (future-safe)
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  // Duplicate path
  if (e.ctrlKey && e.key.toLowerCase() === 'd') {
    if (selectedElements.length) {
      e.preventDefault();
      duplicateSelected();
    }
  }

  // Delete path
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedElements.length) {
      e.preventDefault();
      deleteSelected();
    }
  }
});

function updateSelectionBox(el) {
  const rect = selectionLayer.querySelector('rect');
  if (!rect) return;

  const bbox = el.getBBox();
  rect.setAttribute('x', bbox.x);
  rect.setAttribute('y', bbox.y);
  rect.setAttribute('width', bbox.width);
  rect.setAttribute('height', bbox.height);
}


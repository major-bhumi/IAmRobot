/* ----------------------------------------------------------------------------- */
/* --------------------------------- Variables --------------------------------- */
/* ----------------------------------------------------------------------------- */
const svg = document.getElementById('svgCanvas');
const contextMenu = document.getElementById('contextMenu');

let draggedLayerId = null;
let isRenamingLayer = false;

let activeControlPoint = null;

let freehandPoints = [];
let activeFreehandPath = null;

let newElements = []; // temp storage for newly drawn/freehand/rect/ellipse

let activeAnchorIndex = null;

let selectedAnchorPath = null;
let selectedAnchorIndex = null;

const MIN_DRAW_DISTANCE = 32; // tweak: 4–8 feels good

// History stacks
let undoStack = [];
let redoStack = [];
const MAX_HISTORY = 50; // limit for memory

/* ----------------------------------------------------------------------------- */
/* ---------------------------------- Context menu ----------------------------- */
/* ----------------------------------------------------------------------------- */
function openContextMenu(x, y) {
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.classList.remove('hidden');
}

function closeContextMenu() {
  contextMenu.classList.add('hidden');
}

/* ----------------------------------------------------------------------------- */
/* ------------------------------- Clear selected anchor ----------------------- */
/* ----------------------------------------------------------------------------- */
function clearSelectedAnchor() {
  selectedAnchorPath = null;
  selectedAnchorIndex = null;
}

/* ----------------------------------------------------------------------------- */
/* ------------- Prevent browser auto-scroll on middle mouse ------------------- */
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

function isLayerVisible(el) {
  return el.style.display !== 'none';
}

function setLayerVisible(el, visible) {
  el.style.display = visible ? '' : 'none';

  // If hidden and selected → deselect
  if (!visible && selectedElements.includes(el)) {
    selectedElements = selectedElements.filter(e => e !== el);
    if (selectedElement === el) {
      selectedElement = null;
    }
    drawSelectionBoxes();
  }
}

function isLayerLocked(el) {
  return el.dataset.locked === 'true';
}

function setLayerLocked(el, locked) {
  el.dataset.locked = locked ? 'true' : 'false';

  // If locked and selected → deselect
  if (locked && selectedElements.includes(el)) {
    selectedElements = selectedElements.filter(e => e !== el);
    if (selectedElement === el) {
      selectedElement = null;
    }
    drawSelectionBoxes();
  }
}

function distancePointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) {
    return Math.hypot(px - x1, py - y1);
  }

  const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
  const clampedT = Math.max(0, Math.min(1, t));

  const cx = x1 + clampedT * dx;
  const cy = y1 + clampedT * dy;

  return {
    dist: Math.hypot(px - cx, py - cy),
    x: cx,
    y: cy
  };
}

function distancePointToQuadratic(px, py, x1, y1, cx, cy, x2, y2) {
  const STEPS = 20; // good balance of accuracy vs speed

  let best = {
    dist: Infinity,
    x: 0,
    y: 0
  };

  let prevX = x1;
  let prevY = y1;

  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const mt = 1 - t;

    const x =
      mt * mt * x1 +
      2 * mt * t * cx +
      t * t * x2;

    const y =
      mt * mt * y1 +
      2 * mt * t * cy +
      t * t * y2;

    const hit = distancePointToSegment(
      px, py,
      prevX, prevY,
      x, y
    );

    if (hit.dist < best.dist) {
      best = hit;
    }

    prevX = x;
    prevY = y;
  }

  return best;
}

/* -------------- Undo redo -----------------*/
function snapshotHistory() {
  redoStack = [];

  if (!selectedAnchorPath) return;

  undoStack.push({
    path: selectedAnchorPath,
    points: selectedAnchorPath.__points.map(p => ({ ...p }))
  });

  if (undoStack.length > MAX_HISTORY) {
    undoStack.shift();
  }
}

/* ----------------------------------------------------------------------------- */
/* -------------------------------- Anchor snap -------------------------------- */
/* ----------------------------------------------------------------------------- */
function snapAnchorsIfClose(path, clickedIndex) {
  const pts = path.__points;
  if (!pts || pts.length < 2) return;

  const threshold = 5; // distance in pixels to consider "on top of each other"
  const clicked = pts[clickedIndex];

  // Loop through all other anchors
  for (let i = 0; i < pts.length; i++) {
    if (i === clickedIndex) continue;
    const pt = pts[i];
    const dist = Math.hypot(clicked.x - pt.x, clicked.y - pt.y);

    if (dist <= threshold) {
      // Snap this anchor to the clicked anchor
      pt.x = clicked.x;
      pt.y = clicked.y;

      // Optional: highlight or redraw
      rebuildPathFromPoints(path);
      clearControlPoints();
      drawControlPoints(path);

      // We only snap the first anchor found within threshold
      break;
    }
  }
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

  updateStage();
  drawGrid(); // ✅ keep grid visually constant
  drawRulers();
}

/* ----------------------------------------------------------------------------- */
/* ------------------------------ Document Stage -------------------------------- */
/* ----------------------------------------------------------------------------- */
const stageRect = document.getElementById('stageRect');

let stage = {
  x: 0,
  y: 0,
  width: 800,
  height: 600
};

function updateStage() {
  stageRect.setAttribute('x', stage.x);
  stageRect.setAttribute('y', stage.y);
  stageRect.setAttribute('width', stage.width);
  stageRect.setAttribute('height', stage.height);
}

function centerStage() {
  const rect = svg.getBoundingClientRect();

  camScale = 1;

  camX = (rect.width - stage.width) / 2 - stage.x;
  camY = (rect.height - stage.height) / 2 - stage.y;

  camX = Math.round(camX);
  camY = Math.round(camY);

  updateCamera();
}

function resetZoomToCenter() {
  const rect = svg.getBoundingClientRect();

  camScale = 1;

  camX = (rect.width - stage.width) / 2 - stage.x;
  camY = (rect.height - stage.height) / 2 - stage.y;

  camX = Math.round(camX);
  camY = Math.round(camY);

  updateCamera();
}

function zoomToSelection(padding = 40) {
  if (!selectedElements.length) return;

  // Get combined bounding box in WORLD space
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  selectedElements.forEach(el => {
    const bbox = el.getBBox();
    const t = getTranslate(el);

    minX = Math.min(minX, bbox.x + t.x);
    minY = Math.min(minY, bbox.y + t.y);
    maxX = Math.max(maxX, bbox.x + bbox.width + t.x);
    maxY = Math.max(maxY, bbox.y + bbox.height + t.y);
  });

  const selWidth = maxX - minX;
  const selHeight = maxY - minY;

  if (selWidth === 0 || selHeight === 0) return;

  const rect = svg.getBoundingClientRect();

  // Calculate scale to fit selection
  const scaleX = (rect.width - padding * 2) / selWidth;
  const scaleY = (rect.height - padding * 2) / selHeight;

  camScale = Math.min(scaleX, scaleY);

  // Clamp zoom
  camScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camScale));

  // Center selection
  camX = rect.width / 2 - ((minX + maxX) / 2) * camScale;
  camY = rect.height / 2 - ((minY + maxY) / 2) * camScale;

  camX = Math.round(camX);
  camY = Math.round(camY);

  updateCamera();
}

/* ----------------------------------------------------------------------------- */
/* ---------------------------------- Undo redo -------------------------------- */
/* ----------------------------------------------------------------------------- */
function undo() {
  if (!undoStack.length) return;

  const last = undoStack.pop();

  // Save current for redo
  redoStack.push({
    path: last.path,
    points: last.path.__points.map(p => ({ ...p }))
  });

  // Restore points
  last.path.__points = last.points.map(p => ({ ...p }));

  // 🔥 THIS IS THE FIX
  rebuildPathFromPoints(last.path);

  clearControlPoints();
  drawControlPoints(last.path);
}

function redo() {
  if (!redoStack.length) return;

  const next = redoStack.pop();

  undoStack.push({
    path: next.path,
    points: next.path.__points.map(p => ({ ...p }))
  });

  next.path.__points = next.points.map(p => ({ ...p }));

  rebuildPathFromPoints(next.path);
  clearControlPoints();
  drawControlPoints(next.path);
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
  item.addEventListener('click', e => {
    e.stopPropagation();

    // 🔴 CLOSE MENUS HERE
    closeAll();
    menuActive = false;

    const target = [...contentLayer.children]
      .find(el => el.dataset.layerId === item.dataset.targetId);

    if (!target || isLayerLocked(target) || target.style.display === 'none') return;

    const additive = e.shiftKey;
    selectElement(target, additive);
  });
});

document.getElementById('newFile').onclick = () => {
  console.log('New file');
};

document.getElementById('saveFile').onclick = () => {
  console.log('Save');
};

document.getElementById('undo').onclick = () => {
  undo();
};

document.getElementById('undo').onclick = () => {
  redo();
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
  centerStage();
};

document.getElementById('zoomResetCenter').onclick = () => {
  resetZoomToCenter();
};

document.getElementById('zoomToSelection').onclick = () => {
  zoomToSelection();
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

document.getElementById('exportImage').onclick = () => {
  exportImage();
};

/* ----------------------------------------------------------------------------- */
/* ------------------------------- Context menu -------------------------------- */
/* ----------------------------------------------------------------------------- */
menuAbout.addEventListener('click', () => {
  closeContextMenu();
});

/* ----------------------------------------------------------------------------- */
/* -------------------------------- File menu ---------------------------------- */
/* ----------------------------------------------------------------------------- */
function hardClearMarquee() {
  marqueeActive = false;
  marqueeStart = null;

  const rects = overlayLayer.querySelectorAll('.marquee-rect');
  rects.forEach(r => r.remove());

  marqueeRect = null;
}

function newDocument() {
  // 🔥 hard reset edit UI first
  clearControlPoints();
  
  // reset inspector
  inspectorEmpty.style.display = 'block';
  inspectorPath.classList.add('hidden');

  // reset stage size (whatever you already use)
  stage.width = 800;
  stage.height = 600;

  // 🔒 reset camera state FIRST
  camScale = 1;
  camX = 0;
  camY = 0;

  updateCamera(); // flush any previous pan/zoom

  // ✅ center AFTER layout settles
  requestAnimationFrame(centerStage);

  // remove existing content
  contentLayer.innerHTML = '';
  selectionLayer.innerHTML = '';

  // clear layers UI directly (no helpers)
  layersList.innerHTML = '';

  // clear layers data (use your real variable)
  layers.length = 0;
  activeLayerId = null;
}

/* ----------------------------- File menu events ---------------------------------- */
document.getElementById('newFile').addEventListener('click', () => {
  if (contentLayer.children.length === 0) return;

  const confirmNew = confirm('Start a new document? Unsaved changes will be lost.');
  if (!confirmNew) return;

  newDocument();
});

/* ----------------------------- File menu keyboard ---------------------------------- */
document.addEventListener('keydown', e => {
  /*------ Context menu ----------*/
  if (e.key === 'Escape') {
    closeContextMenu();
  }

  /*--------- New document -----------*/
  if (e.ctrlKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    newDocument();
  }
});

document.addEventListener('mousedown', e => {
  if (!e.target.closest('.context-menu')) {
    closeContextMenu();
  }
});

/* ----------------------------------------------------------------------------- */
/* ----------------------------- Image Export ---------------------------------- */
/* ----------------------------------------------------------------------------- */
function exportImage(scale = 1) {
  const NS = 'http://www.w3.org/2000/svg';

  // Create clean SVG
  const exportSvg = document.createElementNS(NS, 'svg');
  exportSvg.setAttribute('xmlns', NS);
  exportSvg.setAttribute('width', stage.width * scale);
  exportSvg.setAttribute('height', stage.height * scale);
  exportSvg.setAttribute(
    'viewBox',
    `0 0 ${stage.width} ${stage.height}`
  );

  /* ---------- Stage background ---------- */
  const bg = document.createElementNS(NS, 'rect');
  bg.setAttribute('x', 0);
  bg.setAttribute('y', 0);
  bg.setAttribute('width', stage.width);
  bg.setAttribute('height', stage.height);
  bg.setAttribute('fill', stageRect.getAttribute('fill') || '#fff');
  exportSvg.appendChild(bg);

  /* ---------- Content group ---------- */
  const contentGroup = document.createElementNS(NS, 'g');
  contentGroup.setAttribute(
    'transform',
    `translate(${-stage.x}, ${-stage.y})`
  );

  [...contentLayer.children].forEach(el => {
    contentGroup.appendChild(el.cloneNode(true));
  });

  exportSvg.appendChild(contentGroup);

  /* ---------- Rasterize ---------- */
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(exportSvg);
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = stage.width * scale;
    canvas.height = stage.height * scale;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    URL.revokeObjectURL(url);

    saveCanvas(canvas, 'png');
  };

  img.src = url;
}

async function saveCanvas(canvas) {
  try {
    if (!window.showSaveFilePicker) return;

    const handle = await window.showSaveFilePicker({
      suggestedName: 'export.png',
      types: [
        {
          description: 'PNG Image',
          accept: { 'image/png': ['.png'] }
        },
        {
          description: 'JPEG Image',
          accept: { 'image/jpeg': ['.jpg', '.jpeg'] }
        },
        {
          description: 'WebP Image',
          accept: { 'image/webp': ['.webp'] }
        }
      ]
    });

    const name = handle.name.toLowerCase();

    let mime = 'image/png';
    if (name.endsWith('.jpg') || name.endsWith('.jpeg')) mime = 'image/jpeg';
    else if (name.endsWith('.webp')) mime = 'image/webp';

    const blob = await new Promise(resolve =>
      canvas.toBlob(
        resolve,
        mime,
        mime === 'image/jpeg' ? 0.92 : undefined
      )
    );

    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();

  } catch {
    // user cancelled → do nothing
  }
}

/* ----------------------------------------------------------------------------- */
/* ------------------------------ Grid rulers ---------------------------------- */
/* ----------------------------------------------------------------------------- */
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

let gridVisible = false;

const NS = 'http://www.w3.org/2000/svg';
const BASE_GRID_SIZE = 25;   // Boxy-like
const MAJOR_STEP = 5;

// initial state
grid.style.display = 'none';
gridCheck.style.visibility = 'hidden';
gridCheck.textContent = '';

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

/*-------- Toggle ruler ----------*/
const toggleRulerBtn = document.getElementById('toggleRulers');
const rulerCheck = document.getElementById('rulerCheck');
const rulerBgLayer = document.getElementById('rulerBgLayer');

let rulerVisible = true;

// initial state
rulerCheck.textContent = '✓';
rulerCheck.style.visibility = 'visible';

toggleRulerBtn.addEventListener('click', e => {
  e.stopPropagation();

  if (rulerVisible === true) {
    // hide
    rulerVisible = false;
    rulerX.style.display = 'none';
    rulerY.style.display = 'none';
    rulerBgLayer.style.display = 'none';
    rulerCheck.style.visibility = 'hidden';
    rulerCheck.textContent = '';
  } else {
    // show
    rulerVisible = true;
    rulerX.style.display = 'block';
    rulerY.style.display = 'block';
    rulerBgLayer.style.display = 'block';
    rulerCheck.textContent = '✓';
    rulerCheck.style.visibility = 'visible';
  }
});

/* --------- Draw grid ---------*/
function drawGrid() {
  gridLayer.innerHTML = '';

  const rect = svg.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  const worldGrid = BASE_GRID_SIZE;
  const scaledGrid = worldGrid * camScale;

  if (scaledGrid < 8) return;

  // 🌍 World-aligned start (THIS IS THE FLASH FIX)
  const worldStartX =
    Math.floor((-camX / camScale) / worldGrid) * worldGrid;

  const worldStartY =
    Math.floor((-camY / camScale) / worldGrid) * worldGrid;

  /* ---------- Vertical grid lines ---------- */
  for (
    let worldX = worldStartX;
    worldX * camScale + camX < width;
    worldX += worldGrid
  ) {
    const x = worldX * camScale + camX;

    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', x);
    line.setAttribute('y1', 0);
    line.setAttribute('x2', x);
    line.setAttribute('y2', height);

    const index = Math.round(worldX / worldGrid);
    line.classList.add(
      'grid-line',
      index % MAJOR_STEP === 0 ? 'major' : 'minor'
    );

    gridLayer.appendChild(line);
  }

  /* ---------- Horizontal grid lines ---------- */
  for (
    let worldY = worldStartY;
    worldY * camScale + camY < height;
    worldY += worldGrid
  ) {
    const y = worldY * camScale + camY;

    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', 0);
    line.setAttribute('y1', y);
    line.setAttribute('x2', width);
    line.setAttribute('y2', y);

    const index = Math.round(worldY / worldGrid);
    line.classList.add(
      'grid-line',
      index % MAJOR_STEP === 0 ? 'major' : 'minor'
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
  undo();
};

redoBtn.onclick = () => {
  console.log('Redo');
  redo();
};

/* Optional state update example */
function updateUndoRedo(canUndo, canRedo) {
  undoBtn.disabled = !canUndo;
  redoBtn.disabled = !canRedo;
}

/* Reset zoom */
function resetZoom() {
  camScale = 1;
  updateCamera();
}

resetZoomBtn.addEventListener('click', resetZoom);
/* ----------------------------------------------------------------------------- */
/* ---------------------------- Left toolbar actions --------------------------- */
/* ----------------------------------------------------------------------------- */
const transformTool = document.getElementById('transformTool');
const editTool = document.getElementById('editTool');
const rectangleTool = document.getElementById('rectangleTool');

const deleteAnchorTool = document.getElementById('deleteAnchorTool');
const addAnchorTool = document.getElementById('addAnchorTool');
const joinAnchorTool = document.getElementById('joinAnchorTool');

const splineTool = document.getElementById('splineTool');
const ellipseTool = document.getElementById('ellipseTool');

let activeTool = 'transform'; // transform | edit | draw

function setActiveTool(tool, toolName) {
  // 🔄 reset cursor FIRST
  svg.classList.remove(
    'draw-cursor',
    'svg-cursor-edit',
    'svg-cursor-add',
    'svg-cursor-delete',
    'svg-cursor-join'
  );
  svg.style.cursor = '';

  // 🧹 clear active state from ALL tools (including spline)
  document
    .querySelectorAll('.tool-btn.vertical')
    .forEach(btn => btn.classList.remove('active'));

  // ✅ activate current tool
  tool.classList.add('active');
  activeTool = toolName;

  clearControlPoints();

  // draw selection rectangle only if NOT join-anchor
  if (toolName !== 'join-anchor') {
    drawSelectionBoxes();
  }

  if (
    (toolName === 'edit' ||
     toolName === 'delete-anchor' ||
     toolName === 'add-anchor' ||
     toolName === 'join-anchor') &&
    selectedElements.length === 1 &&
    selectedElement?.tagName === 'path'
  ) {
    drawControlPoints(selectedElement);
  }
}

transformTool.onclick = () => {
  setActiveTool(transformTool, 'transform');
  svg.classList.remove('draw-cursor');
};

editTool.onclick = () => {
  setActiveTool(editTool, 'edit');
  svg.classList.remove('draw-cursor');
  svg.classList.add('svg-cursor-edit');
};

deleteAnchorTool.onclick = () => {
  setActiveTool(deleteAnchorTool, 'delete-anchor');
  svg.classList.remove('draw-cursor');
  svg.classList.add('svg-cursor-delete');
};

addAnchorTool.onclick = () => {
  setActiveTool(addAnchorTool, 'add-anchor');
  svg.classList.remove('draw-cursor');
  svg.classList.add('svg-cursor-add');
};

joinAnchorTool.onclick = () => {
  setActiveTool(joinAnchorTool, 'join-anchor');
  svg.classList.remove('draw-cursor');
  svg.classList.add('svg-cursor-join');
};

drawTool.onclick = () => {
  setActiveTool(drawTool, 'draw');
  svg.classList.add('draw-cursor');
};

splineTool.onclick = () => {
  setActiveTool(splineTool, 'spline');
  svg.classList.add('draw-cursor'); // or your spline cursor
};

rectangleTool.onclick = () => {
  setActiveTool(rectangleTool, 'rectangle');
  svg.classList.add('draw-cursor');
};

ellipseTool.onclick = () => {
  setActiveTool(ellipseTool, 'ellipse');
  svg.classList.add('draw-cursor');
};

/* ----------------------------------------------------------------------------- */
/* ----------------------------- Canvas drawing -------------------------------- */
/* ----------------------------------------------------------------------------- */
const contentLayer = document.getElementById('contentLayer');

let drawing = false;
let path = null;

let rectDrawing = false;
let rectStart = null;
let currentRect = null;

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

  freehandPoints = [{ x: pt.x, y: pt.y }];

  activeFreehandPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');

  activeFreehandPath.setAttribute('d', `M ${pt.x} ${pt.y}`);
  activeFreehandPath.setAttribute('fill', 'none');
  activeFreehandPath.setAttribute('stroke', '#000');
  activeFreehandPath.setAttribute('stroke-width', '2');
  activeFreehandPath.setAttribute('stroke-linecap', 'round');
  activeFreehandPath.setAttribute('stroke-linejoin', 'round');

  // 🔹 Append to SVG so user can see it while drawing
  contentLayer.appendChild(activeFreehandPath);

  // 🔹 Track for later conversion to symbol
  newElements.push(activeFreehandPath);

  // ❌ Do NOT call updateLayersPanel() yet
}

function handleRectangleStart(e) {
  rectDrawing = true;
  rectStart = getSVGPoint(e);

  currentRect = document.createElementNS(NS, 'rect');
  currentRect.setAttribute('x', rectStart.x);
  currentRect.setAttribute('y', rectStart.y);
  currentRect.setAttribute('width', 0);
  currentRect.setAttribute('height', 0);

  currentRect.setAttribute('fill', 'transparent');
  currentRect.setAttribute('stroke', '#000');
  currentRect.setAttribute('stroke-width', '2');

  newElements.push(currentRect);
  updateLayersPanel();
}

function handleTransformStart(e) {
  if (activeTool !== 'transform') return;

  const target = e.target;

  // ─────────────────────────────────────────
  // 1️⃣ Clicked EMPTY canvas → deselect + marquee
  // ─────────────────────────────────────────
  if (target === svg || target.parentNode !== contentLayer || target.style.display === 'none' || isLayerLocked(target)) {
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

function handleEditStart(e) {
  const target = e.target;

  if (
    target.parentNode !== contentLayer ||
    target.tagName !== 'path' ||
    isLayerLocked(target)
  ) {
    clearSelection();
    return;
  }

  if (!selectedElements.includes(target)) {
    selectElement(target);
  }

  e.stopPropagation();
}

function handleEllipseStart(e) {
  ellipseDrawing = true;
  ellipseStart = getSVGPoint(e);

  currentEllipse = document.createElementNS(NS, 'ellipse');
  currentEllipse.setAttribute('cx', ellipseStart.x);
  currentEllipse.setAttribute('cy', ellipseStart.y);
  currentEllipse.setAttribute('rx', 0);
  currentEllipse.setAttribute('ry', 0);

  currentEllipse.setAttribute('fill', 'transparent');
  currentEllipse.setAttribute('stroke', '#000');
  currentEllipse.setAttribute('stroke-width', '2');

  newElements.push(currentEllipse);
  updateLayersPanel();
}

document.addEventListener('DOMContentLoaded', () => {
  updateStage();
  centerStage();

  // Remove browser default right click menu
  document.addEventListener('contextmenu', e => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY);
  });

  svg.addEventListener('mousedown', () => {
    console.log('SVG mousedown');
  });

  if (!svg) {
    console.error('SVG canvas (#svgCanvas) not found');
    return;
  }

  // Flag to temporarily block deselection when clicking inside selection rectangle or handles
  let ignoreDeselect = false;

  svg.addEventListener('mousedown', e => {
    const handle = e.target.closest('.handle-rect');
    const rectGroup = e.target.closest('.selection-rect-group');
    const editLayerTarget = e.target.closest('#editLayer');

    // ⛔ Ignore clicks on edit-layer UI, handles, or selection rectangle
    if (handle || rectGroup || editLayerTarget) {
      e.stopPropagation(); // prevent deselection by other listeners
      ignoreDeselect = true; // block deselection for this click
      if (handle) startHandleDrag(e, handle); // start drag if it's a handle
      return; // do nothing else
    }

    // Middle mouse = camera pan
    if (e.button === 1) return;

    // Tools
    if (activeTool === 'add-anchor' && selectedElements.length === 1 && selectedElement?.tagName === 'path') {
      const pt = getSVGPoint(e);
      drawControlPoints(selectedElement);
      addAnchorToPath(selectedElement, pt.x, pt.y);
      return;
    }

    if (activeTool === 'delete-anchor' && editLayerTarget) return;

    if (activeTool === 'draw') {
      handleDrawStart(e);
      return;
    }

    if (activeTool === 'rectangle') {
      handleRectangleStart(e);
      return;
    }

    if (activeTool === 'transform') {
      handleTransformStart(e);
      return;
    }

    if (activeTool === 'edit') {
      snapshotHistory();
      handleEditStart(e);
      return;
    }

    if (activeTool === 'ellipse') {
      handleEllipseStart(e);
      return;
    }
  });

// Reset flag after mouse is released
window.addEventListener('mouseup', () => {
  ignoreDeselect = false;
});

// Modify your clearSelection() function (or wherever you deselect) like this:
function clearSelection() {
  if (ignoreDeselect) return; // skip clearing if click was inside selection rect or handle
  selectedElements = [];
  selectedElement = null;
  selectionLayer.innerHTML = '';
  selectionLayer.removeAttribute('transform');
}

  svg.addEventListener('pointerup', e => {
    draggingAnchor = null;
    draggingPath = null;
    activeHandle = null;
    activeControlPoint = null;
    activeAnchorIndex = null;

    try {
      svg.releasePointerCapture(e.pointerId);
    } catch {}
  });

  svg.addEventListener('pointermove', e => {
    // ⛔ No active drag → do nothing
    if (!draggingPath || draggingAnchor === null || (draggingAnchor !== 'bezier' && (!activeControlPoint || !activeControlPoint.__start))) {
      return;
    }

    if (!draggingPath || draggingAnchor === null) return;
    //if (!activeControlPoint || !activeControlPoint.__start) return;

    // 🔹 Anchor drag
    if (draggingPath && draggingAnchor !== null && draggingAnchor !== 'bezier') {
      if (!activeControlPoint || !activeControlPoint.__start) return;

      const start = activeControlPoint.__start;
      const pt = draggingPath.__points[draggingAnchor];

      const dx = (e.clientX - start.mouseX) / camScale;
      const dy = (e.clientY - start.mouseY) / camScale;

      pt.x = start.x + dx;
      pt.y = start.y + dy;

      rebuildPathFromPoints(draggingPath);

      // 🔹 Anchor drag → redraw
      if (draggingAnchor !== 'bezier') {
        clearControlPoints();
        drawControlPoints(draggingPath);
        return;
      }
    }

    // 🔹 Bezier handle drag
    if (draggingAnchor === 'bezier' && activeHandle) {
      const start = activeHandle.__start;
      const pt = activeHandle.path.__points[activeHandle.pointIndex];

      if (!pt) return;

      const dx = (e.clientX - start.mouseX) / camScale;
      const dy = (e.clientY - start.mouseY) / camScale;

      pt.cx = start.cx + dx;
      pt.cy = start.cy + dy;

      rebuildPathFromPoints(activeHandle.path);

      clearControlPoints();
      drawControlPoints(activeHandle.path);
    }
  });

  const contextMenu = document.getElementById('contextMenu');
  const menuAbout = document.getElementById('menuAbout');
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

    if (intersects && !selectedElements.includes(el) && !isLayerLocked(el) && el.style.display !== 'none') {
      selectedElements.push(el);
    }
  }

  if (selectedElements.length) {
    selectedElement = selectedElements[selectedElements.length - 1];
    drawSelectionBoxes();
    updateInspector();
  }
}

/* ----------------------------------------------------------------------------- */
/* ---------------------------- Selection rectangle ---------------------------- */
/* ----------------------------------------------------------------------------- */
const selectionLayer = document.getElementById('selectionLayer');
const editLayer = document.getElementById('editLayer');

let selectedElement = null;
let selectionRect = null;
let selectedElements = [];
let startTransforms = new Map();

let isDragging = false;
let dragStart = null;
let draggingAnchor = null;
let draggingPath = null;
let startTranslate = { x: 0, y: 0 };

let ellipseDrawing = false;
let ellipseStart = null;
let currentEllipse = null;

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
  updateInspector();

  // 🔹 Only update layers panel if element is marked as a symbol
  if (el.__isSymbol) {
    updateLayersPanel();
  }

  if (activeTool === 'edit' && selectedElements.length === 1 && el.tagName === 'path') {
    drawControlPoints(el);
  } else {
    clearControlPoints();
  }
}

//--------------- Clear selection -----------------
function clearSelection() {
  selectedElements = [];
  selectedElement = null;

  clearSelectedAnchor();   // 👈 ADD THIS LINE

  selectionLayer.innerHTML = '';
  selectionLayer.removeAttribute('transform');
  updateInspector();
  clearControlPoints();
  updateLayersPanel();
}

//--------------- Duplicate selected path -----------------
function duplicateSelected() {
  if (!selectedElements.length) return;

  snapshotHistory(); // 🔥 push state BEFORE delete

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
  updateLayersPanel();
  updateInspector();
}

//--------------- Delete selected path -----------------
function deleteSelected() {
  if (!selectedElements.length) return;

  snapshotHistory(); // 🔥 push state BEFORE delete

  selectedElements.forEach(el => {
    if (el.parentNode === contentLayer) {
      el.remove();
    }
  });

  clearSelection();
  updateLayersPanel();
  updateInspector();
  clearControlPoints();
}

/* ----------------------------------------------------------------------------- */
/* ------------------------------- Arrange logic ------------------------------- */
/* ----------------------------------------------------------------------------- */
function bringToFront() {
  const ordered = getSelectedInDOMOrder();
  ordered.forEach(el => contentLayer.appendChild(el));

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

function sendToBack() {
  
  const ordered = getSelectedInDOMOrder();
  ordered.reverse().forEach(el =>
    contentLayer.insertBefore(el, contentLayer.firstChild)
  );
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

/* ----------------------------------------------------------------------------- */
/* ------------------------------ Inspector logic ------------------------------ */
/* ----------------------------------------------------------------------------- */
const inspectorEmpty = document.getElementById('inspectorEmpty');

const inspectorPath = document.getElementById('inspectorPath');

const strokeWidthInput = document.getElementById('strokeWidth');
const opacityInput = document.getElementById('opacity');

const strokePicker = document.getElementById("strokePicker");
const fillPicker = document.getElementById("fillPicker");

function hsvToRgb(h, s, v) {
  let c = v * s;
  let x = c * (1 - Math.abs((h / 60) % 2 - 1));
  let m = v - c;
  let r=0, g=0, b=0;

  if (h < 60) [r,g,b] = [c,x,0];
  else if (h < 120) [r,g,b] = [x,c,0];
  else if (h < 180) [r,g,b] = [0,c,x];
  else if (h < 240) [r,g,b] = [0,x,c];
  else if (h < 300) [r,g,b] = [x,0,c];
  else [r,g,b] = [c,0,x];

  return [
    Math.round((r+m)*255),
    Math.round((g+m)*255),
    Math.round((b+m)*255)
  ];
}

function rgbToHex(r,g,b) {
  return `#${[r,g,b].map(v => v.toString(16).padStart(2,'0')).join('')}`;
}

function drawSV(canvas, hue) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  // 1️⃣ Fill with pure hue
  ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
  ctx.fillRect(0, 0, w, h);

  // 2️⃣ White gradient (saturation)
  const whiteGrad = ctx.createLinearGradient(0, 0, w, 0);
  whiteGrad.addColorStop(0, "#fff");
  whiteGrad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = whiteGrad;
  ctx.fillRect(0, 0, w, h);

  // 3️⃣ Black gradient (value)
  const blackGrad = ctx.createLinearGradient(0, 0, 0, h);
  blackGrad.addColorStop(0, "rgba(0,0,0,0)");
  blackGrad.addColorStop(1, "#000");
  ctx.fillStyle = blackGrad;
  ctx.fillRect(0, 0, w, h);
}

function attachPicker(canvas, hueInput, attr) {
  let hue = 0;

  drawSV(canvas, hue);

  hueInput.addEventListener("input", () => {
    hue = Number(hueInput.value);
    drawSV(canvas, hue);
  });

  canvas.addEventListener("pointerdown", e => {
    if (!selectedElement) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const s = x / canvas.width;
    const v = 1 - y / canvas.height;

    const [r,g,b] = hsvToRgb(hue, s, v);
    const hex = rgbToHex(r,g,b);

    selectedElement.setAttribute(attr, hex);
    updateInspector();
  });
}

attachPicker(
  document.getElementById("strokeSV"),
  document.getElementById("strokeHue"),
  "stroke"
);

attachPicker(
  document.getElementById("fillSV"),
  document.getElementById("fillHue"),
  "fill"
);

function updateInspector() {
  // Nothing selected
  if (!selectedElement) {
    inspectorEmpty.style.display = 'block';
    inspectorPath.classList.add('hidden');
    return;
  }

  // Path selected
  if (selectedElement.tagName === 'path') {
    inspectorEmpty.style.display = 'none';
    inspectorPath.classList.remove('hidden');

    strokeWidthInput.value = selectedElement.getAttribute("stroke-width") || 1;
    opacityInput.value = selectedElement.getAttribute('opacity') || 1;
  }
}

// Path properties
strokeWidthInput.addEventListener('input', () => {
  if (!selectedElement) return;

  snapshotHistory(); // 🔥 push state BEFORE delete

  selectedElement.setAttribute('stroke-width', strokeWidthInput.value);
});

opacityInput.addEventListener('input', () => {
  if (!selectedElement) return;

  snapshotHistory(); // 🔥 push state BEFORE delete

  selectedElement.setAttribute('opacity', opacityInput.value);
});

/* ----------------------------------------------------------------------------- */
/* ------------------------- Convert object to symbol -------------------------- */
/* ----------------------------------------------------------------------------- */
function convertToSymbol(elements) {
  if (!elements || !elements.length) return;

  snapshotHistory(); // 🔥 push state BEFORE delete

  elements.forEach(el => {
    // ✅ Mark as symbol
    el.dataset.symbol = 'true';

    // ✅ Make it non-editable until double-click or 'E'
    el.dataset.locked = 'true';
    
    // ✅ Append to main content layer
    contentLayer.appendChild(el);
  });

  // Clear temp array
  newElements = [];
  
  // Update layer panel for these now-symbol elements
  updateLayersPanel();
}

/* ----------------------------------------------------------------------------- */
/* ---------------------------- Layer panel logic ------------------------------ */
/* ----------------------------------------------------------------------------- */
function updateLayersPanel() {
  const list = document.getElementById('layersList');
  if (!list) return;

  list.innerHTML = '';

  // Topmost layer shown at top → reverse DOM order
  const layers = [...contentLayer.children].reverse();

  layers.forEach(el => {
    if (!el.__isLayer) return; // ← skip anything not marked as a layer
    
    const item = document.createElement('div');
    item.className = 'layer-item';

    if (selectedElements.includes(el)) {
      item.classList.add('selected');
    }

    if (isLayerLocked(el)) {
      item.classList.add('locked');
    }

    const row = document.createElement('div');
    row.className = 'layer-row';

    /* -------- Name -------- */
    const name = document.createElement('span');
    name.className = 'layer-name';   // ← added class

    let layerName = el.getAttribute('data-layer-name');
    if (!layerName) {
      layerName = getNextLayerName(el);
      el.setAttribute('data-layer-name', layerName);
    }

    name.textContent = layerName;
    row.appendChild(name);

    name.onclick = e => {
      if (isRenamingLayer) return;
      e.stopPropagation();
      item.click(); // forward to parent selection
    };

    /* -------- Eye (visibility) -------- */
    const eye = document.createElement('span');
    eye.className = 'layer-eye';
    eye.textContent = isLayerVisible(el) ? '👁' : '🚫';

    if (!isLayerVisible(el)) {
      eye.classList.add('hidden');
    }

    eye.onclick = e => {
      e.stopPropagation();
      setLayerVisible(el, !isLayerVisible(el));
      updateLayersPanel();
    };

    /* -------- Lock -------- */
    const lock = document.createElement('span');
    lock.className = 'layer-lock';
    lock.textContent = isLayerLocked(el) ? '🔒' : '🔓';

    if (isLayerLocked(el)) {
      lock.classList.add('locked');
    }

    lock.onclick = e => {
      e.stopPropagation();
      setLayerLocked(el, !isLayerLocked(el));
      updateLayersPanel();
    };

    row.appendChild(eye);
    row.appendChild(lock);
    item.appendChild(row);

    item.onclick = e => {
      if (isRenamingLayer) return;
      if (isLayerLocked(el)) return;

      selectElement(el);
      updateLayersPanel();
    };

    list.appendChild(item);

    /* -------- Rename on double click (name only) -------- */
    name.ondblclick = e => {
      e.stopPropagation();
      if (isLayerLocked(el)) return;

      isRenamingLayer = true;

      name.contentEditable = 'true';
      name.classList.add('editing');
      name.focus();

      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(name);
      sel.addRange(range);
    };

    name.onkeydown = e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        name.blur();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        name.textContent =
          el.getAttribute('data-layer-name') || el.tagName.toUpperCase();
        name.blur();
      }
    };

    name.onblur = () => {
      name.contentEditable = 'false';
      name.classList.remove('editing');

      const newName = name.textContent.trim();
      if (newName) {
        el.setAttribute('data-layer-name', newName);
      }

      isRenamingLayer = false;
      updateLayersPanel(); // refresh AFTER rename
    };
  });
}

//--------------- On new drawing increase the object name bunber -------------
function getNextLayerName(el) {
  const type = el.tagName.toUpperCase();

  let max = 0;

  [...contentLayer.children].forEach(node => {
    if (node === el) return;

    const name = node.getAttribute('data-layer-name');
    if (!name) return;

    const m = name.match(new RegExp(`^${type} (\\d+)$`));
    if (m) {
      max = Math.max(max, parseInt(m[1], 10));
    }
  });

  return `${type} ${max + 1}`;
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

function getAnchorsFromPath(path) {
  const d = path.getAttribute('d');
  if (!d) return [];

  const anchors = [];

  // Match M, L, and Q commands
  const commands = d.match(/[MLQ][^MLQ]*/g) || [];

  commands.forEach(cmd => {
    const type = cmd[0];
    const nums = cmd
      .slice(1)
      .trim()
      .split(/[ ,]+/)
      .map(Number);

    if (type === 'M' || type === 'L') {
      anchors.push({ x: nums[0], y: nums[1] });
    }

    if (type === 'Q') {
      // Q cx cy x y → anchor is END POINT
      anchors.push({ x: nums[2], y: nums[3] });
    }
  });

  return anchors;
}

function getQuadraticHandlesFromPath(path) {
  const d = path.getAttribute('d');
  if (!d) return [];

  const handles = [];
  const commands = d.match(/[MLQ][^MLQ]*/g) || [];

  commands.forEach(cmd => {
    if (cmd[0] !== 'Q') return;

    const nums = cmd
      .slice(1)
      .trim()
      .split(/[ ,]+/)
      .map(Number);

    // Q cx cy x y
    handles.push({
      cx: nums[0],
      cy: nums[1],
      x: nums[2],
      y: nums[3]
    });
  });

  return handles;
}

function rebuildPathFromPoints(path) {
  const pts = path.__points;
  if (!pts || !pts.length) return;

  let d = '';

  pts.forEach((p, i) => {
    if (p.type === 'M') {
      d += `M ${p.x} ${p.y}`;
    }
    if (p.type === 'L') {
      d += ` L ${p.x} ${p.y}`;
    }
    if (p.type === 'Q') {
      d += ` Q ${p.cx} ${p.cy} ${p.x} ${p.y}`;
    }
  });

  path.setAttribute('d', d);
}

function deleteAnchorAtIndex(path, index) {
  const pts = path.__points;
  if (!pts || pts.length <= 0) return;

  snapshotHistory(); // 🔥 push state BEFORE delete

  // ❌ If only 2 anchors left, delete the whole path
  if (pts.length === 2) {
    path.remove(); // remove from DOM

    clearSelectedAnchor();
    clearControlPoints();

    selectedElement = null;
    selectedElements = [];

    updateLayersPanel();
    updateInspector();
    return;
  }

  // ❌ Prevent deleting the first move command
  if (index === 0 && pts[0].type === 'M') {
    console.warn('Cannot delete initial M point');
    return;
  }

  // Remove the anchor
  pts.splice(index, 1);

  // 🔁 Ensure first command is still M
  if (pts[0].type !== 'M') {
    pts[0].type = 'M';
  }

  rebuildPathFromPoints(path);

  // Reset selection
  clearSelectedAnchor();
  clearControlPoints();
  drawControlPoints(path);
}

function addAnchorToPath(path, x, y) {
  const pts = path.__points;
  if (!pts || pts.length < 2) return;

  snapshotHistory(); // 🔥 push state BEFORE delete

  let best = { index: -1, dist: Infinity, x: 0, y: 0 };

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;

    let hit;

    if (b.type === 'Q') {
      // approximate curve with straight segments (fast + good enough)
      hit = distancePointToQuadratic(x, y, a.x, a.y, b.cx, b.cy, b.x, b.y);
    } else {
      hit = distancePointToSegment(x, y, a.x, a.y, b.x, b.y);
    }

    if (hit.dist < best.dist) {
      best = { index: i + 1, dist: hit.dist, x: hit.x, y: hit.y };
    }
  }

  if (best.dist > 10 / camScale) return;

  const prev = pts[best.index - 1];
  const next = pts[best.index];
  if (!prev || !next) return;

  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const len = Math.hypot(dx, dy) || 1;

  const dirX = dx / len;
  const dirY = dy / len;

  const handleLength = len * 0.25;

  const newPoint = {
    type: 'Q',
    cx: best.x - dirX * handleLength,
    cy: best.y - dirY * handleLength,
    x: best.x,
    y: best.y
  };

  pts.splice(best.index, 0, newPoint);

  // 🔥 ALWAYS update next segment
  const nextPoint = pts[best.index + 1];
  if (nextPoint) {
    nextPoint.type = 'Q';
    nextPoint.cx = best.x + dirX * handleLength;
    nextPoint.cy = best.y + dirY * handleLength;
  }

  rebuildPathFromPoints(path);
  clearControlPoints();
  drawControlPoints(path);
}

//--------------- Draw control points ----------------- //
function drawControlPoints(path) {
  // ✅ Build editable point model ONLY ONCE
  if (!path.__points) {
    path.__points = [];

    const d = path.getAttribute('d');
    const commands = d.match(/[MLQ][^MLQ]*/g) || [];

    commands.forEach(cmd => {
      const type = cmd[0];
      const nums = cmd
        .slice(1)
        .trim()
        .split(/[ ,]+/)
        .map(Number);

      if (type === 'M' || type === 'L') {
        path.__points.push({ type, x: nums[0], y: nums[1] });
      }

      if (type === 'Q') {
        path.__points.push({
          type,
          cx: nums[0],
          cy: nums[1],
          x: nums[2],
          y: nums[3]
        });
      }
    });
  }

  const qPointIndices = path.__points
    .map((p, i) => (p.type === 'Q' ? i : null))
    .filter(i => i !== null);

  editLayer.innerHTML = '';

  const anchors = getAnchorsFromPath(path);
  const t = getTranslate(path);

  anchors.forEach((pt, index) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', pt.x + t.x);
    c.setAttribute('cy', pt.y + t.y);
    c.setAttribute('r', 4);
    c.classList.add('control-point');

    if (path === selectedAnchorPath && index === selectedAnchorIndex) {
      c.style.fill = '#007aff';
    }

    c.dataset.index = index;
    c.__path = path;

    c.addEventListener('pointerdown', e => {
      e.stopPropagation();
      const idx = Number(c.dataset.index);

      // 🗑 DELETE
      if (activeTool === 'delete-anchor') {
        snapshotHistory();
        deleteAnchorAtIndex(path, idx);
        return;
      }

      // 🔗 JOIN
      if (activeTool === 'join-anchor') {
        snapAnchorsIfClose(selectedAnchorPath, selectedAnchorIndex);
        return;
      }

      // ✏️ EDIT
      if (activeTool !== 'edit') return;

      selectedAnchorPath = path;
      selectedAnchorIndex = idx;
      activeControlPoint = c;

      // ✅ SNAPSHOT BEFORE DRAG
      snapshotHistory();
      console.log('SNAPSHOT', selectedAnchorPath);

      draggingAnchor = idx;
      draggingPath = path;
      activeAnchorIndex = idx;

      const ptData = path.__points[idx];
      c.__start = {
        x: ptData.x,
        y: ptData.y,
        mouseX: e.clientX,
        mouseY: e.clientY
      };

      svg.setPointerCapture(e.pointerId);
    });

    editLayer.appendChild(c);
  });

  // ---- Quadratic Bezier handles ----
  const handles = getQuadraticHandlesFromPath(path);

  handles.forEach((handle, qIndex) => {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', handle.x + t.x);
    line.setAttribute('y1', handle.y + t.y);
    line.setAttribute('x2', handle.cx + t.x);
    line.setAttribute('y2', handle.cy + t.y);
    line.classList.add('bezier-handle-line');
    editLayer.appendChild(line);

    const point = document.createElementNS(NS, 'circle');
    point.setAttribute('cx', handle.cx + t.x);
    point.setAttribute('cy', handle.cy + t.y);
    point.setAttribute('r', 4);
    point.classList.add('bezier-handle');

    point.__handleTarget = handle;
    point.__pathTarget = path;
    point.__pointIndex = qPointIndices[qIndex];

    enableBezierHandleDrag(point);
    editLayer.appendChild(point);
  });
}

function clearControlPoints() {
  editLayer.innerHTML = '';
}


//--------------- Draw selection boxes -----------------
function drawSelectionBoxes() {
  selectionLayer.innerHTML = '';

  selectedElements.forEach(el => {
    const bbox = el.getBBox();
    const t = getTranslate(el);

    const g = document.createElementNS(NS, 'g');
    g.setAttribute('transform', `translate(${t.x}, ${t.y})`);

    // Main selection rectangle
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', bbox.x);
    rect.setAttribute('y', bbox.y);
    rect.setAttribute('width', bbox.width);
    rect.setAttribute('height', bbox.height);
    rect.setAttribute('class', 'selection-rect');
    g.appendChild(rect);

    // Eight handles (corners + midpoints)
    const handleSize = 8;
    const positions = [
      [bbox.x, bbox.y], // top-left
      [bbox.x + bbox.width/2, bbox.y], // top-center
      [bbox.x + bbox.width, bbox.y], // top-right
      [bbox.x + bbox.width, bbox.y + bbox.height/2], // middle-right
      [bbox.x + bbox.width, bbox.y + bbox.height], // bottom-right
      [bbox.x + bbox.width/2, bbox.y + bbox.height], // bottom-center
      [bbox.x, bbox.y + bbox.height], // bottom-left
      [bbox.x, bbox.y + bbox.height/2] // middle-left
    ];

    positions.forEach(([x, y]) => {
      const handle = document.createElementNS(NS, 'rect');
      handle.setAttribute('x', x - handleSize/2);
      handle.setAttribute('y', y - handleSize/2);
      handle.setAttribute('width', handleSize);
      handle.setAttribute('height', handleSize);
      handle.setAttribute('class', 'handle-rect');
      g.appendChild(handle);
    });

    selectionLayer.appendChild(g);
  });
}

/*------------ Start drag ---------------*/
function handleTransformMove(e) {
  if (!isDragging || !selectedElements.length || selectedElements.some(isLayerLocked)) return;

  const pt = getSVGPoint(e);
  const dx = pt.x - dragStart.x;
  const dy = pt.y - dragStart.y;

  selectedElements.forEach(el => {
    const start = startTransforms.get(el) || { x: 0, y: 0 };
    el.setAttribute('transform', `translate(${start.x + dx}, ${start.y + dy})`);
    snapshotHistory(); // 🔥 push state BEFORE delete
  });

  drawSelectionBoxes();
}

function handleDrawMove(e) {
  if (!drawing || !activeFreehandPath) return;

  const pt = getSVGPoint(e);

  const last = freehandPoints[freehandPoints.length - 1];
  const dx = pt.x - last.x;
  const dy = pt.y - last.y;

  // 🔑 distance threshold (Boxy feel)
  if (dx * dx + dy * dy < MIN_DRAW_DISTANCE * MIN_DRAW_DISTANCE) return;

  freehandPoints.push({ x: pt.x, y: pt.y });

  activeFreehandPath.setAttribute(
    'd',
    buildSmoothPath(freehandPoints)
  );
}

function enableBezierHandleDrag(handleEl) {
  handleEl.addEventListener('pointerdown', e => {
    if (activeTool !== 'edit') return;

    e.stopPropagation();

    const path = handleEl.__pathTarget;

    handleEl.__start = {
      cx: handleEl.__handleTarget.cx,
      cy: handleEl.__handleTarget.cy,
      mouseX: e.clientX,
      mouseY: e.clientY
    };

    draggingAnchor = 'bezier';
    console.log('DOWN', draggingAnchor);
    draggingPath = path;

    activeHandle = {
      path,
      pointIndex: handleEl.__pointIndex,
      __start: handleEl.__start
    };

    handleEl.setPointerCapture(e.pointerId);
  });
}

function updateQuadraticPath(path) {
  const anchors = getAnchorsFromPath(path);
  const handles = getQuadraticHandlesFromPath(path);

  let d = `M ${anchors[0].x} ${anchors[0].y}`;

  for (let i = 0; i < handles.length; i++) {
    const h = handles[i];
    d += ` Q ${h.cx} ${h.cy} ${h.x} ${h.y}`;
  }

  path.setAttribute('d', d);
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

window.addEventListener('mouseup', () => {
  // 🔥 STOP CAMERA PAN
  if (panning) {
    panning = false;
    panStart = null;
    camStart = null;
  }

  isDragging = false;
  dragStart = null;
  dragOrigin = null;
  activeHandle = null;
  marqueeStart = null;

  // 🟡 JOIN‑ANCHOR SNAP CHECK
  if (activeTool === "join-anchor" && draggingPath && selectedAnchorPath) {
    const pts = selectedAnchorPath.__points;
    const first = pts[0];
    const last = pts[pts.length - 1];

    // small snap threshold (in world coords)
    const threshold = 8 / camScale;

    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= threshold) {
      // snap last to first (or vice‑versa)
      if (selectedAnchorIndex === 0) {
        first.x = last.x;
        first.y = last.y;
      } else {
        last.x = first.x;
        last.y = first.y;
      }

      // rebuild path visually
      rebuildPathFromPoints(selectedAnchorPath);
    }

    // clear join state
    selectedAnchorPath = null;
    selectedAnchorIndex = null;
    draggingPath = null;
    draggingAnchor = null;
    activeControlPoint = null;
    clearControlPoints(); // rebuild edit markers if needed
  }

  if (rectDrawing) {
    rectDrawing = false;
    rectStart = null;
    currentRect = null;
  }

  if (drawing) {
    drawing = false;

    if (activeFreehandPath) {
      activeFreehandPath.setAttribute('d', simplifyPath(activeFreehandPath.getAttribute('d')));
      snapshotHistory(); // 🔥 push state BEFORE delete
    }

    activeFreehandPath = null;
    freehandPoints = [];
  }

  if (marqueeActive) {
    selectByMarquee();
    endMarquee();
  }

  // 🔗 JOIN‑ANCHOR SNAP CHECK
  if (activeTool === "join-anchor" && draggingPath && selectedAnchorPath) {
    const pts = selectedAnchorPath.__points;
    if (pts && pts.length >= 2) {
      const first = pts[0];
      const last = pts[pts.length - 1];

      // world‑space threshold (so zoom doesn’t break it)
      const threshold = 10 / camScale;

      const dist = Math.hypot(last.x - first.x, last.y - first.y);

      if (dist <= threshold) {
        // if dragging first anchor
        if (selectedAnchorIndex === 0) {
          first.x = last.x;
          first.y = last.y;
        } else {
          // dragging last anchor
          last.x = first.x;
          last.y = first.y;
        }

        // redraw path
        rebuildPathFromPoints(selectedAnchorPath);
      }
    }

    // clear join state
    selectedAnchorPath = null;
    selectedAnchorIndex = null;
    draggingPath = null;
    draggingAnchor = null;
    activeControlPoint = null;

    clearControlPoints(); // optional: shows updated anchors
  }
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

  // Undo (Ctrl+Z)
  if (e.ctrlKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  }

  // Redo (Ctrl+Shift+Z or Ctrl+Y)
  if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
    e.preventDefault();
    redo();
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

/* ----------------------------------------------------------------------------- */
/* -------------------------- Options panel pop-out ---------------------------- */
/* ----------------------------------------------------------------------------- */
const optionsPanel = document.getElementById('optionsPanel');
const optionsPopout = document.getElementById('optionsPopout');

optionsPopout.addEventListener('click', () => {
  optionsPanel.classList.toggle('collapsed');

  optionsPopout.textContent =
    optionsPanel.classList.contains('collapsed') ? '❮' : '❯';
});

updateInspector();

function buildSmoothPath(pts) {
  if (pts.length < 2) return '';

  let d = `M ${pts[0].x} ${pts[0].y}`;

  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];

    const cx = (p0.x + p1.x) / 2;
    const cy = (p0.y + p1.y) / 2;

    d += ` Q ${p0.x} ${p0.y} ${cx} ${cy}`;
  }

  return d;
}

function simplifyPath(d) {
  return d; // Phase-2 later
}

/* ----------------------------------------------------------------------------- */
/* ---------------------------- Animation timeline ----------------------------- */
/* ----------------------------------------------------------------------------- */

// ---- Timeline references ----
const timelineRuler = document.getElementById('timelineRuler');
const timelineLayers = document.getElementById('timelineLayers');
const timelineFrames = document.getElementById('timelineFrames');

// ---- Config ----
const totalFrames = 45;    // total number of frames
const frameWidth = 20;      // width of each frame-cell in px
const highlightStep = 5;    // highlight every 5 frames (like ruler)

// ---- 1. Create Layer 1 ----
const layerDiv = document.createElement('div');
layerDiv.className = 'timeline-layer';
layerDiv.textContent = 'Layer 1';
timelineLayers.appendChild(layerDiv);

// ---- 2. Create first row of frames with highlights ----
const frameRow = document.createElement('div');
frameRow.className = 'frame-row';

for (let i = 1; i <= totalFrames; i++) {
  const frameCell = document.createElement('div');
  frameCell.className = 'frame-cell';
  frameCell.style.width = frameWidth + 'px';

  // Highlight every highlightStep, but skip frame 1
  if (i !== 1 && i % highlightStep === 0) {
    frameCell.style.backgroundColor = '#777'; // highlight color
  } else {
    frameCell.style.backgroundColor = '#525151'; // normal color
  }

  // ---- Only add inner row div to the first frame ----
  if (i === 1) {
    const frameContentRow = document.createElement('div');
    frameContentRow.className = 'frame-content-row';
    frameContentRow.style.width = '100%';
    frameContentRow.style.height = '100%';
    frameContentRow.style.position = 'relative';
    frameCell.appendChild(frameContentRow);
  }

  frameRow.appendChild(frameCell);
}

timelineFrames.appendChild(frameRow);

// ---- 3. Create sparse frame ruler (numbers every highlightStep) ----
timelineRuler.style.display = 'flex';

for (let i = 1; i <= totalFrames; i++) {
  const tick = document.createElement('div');
  tick.className = 'frame-ruler-tick';
  tick.style.width = frameWidth + 'px';
  tick.style.display = 'flex';
  tick.style.alignItems = 'center';
  tick.style.justifyContent = 'center';
  tick.style.borderRight = '1px solid #444';
  tick.style.color = '#ddd';
  tick.style.fontSize = '10px';

  // Show number at multiples of highlightStep (like 1, 5, 10, 15…)
  tick.textContent = (i === 1 || i % highlightStep === 0) ? i : '';

  timelineRuler.appendChild(tick);
}


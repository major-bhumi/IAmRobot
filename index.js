/* ----------------------------------------------------------------------------- */
/* --------------------------------- Variables --------------------------------- */
/* ----------------------------------------------------------------------------- */
const svg = document.getElementById('svgCanvas');
const contextMenu = document.getElementById('contextMenu');

const NS = 'http://www.w3.org/2000/svg';

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

let ignoreDeselect = false;

let isHandleDragging = false;
let handleDrag = null; // stores drag state

// Object rotation
let isRotateDragging = false;
let rotateDrag = null;

// -------------------- DOC HISTORY --------------------
let nextUID = 1;

function ensureUID(el) {
  if (!el || el.nodeType !== 1) return null;
  if (!el.dataset.uid) el.dataset.uid = String(nextUID++);
  return el.dataset.uid;
}

function ensureUIDsInContent() {
  contentLayer.querySelectorAll('g[data-tl] > *').forEach(ensureUID);
}

function snapshotDocHistory() {
  redoStack = [];

  ensureUIDsInContent();

  undoStack.push({
    type: 'doc',
    html: contentLayer.innerHTML,
    selectedIds: selectedElements.map(el => el?.dataset?.uid).filter(Boolean),
    activeId: selectedElement?.dataset?.uid || null
  });

  if (undoStack.length > MAX_HISTORY) undoStack.shift();
}

function restoreDocState(entry) {
  contentLayer.innerHTML = entry.html;

  // rebuild selection
  selectedElements = (entry.selectedIds || [])
    .map(id => contentLayer.querySelector(`[data-uid="${id}"]`))
    .filter(Boolean);

  selectedElement = entry.activeId
    ? contentLayer.querySelector(`[data-uid="${entry.activeId}"]`)
    : (selectedElements[selectedElements.length - 1] || null);

  clearSelectedAnchor();
  updateLayersPanel();
  updateInspector();
  refreshAfterHistory();

   // ✅ prevent UID collisions after restoring HTML
  const ids = [...contentLayer.querySelectorAll('[data-uid]')]
    .map(n => parseInt(n.dataset.uid, 10))
    .filter(n => Number.isFinite(n));

  nextUID = (ids.length ? Math.max(...ids) : 0) + 1;

  // ✅ re-apply non-scaling stroke after restoring HTML
  contentLayer.querySelectorAll('g[data-tl] > *').forEach(applyNonScalingStroke);
}

// Helper: mark as layer using dataset so it survives doc restore
function setIsLayer(el, v) {
  el.__isLayer = !!v;
  el.dataset.isLayer = v ? 'true' : 'false';
}

/* ----------------------------------------------------------------------------- */
/* --------------------------------- Library Panel ----------------------------- */
/* ----------------------------------------------------------------------------- */
// -------------------- LIBRARY (Flash-style) --------------------
let nextAssetId = 1;
const libraryAssets = new Map(); // assetId -> { name, href, w, h }
let selectedLibraryAssetId = null;
let libraryHasFocus = false;

function newAssetId() {
  return `asset_${nextAssetId++}`;
}

function setLibrarySelection(assetId) {
  selectedLibraryAssetId = assetId;
  libraryHasFocus = true;
  updateLayersPanel();      // keep your highlight behavior
  updateLibraryPreview();   // ✅ add this
}

/* ----------------------------------------------------------------------------- */
/* -------------------------------- Library preview ---------------------------- */
/* ----------------------------------------------------------------------------- */
const previewImg = document.getElementById('libraryPreviewImg');
const previewSvg = document.getElementById('libraryPreviewSvg');
const previewLabel = document.getElementById('libraryPreviewLabel');

function clearLibraryPreview() {
  previewImg.src = "";
  previewImg.style.display = "none";

  while (previewSvg.firstChild) previewSvg.removeChild(previewSvg.firstChild);
  previewSvg.style.display = "none";
  previewSvg.removeAttribute("viewBox");

  previewLabel.textContent = "No asset selected";
}

function updateLibraryPreview() {
  // guard: if preview DOM missing, do nothing (prevents crashes)
  if (!previewImg || !previewSvg || !previewLabel) return;

  const id = selectedLibraryAssetId;
  if (!id || !libraryAssets.has(id)) {
    clearLibraryPreview();
    return;
  }

  const asset = libraryAssets.get(id);

  // Your assets look like { name, href, w, h } right now:
  const href = asset.href;      // ✅ use this instead of asset.src
  const name = asset.name || "Untitled";

  previewLabel.textContent = name;

  // Image preview
  previewSvg.style.display = "none";
  while (previewSvg.firstChild) previewSvg.removeChild(previewSvg.firstChild);

  previewImg.style.display = "block";
  previewImg.src = href || "";
}

function selectLibraryAsset(id) {
  selectedLibraryAssetId = id;
  libraryHasFocus = true; // keep your current behavior
  updateLibraryUISelection(); // whatever you already do
  updateLibraryPreview();
}

function deleteLibraryAsset(assetId) {
  // ...your existing "delete all instances" logic...

  libraryAssets.delete(assetId);

  if (selectedLibraryAssetId === assetId) {
    selectedLibraryAssetId = null;
    updateLibraryPreview();
  }

  renderLibraryList(); // whatever you use
}

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
/* ---------------------- Library asset right-click menu ------------------------ */
/* ----------------------------------------------------------------------------- */

let libMenuEl = null;
let libMenuAssetId = null;

function ensureLibMenu() {
  if (libMenuEl) return libMenuEl;

  libMenuEl = document.createElement('div');
  libMenuEl.id = 'libraryContextMenu';
  libMenuEl.style.position = 'fixed';
  libMenuEl.style.zIndex = '999999';
  libMenuEl.style.minWidth = '160px';
  libMenuEl.style.padding = '6px';
  libMenuEl.style.borderRadius = '8px';
  libMenuEl.style.border = '1px solid rgba(255,255,255,0.12)';
  libMenuEl.style.background = 'rgba(20,20,20,0.95)';
  libMenuEl.style.backdropFilter = 'blur(6px)';
  libMenuEl.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
  libMenuEl.style.display = 'none';

  libMenuEl.innerHTML = `
    <div class="libctx-item" data-act="rename" style="padding:8px 10px;border-radius:6px;cursor:pointer;color:white;">Rename</div>
    <div class="libctx-item" data-act="delete" style="padding:8px 10px;border-radius:6px;cursor:pointer;color:#ff6b6b;color:white;">Delete</div>
  `;

  // hover effect (no CSS needed)
  libMenuEl.addEventListener('mouseover', (e) => {
    const it = e.target.closest('.libctx-item');
    if (it) it.style.background = 'rgba(255,255,255,0.08)';
  });
  libMenuEl.addEventListener('mouseout', (e) => {
    const it = e.target.closest('.libctx-item');
    if (it) it.style.background = 'transparent';
  });

  libMenuEl.addEventListener('mousedown', (e) => {
    // prevent menu click from closing immediately via document handler
    e.stopPropagation();
  });

  libMenuEl.addEventListener('click', (e) => {
    const item = e.target.closest('.libctx-item');
    if (!item) return;

    const act = item.dataset.act;
    const assetId = libMenuAssetId;

    hideLibMenu();

    if (!assetId) return;

    if (act === 'rename') {
      beginLibraryInlineRename(assetId);
    }

    if (act === 'delete') {
      deleteLibraryAsset(assetId);
      updateLibraryPreview?.();
    }
  });

  document.body.appendChild(libMenuEl);

  // close on outside click / escape / scroll / resize
  document.addEventListener('mousedown', () => hideLibMenu());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideLibMenu(); }, true);
  window.addEventListener('scroll', hideLibMenu, true);
  window.addEventListener('resize', hideLibMenu);

  return libMenuEl;
}

function showLibMenu(x, y, assetId) {
  const m = ensureLibMenu();
  libMenuAssetId = assetId;

  m.style.display = 'block';

  // keep inside viewport
  const pad = 6;
  const rect = m.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - pad;
  const maxY = window.innerHeight - rect.height - pad;

  m.style.left = Math.max(pad, Math.min(x, maxX)) + 'px';
  m.style.top  = Math.max(pad, Math.min(y, maxY)) + 'px';
}

function hideLibMenu() {
  if (!libMenuEl) return;
  libMenuEl.style.display = 'none';
  libMenuAssetId = null;
}

/** Reuse your existing double-click rename behavior */
function beginLibraryInlineRename(assetId) {
  if (!assetId || !libraryAssets.has(assetId)) return;

  // find the name span for this asset
  const nameEl = document.querySelector(`.layer-name[data-asset-id="${assetId}"]`);
  if (!nameEl) return;

  const asset = libraryAssets.get(assetId);

  // same behavior you already do on dblclick
  isRenamingLayer = true;

  nameEl.textContent = asset.name || '';
  nameEl.contentEditable = 'true';
  nameEl.classList.add('editing');
  nameEl.focus();

  const sel = window.getSelection();
  sel.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(nameEl);
  sel.addRange(range);
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
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function deleteLibraryAsset(assetId) {
  if (!assetId || !libraryAssets.has(assetId)) return;

  snapshotDocHistory();

  // remove all instances on stage
  contentLayer
    .querySelectorAll(`g[data-tl] > image[data-asset-id="${assetId}"]`)
    .forEach(n => n.remove());

  libraryAssets.delete(assetId);

  if (selectedLibraryAssetId === assetId) selectedLibraryAssetId = null;

  clearSelection();
  updateLayersPanel();
}

async function pickImageFile() {
  // ✅ modern picker
  if (window.showOpenFilePicker) {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{
        description: 'Images',
        accept: {
          'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']
        }
      }]
    });
    const file = await handle.getFile();
    return file;
  }

  // ✅ fallback
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });
}

async function importImageToStage() {
  try {
    const file = await pickImageFile();
    if (!file) return;

    snapshotDocHistory();

    // ✅ always add into CURRENT selected timeline layer group
    // if only 1 layer exists, this still works
    const g = getActiveLayerGroup();

    const dataUrl = await fileToDataURL(file);

    // load to get natural size
    const img = new Image();
    img.src = dataUrl;
    await new Promise((res, rej) => {
      img.onload = () => res();
      img.onerror = rej;
    });

    const naturalW = img.naturalWidth || 200;
    const naturalH = img.naturalHeight || 200;

    // fit into stage (optional but feels nice)
    const maxW = stage.width * 0.6;
    const maxH = stage.height * 0.6;
    const scale = Math.min(1, maxW / naturalW, maxH / naturalH);

    const w = Math.round(naturalW * scale);
    const h = Math.round(naturalH * scale);

    // place centered on stage
    const x = stage.x;
    const y = stage.y;

    const imageEl = document.createElementNS(NS, 'image');
    ensureUID(imageEl);

    imageEl.setAttribute('data-layer-name', file.name);

    // ✅ make it appear in Library panel immediately
    setIsLayer(imageEl, true);
    imageEl.dataset.symbol = 'true';      // so selecting it refreshes the library highlight
    imageEl.dataset.locked = 'false';

    // use SVG2 href
    imageEl.setAttribute('href', dataUrl);
    imageEl.setAttribute('x', String(x));
    imageEl.setAttribute('y', String(y));
    imageEl.setAttribute('width', String(w));
    imageEl.setAttribute('height', String(h));

    // nice defaults
    imageEl.setAttribute('preserveAspectRatio', 'none');

    g.appendChild(imageEl);

    // select it (optional but expected)
    setActiveTool(transformTool, 'transform');
    selectElement(imageEl, false);

    updateLayersPanel(); // ✅ show in Library panel
    drawSelectionBoxes();
  } catch (err) {
    console.warn('Import image cancelled/failed:', err);
  }
}

function uiNonScaling(el) {
  if (!el) return;
  el.setAttribute('vector-effect', 'non-scaling-stroke');
}

function applyNonScalingStroke(el) {
  if (!el || el.nodeType !== 1) return;
  // only for shapes that actually have strokes
  const tag = (el.tagName || '').toLowerCase();
  if (!['path','rect','ellipse','line','polyline','polygon'].includes(tag)) return;

  el.setAttribute('vector-effect', 'non-scaling-stroke');
}

function ensurePointsModel(path, forceRebuild = false) {
  if (!path || path.tagName !== 'path') return null;

  // ✅ ellipse is not editable via __points, keep its arc data
  if (path.__shape === 'ellipse') return path.__points || null;

  // If already built and not forcing, keep it
  if (path.__points && !forceRebuild) return path.__points;

  const d = path.getAttribute('d') || '';
  path.__closed = /[zZ]\s*$/.test(d.trim());

  const commands = d.match(/[MLQC][^MLQC]*/g) || [];
  const pts = [];

  let cursorX = 0, cursorY = 0;

  commands.forEach(cmd => {
    const type = cmd[0];
    const nums = cmd
      .slice(1)
      .trim()
      .split(/[ ,]+/)
      .filter(Boolean)
      .map(Number);

    if (type === 'M') {
      cursorX = nums[0]; cursorY = nums[1];
      pts.push({ type: 'M', x: cursorX, y: cursorY });
    }

    // L -> C (straight line handles)
    else if (type === 'L') {
      const x = nums[0], y = nums[1];

      const c1x = cursorX + (x - cursorX) / 3;
      const c1y = cursorY + (y - cursorY) / 3;
      const c2x = cursorX + 2 * (x - cursorX) / 3;
      const c2y = cursorY + 2 * (y - cursorY) / 3;

      pts.push({ type: 'C', c1x, c1y, c2x, c2y, x, y });

      cursorX = x; cursorY = y;
    }

    // Q -> C (quadratic to cubic conversion)
    else if (type === 'Q') {
      const qcx = nums[0], qcy = nums[1];
      const x = nums[2], y = nums[3];

      // P0 = (cursorX, cursorY)
      // P1 = (qcx, qcy)
      // P2 = (x, y)
      //
      // C1 = P0 + 2/3*(P1 - P0)
      // C2 = P2 + 2/3*(P1 - P2)
      const c1x = cursorX + (2 / 3) * (qcx - cursorX);
      const c1y = cursorY + (2 / 3) * (qcy - cursorY);
      const c2x = x + (2 / 3) * (qcx - x);
      const c2y = y + (2 / 3) * (qcy - y);

      pts.push({ type: 'C', c1x, c1y, c2x, c2y, x, y });

      cursorX = x; cursorY = y;
    }

    else if (type === 'C') {
      pts.push({
        type: 'C',
        c1x: nums[0], c1y: nums[1],
        c2x: nums[2], c2y: nums[3],
        x: nums[4],  y: nums[5]
      });
      cursorX = nums[4]; cursorY = nums[5];
    }
  });

  // ✅ If path ends with Z, add an explicit closing cubic segment
  // so the "last segment" has real handles in edit mode.
  if (path.__closed && pts.length > 1) {
    var start = pts[0]; // M point
    var sx = start.x, sy = start.y;

    // cursorX/cursorY currently equals the last anchor after parsing commands
    var ex = cursorX, ey = cursorY;

    // If we are not already at the start, add a closing C segment
    if (Math.abs(ex - sx) > 0.0001 || Math.abs(ey - sy) > 0.0001) {
      var c1x = ex + (sx - ex) / 3;
      var c1y = ey + (sy - ey) / 3;
      var c2x = ex + 2 * (sx - ex) / 3;
      var c2y = ey + 2 * (sy - ey) / 3;

      pts.push({ type: 'C', c1x: c1x, c1y: c1y, c2x: c2x, c2y: c2y, x: sx, y: sy });

      // update cursor (not required, but keeps state consistent)
      cursorX = sx; cursorY = sy;
    }
  }

  path.__points = pts;
  return pts;
}

function getScreenPoint(evt) {
  return {x: evt.clientX, y: evt.clientY};
}

function isLayerVisible(el) {
  const g = el.closest('g[data-tl]');
  if (g && g.style.display === 'none') return false;   // ✅ timeline-layer hide
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
  const g = el.closest('g[data-tl]');
  if (g && g.dataset.tlLocked === 'true') return true; // ✅ timeline-layer lock
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

function startHandleDrag(e, handleEl) {
  if (!selectedElements.length) return;

  snapshotTransformHistory(selectedElements);

  isHandleDragging = true;

  const handleId = handleEl.dataset.handle; // nw,n,ne,e,se,s,sw,w

  // Use FIRST selected element's orientation as the box orientation
  // (Boxy does group boxes too; we’ll upgrade later)
  const ref = selectedElements[selectedElements.length - 1];

  const b = ref.getBBox();
  const M = getLocalDOMMatrix(ref);

  // corners in WORLD coords (after transform)
  const tl = new DOMPoint(b.x, b.y).matrixTransform(M);
  const tr = new DOMPoint(b.x + b.width, b.y).matrixTransform(M);
  const br = new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(M);
  const bl = new DOMPoint(b.x, b.y + b.height).matrixTransform(M);

  // local axes of the rotated box (WORLD unit vectors)
  const ux = tr.x - tl.x, uy = tr.y - tl.y;
  const vx = bl.x - tl.x, vy = bl.y - tl.y;

  const w = Math.hypot(ux, uy) || 1;
  const h = Math.hypot(vx, vy) || 1;

  const u = { x: ux / w, y: uy / w }; // top edge direction
  const v = { x: vx / h, y: vy / h }; // left edge direction

  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  // anchors (opposite handle)
  const anchors = {
    nw: br,
    n:  mid(bl, br),
    ne: bl,
    e:  mid(tl, bl),
    se: tl,
    s:  mid(tl, tr),
    sw: tr,
    w:  mid(tr, br)
  };

  const anchor = anchors[handleId];

  // store all element starting matrices (preserve existing scale/rot/translate)
  const starts = selectedElements.map(el => ({ el, m: getLocalDOMMatrix(el) }));

  // angle of u axis (for building rotate basis)
  const theta = Math.atan2(u.y, u.x); // radians

  handleDrag = {
    handleId,
    anchor,
    u,
    v,
    w,
    h,
    theta,
    starts,
    keepAspect: e.shiftKey
  };
}

function getOppositeAnchor(handleId, box) {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;

  const anchors = {
    nw: { x: box.maxX, y: box.maxY },
    n:  { x: cx,      y: box.maxY },
    ne: { x: box.minX, y: box.maxY },
    e:  { x: box.minX, y: cy },
    se: { x: box.minX, y: box.minY },
    s:  { x: cx,      y: box.minY },
    sw: { x: box.maxX, y: box.minY },
    w:  { x: box.maxX, y: cy }
  };
  return anchors[handleId];
}

/* -------------- timeline helper function -----------------*/
function resetTimeline() {
  // clear UI
  timelineLayers.innerHTML = '';
  timelineFrames.innerHTML = '';
  timelineRulerInner.innerHTML = '';

  // reset state
  timelineLayerCount = 0;
  activeTimelineLayerId = null;

  tlState.clear();

  // rebuild ruler (✅ put ticks inside timelineRulerInner)
  timelineRuler.style.display = 'flex';
  timelineRulerInner.innerHTML = '';

  for (let i = 1; i <= totalFrames; i++) {
    const tick = document.createElement('div');
    tick.className = 'frame-ruler-tick';
    tick.style.width = frameWidth + 'px';
    tick.textContent = (i === 1 || i % highlightStep === 0) ? i : '';
    timelineRulerInner.appendChild(tick);
  }

  // rebuild playhead
  // ✅ ensure there is ONLY one playhead in DOM
  const oldPH = document.getElementById('playhead');
  if (oldPH) oldPH.remove();

  // re-append the GLOBAL playhead overlay
  timelineFramesViewport.appendChild(playhead);

  // create first layer
  createTimelineLayer('Layer 1');

  updateTimelineScrollWidth();
  wireTimelineHorizontalScroll();
  updatePlayhead();
}

/* ----------------------------------------------------------------------------- */
/* ------------------------ Timeline keyframes + rendering ---------------------- */
/* ----------------------------------------------------------------------------- */

// layerId -> { keyframes: Map<number, string>, visible: bool, locked: bool }
const tlState = new Map();

// make sure a layer state exists
function ensureTimelineLayerState(layerId) {
  if (!tlState.has(layerId)) {
    tlState.set(layerId, {
      keyframes: new Map(),
      visible: true,
      locked: false
    });
  }
  return tlState.get(layerId);
}

// resolve which keyframe HTML to show for (layerId, frame)
function resolveLayerHTML(layerId, frame) {
  const st = ensureTimelineLayerState(layerId);
  for (let f = frame; f >= 1; f--) {
    if (st.keyframes.has(f)) return st.keyframes.get(f);
  }
  return ''; // nothing yet
}

// does this frame have a real keyframe?
function hasKeyframe(layerId, frame) {
  const st = ensureTimelineLayerState(layerId);
  return st.keyframes.has(frame);
}

// ensure a keyframe exists at (layerId, frame)
// mode: 'copy' copies from previous resolved frame; 'blank' makes empty
function ensureKeyframe(layerId, frame, mode = 'copy') {
  const st = ensureTimelineLayerState(layerId);
  if (st.keyframes.has(frame)) return;

  const html = (mode === 'blank') ? '' : resolveLayerHTML(layerId, frame - 1);
  st.keyframes.set(frame, html);

  updateKeyframeCellUI(layerId, frame);
  updateHoldsUI(layerId); // keep hold styling correct
}

// save current SVG group contents into keyframe at (layerId, frame) IF frame is a keyframe
function saveKeyframeFromStage(layerId, frame) {
  const st = ensureTimelineLayerState(layerId);
  if (!st.keyframes.has(frame)) return;

  const g = ensureTimelineSVGGroup(layerId);
  st.keyframes.set(frame, g.innerHTML);

  updateKeyframeCellUI(layerId, frame);
  updateHoldsUI(layerId);
}

// render one layer at a frame (applies hold automatically)
function renderLayerAtFrame(layerId, frame) {
  const st = ensureTimelineLayerState(layerId);
  const g = ensureTimelineSVGGroup(layerId);

  // visibility + lock affect pointer events
  g.style.display = st.visible ? '' : 'none';

  // apply resolved content
  const html = resolveLayerHTML(layerId, frame);
  g.innerHTML = html;

  // lock editing on non-active or locked layers
  const isActive = (layerId === activeTimelineLayerId);
  const canEdit = isActive && !st.locked && st.visible;
  g.style.pointerEvents = canEdit ? 'all' : 'none';
}

// render all layers
function renderFrame(frame) {
  // clear selection/control points when changing frames (safe + predictable)
  clearSelection();
  clearControlPoints();

  const layerEls = [...timelineLayers.querySelectorAll('.timeline-layer[data-layer-id]')];
  for (const el of layerEls) {
    renderLayerAtFrame(el.dataset.layerId, frame);
  }

  drawSelectionBoxes();
}

// save active layer keyframe (if it exists) before leaving frame
function saveActiveLayerIfKeyframed() {
  if (!activeTimelineLayerId) return;
  saveKeyframeFromStage(activeTimelineLayerId, currentFrame);
}

// the ONLY way you should change frames
function setCurrentFrame(frame) {
  const next = Math.max(1, Math.min(totalFrames, frame));
  if (next === currentFrame) return;

  // save current active layer edits if current frame is a keyframe
  saveActiveLayerIfKeyframed();

  currentFrame = next;
  updatePlayhead();
  renderFrame(currentFrame);
}

// call this BEFORE any edit/draw mutation happens
function timelineBeforeMutate(mode = 'copy') {
  if (!activeTimelineLayerId) return;

  // don't allow editing locked/hidden
  const st = ensureTimelineLayerState(activeTimelineLayerId);
  if (st.locked || !st.visible) return;

  // auto-create a keyframe at current frame so edits persist
  ensureKeyframe(activeTimelineLayerId, currentFrame, mode);

  // make sure stage is showing that frame's content
  renderLayerAtFrame(activeTimelineLayerId, currentFrame);
}

// call this AFTER an edit mutation completes (mouseup / commit)
function timelineAfterMutate() {
  if (!activeTimelineLayerId) return;
  saveKeyframeFromStage(activeTimelineLayerId, currentFrame);
}

/* ----------------------------- Timeline cell UI ----------------------------- */

function getFrameCell(layerId, frame) {
  const row = timelineFrames.querySelector(`.frame-row[data-layer-id="${layerId}"]`);
  if (!row) return null;
  const idx = frame - 1;
  return row.children[idx] || null;
}

// add/remove keyframe marker (dot) on a single cell
function updateKeyframeCellUI(layerId, frame) {
  const cell = getFrameCell(layerId, frame);
  if (!cell) return;

  cell.classList.toggle('is-keyframe', hasKeyframe(layerId, frame));

  // ensure we have a dot element
  let dot = cell.querySelector('.kf-dot');
  if (!dot) {
    dot = document.createElement('div');
    dot.className = 'kf-dot';
    cell.appendChild(dot);
  }
  dot.style.display = hasKeyframe(layerId, frame) ? 'block' : 'none';
}

// show holds (frames between keyframes)
function updateHoldsUI(layerId) {
  const st = ensureTimelineLayerState(layerId);

  // collect sorted keyframes
  const keys = [...st.keyframes.keys()].sort((a, b) => a - b);

  // clear holds first
  for (let f = 1; f <= totalFrames; f++) {
    const cell = getFrameCell(layerId, f);
    if (cell) cell.classList.remove('is-hold');
  }

  // mark holds between keyframes
  for (let i = 0; i < keys.length; i++) {
    const start = keys[i];
    const end = (i + 1 < keys.length) ? keys[i + 1] : (totalFrames + 1);
    for (let f = start + 1; f < end; f++) {
      const cell = getFrameCell(layerId, f);
      if (cell) cell.classList.add('is-hold');
    }
  }
}

function isTimelineLayerLocked(layerId){
  const g = ensureTimelineSVGGroup(layerId);
  return g.dataset.tlLocked === 'true';
}

function setTimelineLayerLocked(layerId, locked){
  const g = ensureTimelineSVGGroup(layerId);
  g.dataset.tlLocked = locked ? 'true' : 'false';

  // if locked and currently selected items are inside, deselect them
  if (locked && selectedElements.length) {
    const inside = selectedElements.some(el => el.closest('g[data-tl]')?.dataset.tl === layerId);
    if (inside) clearSelection();
  }

  updateTimelineLayerUI(layerId);
}

function isTimelineLayerVisible(layerId){
  const g = ensureTimelineSVGGroup(layerId);
  return g.style.display !== 'none';
}

function setTimelineLayerVisible(layerId, visible){
  const g = ensureTimelineSVGGroup(layerId);
  g.style.display = visible ? '' : 'none';

  // if hidden and currently selected items are inside, deselect them
  if (!visible && selectedElements.length) {
    const inside = selectedElements.some(el => el.closest('g[data-tl]')?.dataset.tl === layerId);
    if (inside) clearSelection();
  }

  updateTimelineLayerUI(layerId);
}

function updateTimelineLayerUI(layerId){
  const row = timelineLayers.querySelector(`.timeline-layer[data-layer-id="${layerId}"]`);
  if (!row) return;

  const eye = row.querySelector('.tl-eye');
  const lock = row.querySelector('.tl-lock');

  if (eye) {
    const vis = isTimelineLayerVisible(layerId);
    eye.textContent = vis ? '👁' : '🚫';
    eye.classList.toggle('hidden', !vis);
  }

  if (lock) {
    const locked = isTimelineLayerLocked(layerId);
    lock.textContent = locked ? '🔒' : '🔓';
    row.classList.toggle('locked', locked);
  }
}

/* -------------- Draw rectangl helper function -----------------*/
function rectPathD(x, y, w, h) {
  // Simple rectangle as path (no rounded corners yet)
  return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
}

function setPathRectFromPoints(pathEl, p0, p1) {
  const x = Math.min(p0.x, p1.x);
  const y = Math.min(p0.y, p1.y);
  const w = Math.abs(p1.x - p0.x);
  const h = Math.abs(p1.y - p0.y);

  pathEl.setAttribute('d', rectPathD(x, y, w, h));

  // store size for end check
  pathEl.__rectW = w;
  pathEl.__rectH = h;
}

/* -------------- Draw ellipse helper function -----------------*/
function ellipsePathD(cx, cy, rx, ry) {
  // SVG arc ellipse (closed)
  // Start at rightmost point, draw two arcs back to start
  return [
    `M ${cx + rx} ${cy}`,
    `A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`,
    `A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy}`,
    `Z`
  ].join(' ');
}

function setPathEllipseFromBox(pathEl, p0, p1, forceCircle = false) {
  const x = Math.min(p0.x, p1.x);
  const y = Math.min(p0.y, p1.y);
  const w = Math.abs(p1.x - p0.x);
  const h = Math.abs(p1.y - p0.y);

  let cx = x + w / 2;
  let cy = y + h / 2;

  let rx = w / 2;
  let ry = h / 2;

  // ✅ Shift = perfect circle
  if (forceCircle) {
    const r = Math.max(rx, ry);
    rx = r;
    ry = r;

    // keep end-check consistent
    pathEl.__ellW = r * 2;
    pathEl.__ellH = r * 2;
  } else {
    pathEl.__ellW = w;
    pathEl.__ellH = h;
  }

  // avoid zero-radius arc weirdness
  rx = Math.max(0.001, rx);
  ry = Math.max(0.001, ry);

  pathEl.__shape = 'ellipse';
  pathEl.__ellipse = { cx, cy, rx, ry };
  pathEl.__closed = true;

  pathEl.setAttribute('d', ellipsePathD(cx, cy, rx, ry));
}

/* -------------- Undo redo -----------------*/
function serializeMatrix(m) {
  return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
}

function matrixFromSerialized(o) {
  return new DOMMatrix([o.a, o.b, o.c, o.d, o.e, o.f]);
}

// ✅ snapshot for move/scale/rotate (selected elements)
function snapshotTransformHistory(elements = selectedElements) {
  redoStack = [];
  if (!elements || !elements.length) return;

  // make sure every element has a stable uid
  elements.forEach(ensureUID);

  undoStack.push({
    type: 'transform',
    items: elements.map(el => ({
      uid: el.dataset.uid,
      m: serializeMatrix(getLocalDOMMatrix(el))
    }))
  });

  if (undoStack.length > MAX_HISTORY) undoStack.shift();
}

// ✅ snapshot for anchor edits (your existing one, but typed)
function snapshotAnchorHistory() {
  redoStack = [];
  if (!selectedAnchorPath) return;

  ensurePointsModel(selectedAnchorPath);
  ensureUID(selectedAnchorPath);

  undoStack.push({
    type: 'anchor',
    uid: selectedAnchorPath.dataset.uid,
    points: selectedAnchorPath.__points.map(p => ({ ...p }))
  });

  if (undoStack.length > MAX_HISTORY) undoStack.shift();
}

// ✅ when to show anchors/handles
function shouldShowControlPoints() {
  return (
    (activeTool === 'edit' ||
     activeTool === 'add-anchor' ||
     activeTool === 'delete-anchor' ||
     activeTool === 'join-anchor') &&
    selectedElements.length === 1 &&
    selectedElement?.tagName === 'path' &&
    selectedElement?.__shape !== 'ellipse' // ✅ block ellipse from normal anchors
  );
}

// ✅ refresh UI after any undo/redo
function refreshAfterHistory() {
  if (shouldShowControlPoints()) {
    clearControlPoints();

    // ✅ IMPORTANT: after undo/redo, rebuild path model from current 'd'
    if (selectedElement && selectedElement.tagName === 'path') {
      ensurePointsModel(selectedElement, true);
    }

    // ✅ ellipse uses special handles
    if (selectedElement && selectedElement.__shape === 'ellipse') {
      drawEllipseControls(selectedElement);
    } else {
      drawControlPoints(selectedElement);
    }
  } else {
    clearControlPoints();
  }

  drawSelectionBoxes();
}

// -------------------- Spline tool state --------------------
let splineActive = false;
let splinePoints = [];
let splinePathEl = null;
let splinePreview = null; // {x,y} world
let splineAnchorDots = [];   // circles for fixed points
let splineEndDot = null;     // circle for current end / preview

const SPLINE_DOT_R = 4;          // normal anchors
const SPLINE_END_DOT_R = 5.5;    // slightly bigger
const SPLINE_DOT_FILL = '#000';  // black
const SPLINE_DOT_STROKE = '#fff';

const SPLINE_CLOSE_READY_FILL = '#00c853'; // green when closable (tweak if you like)

function buildPolylineD(points, previewPt = null) {
  if (!points.length) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) d += ` L ${points[i].x} ${points[i].y}`;
  if (previewPt) d += ` L ${previewPt.x} ${previewPt.y}`;
  return d;
}

function buildCubicFromAnchors(points) {
  if (!points || points.length < 2) return { d: '', model: [] };

  let d = `M ${points[0].x} ${points[0].y}`;
  const model = [{ type: 'M', x: points[0].x, y: points[0].y }];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];

    // default straight-line handles (1/3 and 2/3)
    const c1x = a.x + (b.x - a.x) / 3;
    const c1y = a.y + (b.y - a.y) / 3;
    const c2x = a.x + 2 * (b.x - a.x) / 3;
    const c2y = a.y + 2 * (b.y - a.y) / 3;

    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${b.x} ${b.y}`;
    model.push({ type: 'C', c1x, c1y, c2x, c2y, x: b.x, y: b.y });
  }

  return { d, model };
}

function startSpline(worldPt) {
  splineActive = true;
  splinePoints = [worldPt];
  splinePreview = null;

  splinePathEl = document.createElementNS(NS, 'path');
  splinePathEl.setAttribute('fill', 'transparent');
  splinePathEl.setAttribute('fill-opacity', '0');
  splinePathEl.setAttribute('pointer-events', 'none'); // ✅ add this
  splinePathEl.setAttribute('stroke', '#000');      // or your current stroke
  splinePathEl.setAttribute('stroke-width', '2');   // or your current width
  splinePathEl.__isLayer = false;                   // temp
  editLayer.appendChild(splinePathEl);

  splinePathEl.setAttribute('d', buildPolylineD(splinePoints));

  updateSplineDots(null);
}

function cancelSpline() {
  splineActive = false;
  splinePoints = [];
  splinePreview = null;
  if (splinePathEl) splinePathEl.remove();
  splinePathEl = null;

  clearSplineDots();
}

function commitSpline(closed = false) {
  if (!splinePathEl) return;

  // rules you requested
  if (splinePoints.length <= 1) {
    cancelSpline();
    return;
  }

  snapshotDocHistory(); // commit-only (good for performance)

  const built = buildCubicFromAnchors(splinePoints);
  
  if (closed) {
  const p0 = splinePoints[0];
  const pn = splinePoints[splinePoints.length - 1];

  // straight-line handles for closing segment
  const c1x = pn.x + (p0.x - pn.x) / 3;
  const c1y = pn.y + (p0.y - pn.y) / 3;
  const c2x = pn.x + 2 * (p0.x - pn.x) / 3;
  const c2y = pn.y + 2 * (p0.y - pn.y) / 3;

  built.d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p0.x} ${p0.y}`;
  built.model.push({ type: 'C', c1x, c1y, c2x, c2y, x: p0.x, y: p0.y });
}

splinePathEl.setAttribute('d', built.d);

// IMPORTANT: do NOT use Z for spline close, or you lose last handles
splinePathEl.__closed = false;

  // store editable model immediately (so edit tool shows handles right away)
  splinePathEl.__points = built.model;
  splinePathEl.__closed = !!closed;
  // ✅ make it selectable/transformable after commit
  splinePathEl.removeAttribute('pointer-events');      // or: setAttribute('pointer-events','visiblePainted')
  splinePathEl.style.pointerEvents = 'auto';

  // ✅ mark it as a real content element (so it behaves like other drawn stuff)
  setIsLayer(splinePathEl, true);          // use your helper so it survives restore
  applyNonScalingStroke(splinePathEl);     // if you use this for other strokes
  ensureUID(splinePathEl);                 // so selection/undo tracking stays consistent (optional but good)

  // move to active timeline layer
  const g = getActiveLayerGroup(); // must return <g data-tl="...">
  g.appendChild(splinePathEl);

  splinePathEl.__isLayer = true; // if you use this flag
  splinePathEl = null;
  splineActive = false;
  splinePoints = [];
  splinePreview = null;

  // optional: auto-select the new path
  // selectElement(lastCreatedPath)
  clearSplineDots();
}

function addSplinePoint(worldPt) {
  splinePoints.push(worldPt);
  splinePathEl.setAttribute('d', buildPolylineD(splinePoints, splinePreview));
  updateSplineDots(splinePreview);
}

function isCloseToFirst(worldPt) {
  if (splinePoints.length < 2) return false;
  const p0 = splinePoints[0];
  const dx = worldPt.x - p0.x;
  const dy = worldPt.y - p0.y;

  const threshold = 8 / camScale; // tweak feel
  return (dx*dx + dy*dy) <= (threshold * threshold);
}

function ensureSplineDots() {
  // fixed anchor dots
  while (splineAnchorDots.length < splinePoints.length) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', String(SPLINE_DOT_R));      // dot size (tweak)
    c.setAttribute('fill', SPLINE_DOT_FILL);        // black
    c.setAttribute('stroke', SPLINE_DOT_STROKE);    // optional outline so visible on dark
    c.setAttribute('stroke-width', '1');
    c.setAttribute('pointer-events', 'none');
    editLayer.appendChild(c);
    splineAnchorDots.push(c);
  }

  // remove extra if points got reduced (rare)
  while (splineAnchorDots.length > splinePoints.length) {
    splineAnchorDots.pop().remove();
  }

  // end dot
  if (!splineEndDot) {
    splineEndDot = document.createElementNS(NS, 'circle');
    splineEndDot.setAttribute('r', String(SPLINE_END_DOT_R));
    splineEndDot.setAttribute('fill', SPLINE_DOT_FILL);
    splineEndDot.setAttribute('stroke', SPLINE_DOT_STROKE);
    splineEndDot.setAttribute('stroke-width', '1');
    splineEndDot.setAttribute('pointer-events', 'none');
    editLayer.appendChild(splineEndDot);
  }
}

function updateSplineDots(previewPt = null) {
  ensureSplineDots();

  // place fixed dots on each anchor
  for (let i = 0; i < splinePoints.length; i++) {
    splineAnchorDots[i].setAttribute('cx', splinePoints[i].x);
    splineAnchorDots[i].setAttribute('cy', splinePoints[i].y);

    // default style
    splineAnchorDots[i].setAttribute('fill', SPLINE_DOT_FILL);
    splineAnchorDots[i].setAttribute('r', String(SPLINE_DOT_R));
  }

  // --- highlight first anchor when closable ---
  // closable only after at least 2 points, and only if mouse is near first point
  if (splinePoints.length >= 2 && previewPt) {
    const p0 = splinePoints[0];
    const dx = previewPt.x - p0.x;
    const dy = previewPt.y - p0.y;
    const threshold = 8 / camScale; // must match your close tolerance
    const nearFirst = (dx*dx + dy*dy) <= (threshold * threshold);

    if (nearFirst) {
      // make first anchor special
      splineAnchorDots[0].setAttribute('fill', SPLINE_CLOSE_READY_FILL);
      splineAnchorDots[0].setAttribute('r', String(SPLINE_DOT_R + 1)); // slightly bigger too
    }
  }

  // place end dot at preview if available, else at last anchor
  const end = previewPt || splinePoints[splinePoints.length - 1];
  if (end) {
    splineEndDot.style.display = '';
    splineEndDot.setAttribute('cx', end.x);
    splineEndDot.setAttribute('cy', end.y);
    splineEndDot.setAttribute('r', String(SPLINE_END_DOT_R)); // ensure bigger
  } else {
    splineEndDot.style.display = 'none';
  }
}

function clearSplineDots() {
  splineAnchorDots.forEach(c => c.remove());
  splineAnchorDots = [];
  if (splineEndDot) splineEndDot.remove();
  splineEndDot = null;
}

// -------------------- Events --------------------
function handleSplineMouseDown(e) {
  const pt = getSVGPoint(e); // world
  if (!splineActive) {
    startSpline(pt);
    return;
  }

  // click first anchor to close
  if (isCloseToFirst(pt)) {
    commitSpline(true);
    return;
  }

  addSplinePoint(pt);
}

function handleSplineMouseMove(e) {
  if (!splineActive || !splinePathEl) return;
  splinePreview = getSVGPoint(e);
  splinePathEl.setAttribute('d', buildPolylineD(splinePoints, splinePreview));
  updateSplineDots(splinePreview);
}

window.addEventListener('keydown', (e) => {
  if (activeTool !== 'spline') return;

  if (e.key === 'Enter') {
    e.preventDefault();
    // if only one anchor: remove it (cancel)
    // if two anchors: makes a straight line (commit open)
    commitSpline(false);
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    cancelSpline();
  }
});

/*-----------------------------------------------------------*/
function getLocalDOMMatrix(el) {
  const base = el.transform.baseVal.consolidate();
  if (!base) return new DOMMatrix(); // identity
  const m = base.matrix;
  return new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]);
}

// ✅ Set element transform from DOMMatrix
function setLocalDOMMatrix(el, m) {
  el.setAttribute('transform', `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`);
}

function getTransformedBBox(el) {
  const b = el.getBBox();
  const m = getLocalDOMMatrix(el);

  const p1 = new DOMPoint(b.x, b.y).matrixTransform(m);
  const p2 = new DOMPoint(b.x + b.width, b.y).matrixTransform(m);
  const p3 = new DOMPoint(b.x, b.y + b.height).matrixTransform(m);
  const p4 = new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(m);

  const xs = [p1.x, p2.x, p3.x, p4.x];
  const ys = [p1.y, p2.y, p3.y, p4.y];

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function localToWorld(el, x, y) {
  const m = getLocalDOMMatrix(el);
  const p = new DOMPoint(x, y).matrixTransform(m);
  return { x: p.x, y: p.y };
}

function worldToLocal(el, x, y) {
  const inv = getLocalDOMMatrix(el).inverse();
  const p = new DOMPoint(x, y).matrixTransform(inv);
  return { x: p.x, y: p.y };
}

function startRotateDrag(e) {
  if (!selectedElements.length) return;

  snapshotTransformHistory(selectedElements);

  isRotateDragging = true;

  const pt = getSVGPoint(e);

  // selection bounds in world coords
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  selectedElements.forEach(el => {
    const b = getTransformedBBox(el);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  });

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const startAngle = Math.atan2(pt.y - cy, pt.x - cx);

  rotateDrag = {
    cx, cy,
    startAngle,
    starts: selectedElements.map(el => ({
      el,
      m: getLocalDOMMatrix(el)
    })),
    snap: e.shiftKey
  };
}

/* ----------------------------------------------------------------------------- */
/* -------------------------------- Anchor snap -------------------------------- */
/* ----------------------------------------------------------------------------- */
function snapAnchorsIfClose(path, clickedIndex) {
  ensurePointsModel(path);

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
  camera.setAttribute('transform', `translate(${camX}, ${camY}) scale(${camScale})`);

  updateStage();
  drawGrid();
  drawRulers();

  // ✅ keep overlay UI sized correctly after zoom
  drawSelectionBoxes();
  if (shouldShowControlPoints()) {
    clearControlPoints();

    if (selectedElement && selectedElement.tagName === 'path') {
      ensurePointsModel(selectedElement, true);
    }

    if (selectedElement && selectedElement.__shape === 'ellipse') {
      drawEllipseControls(selectedElement);
    } else {
      drawControlPoints(selectedElement);
    }
  }
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

  const entry = undoStack.pop();

  // ---------------- DOC ----------------
  if (entry.type === 'doc') {
    ensureUIDsInContent();
    redoStack.push({
      type: 'doc',
      html: contentLayer.innerHTML,
      selectedIds: selectedElements.map(el => el?.dataset?.uid).filter(Boolean),
      activeId: selectedElement?.dataset?.uid || null
    });

    restoreDocState(entry);
    return;
  }

  // ---------------- TRANSFORM ----------------
  if (entry.type === 'transform') {
    // push current state to redo
    redoStack.push({
      type: 'transform',
      items: entry.items.map(({ uid }) => {
        const el = contentLayer.querySelector(`[data-uid="${uid}"]`);
        return el
          ? { uid, m: serializeMatrix(getLocalDOMMatrix(el)) }
          : { uid, m: null }; // element missing
      })
    });

    // restore transforms
    entry.items.forEach(({ uid, m }) => {
      if (!m) return;
      const el = contentLayer.querySelector(`[data-uid="${uid}"]`);
      if (!el) return;
      setLocalDOMMatrix(el, matrixFromSerialized(m));
    });

    refreshAfterHistory();
    return;
  }

  // ---------------- ANCHOR ----------------
  if (entry.type === 'anchor') {
    const path = contentLayer.querySelector(`[data-uid="${entry.uid}"]`);
    if (!path || path.tagName !== 'path') {
      // path deleted or not found -> just refresh UI
      refreshAfterHistory();
      return;
    }

    ensurePointsModel(path);

    // push current for redo
    redoStack.push({
      type: 'anchor',
      uid: entry.uid,
      points: path.__points.map(p => ({ ...p }))
    });

    // restore points
    path.__points = entry.points.map(p => ({ ...p }));
    rebuildPathFromPoints(path);

    refreshAfterHistory();
  }
}

function redo() {
  if (!redoStack.length) return;

  const entry = redoStack.pop();

  // ---------------- DOC ----------------
  if (entry.type === 'doc') {
    ensureUIDsInContent();
    undoStack.push({
      type: 'doc',
      html: contentLayer.innerHTML,
      selectedIds: selectedElements.map(el => el?.dataset?.uid).filter(Boolean),
      activeId: selectedElement?.dataset?.uid || null
    });

    restoreDocState(entry);
    return;
  }

  // ---------------- TRANSFORM ----------------
  if (entry.type === 'transform') {
    // push current state to undo
    undoStack.push({
      type: 'transform',
      items: entry.items.map(({ uid }) => {
        const el = contentLayer.querySelector(`[data-uid="${uid}"]`);
        return el
          ? { uid, m: serializeMatrix(getLocalDOMMatrix(el)) }
          : { uid, m: null };
      })
    });

    // restore transforms
    entry.items.forEach(({ uid, m }) => {
      if (!m) return;
      const el = contentLayer.querySelector(`[data-uid="${uid}"]`);
      if (!el) return;
      setLocalDOMMatrix(el, matrixFromSerialized(m));
    });

    refreshAfterHistory();
    return;
  }

  // ---------------- ANCHOR ----------------
  if (entry.type === 'anchor') {
    const path = contentLayer.querySelector(`[data-uid="${entry.uid}"]`);
    if (!path || path.tagName !== 'path') {
      refreshAfterHistory();
      return;
    }

    ensurePointsModel(path);

    // push current for undo
    undoStack.push({
      type: 'anchor',
      uid: entry.uid,
      points: path.__points.map(p => ({ ...p }))
    });

    // restore points
    path.__points = entry.points.map(p => ({ ...p }));
    rebuildPathFromPoints(path);

    refreshAfterHistory();
  }
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
document.addEventListener('mousedown', (e) => {
  closeAll();
  menuActive = false;

  // ✅ if click outside library panel, remove library focus
  if (!e.target.closest('#layersPanel')) {
    libraryHasFocus = false;
    selectedLibraryAssetId = null;   // optional: also clear highlight
    updateLayersPanel();             // optional: refresh highlight
  }
});

function openMenu(menu) {
  closeAll();
  menu.classList.add('open');
}

function closeAll() {
  menus.forEach(m => m.classList.remove('open'));
}

// ✅ Menu items: only close menus (no selecting objects from contentLayer)
document.querySelectorAll('.menu .item').forEach(item => {
  item.addEventListener('click', e => {
    e.stopPropagation();

    // 🔴 CLOSE MENUS HERE
    closeAll();
    menuActive = false;

    // ❌ removed old object-selection logic (no dataset.targetId anymore)
    // const target = [...contentLayer.children]...
  });
});

document.getElementById('newFile').onclick = () => {
  if (contentLayer.children.length === 0) return;

  const confirmNew = confirm('Start a new document? Unsaved changes will be lost.');
  if (!confirmNew) return;

  newDocument();
};

document.getElementById('saveFile').onclick = () => {
  console.log('Save');
};

document.getElementById('importToStage').onclick = async () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    // make an href usable by <image>
    const href = URL.createObjectURL(file);

    // (optional) measure w/h now, but you said props later
    // We can store 0 for now safely
    const assetId = newAssetId();

    libraryAssets.set(assetId, {
      name: file.name,
      href,
      w: 0,
      h: 0
    });

    setLibrarySelection(assetId);   // highlight in Library, NOT stage selection

    // ✅ create ONE instance at (0,0) on ACTIVE timeline layer
    snapshotDocHistory();

    const imgEl = document.createElementNS(NS, 'image');
    imgEl.dataset.assetId = assetId;
    imgEl.dataset.assetName = file.name;
    imgEl.setAttribute('data-layer-name', file.name);

    setIsLayer(imgEl, true);
    ensureUID(imgEl);

    imgEl.setAttribute('href', href);
    imgEl.setAttribute('x', 0);
    imgEl.setAttribute('y', 0);

    // ✅ TEMP until you add real properties
    imgEl.setAttribute('width', 200);
    imgEl.setAttribute('height', 200);

    getActiveLayerGroup().appendChild(imgEl);

    // ✅ update Library UI and select the new stage instance (optional)
    updateLayersPanel();
    setActiveTool(transformTool, 'transform');
    selectElement(imgEl, false);

    clearControlPoints();
    drawSelectionBoxes();
  };

  input.click();
};

document.getElementById('undo').onclick = () => {
  undo();
};

document.getElementById('redo').onclick = () => {
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

document.getElementById('insertLayer').onclick = (e) => {
  e.stopPropagation();
  createTimelineLayer();  // adds + selects new layer
};

document.getElementById('removeLayer').onclick = (e) => {
  e.stopPropagation();
  removeTimelineLayer(); // removes active
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


/* ----------------------------- New document ---------------------------------- */
function newDocument() {
  // ✅ HARD RESET: selection + anchors + dragging states
  ignoreDeselect = false;

  selectedElements = [];
  selectedElement = null;

  clearSelectedAnchor();     // sets selectedAnchorPath/index = null
  draggingAnchor = null;
  draggingPath = null;
  activeHandle = null;
  activeControlPoint = null;
  activeAnchorIndex = null;

  isDragging = false;
  dragStart = null;
  startTransforms = new Map();

  isHandleDragging = false;
  handleDrag = null;

  isRotateDragging = false;
  rotateDrag = null;

  marqueeActive = false;
  marqueeStart = null;
  if (overlayLayer) overlayLayer.innerHTML = '';
  marqueeRect = null;

  // ✅ CLEAR UI LAYERS (visuals)
  clearControlPoints();          // editLayer.innerHTML = ''
  selectionLayer.innerHTML = ''; // selection boxes
  editLayer.innerHTML = '';      // extra safety

  // ---- your existing code continues ----
  inspectorEmpty.style.display = 'block';
  inspectorPath.classList.add('hidden');

  stage.width = 800;
  stage.height = 600;

  camScale = 1;
  camX = 0;
  camY = 0;

  updateCamera();
  requestAnimationFrame(centerStage);

  contentLayer.innerHTML = '';
  layersList.innerHTML = '';

  resetTimeline();
}

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
const rulerX = document.getElementById('rulerX');
const rulerY = document.getElementById('rulerY');

const RULER_SIZE = 20;
const RULER_STEP = 50; // same feel as Boxy

function drawRulers() {
  const contentX = rulerX.querySelector('.ruler-content') || rulerX;
  const contentY = rulerY.querySelector('.ruler-content') || rulerY;

  // ✅ clear only ticks/text, not the whole SVG if you have background layers
  contentX.innerHTML = '';
  contentY.innerHTML = '';

  const rect = svg.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  const step = RULER_STEP * camScale;
  if (step < 25) return;

  // Horizontal
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
      contentX.appendChild(text);
    }

    contentX.appendChild(line);
  }

  // Vertical
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
      contentY.appendChild(text);
    }

    contentY.appendChild(line);
  }
}

/*-------- Toggle grid ----------*/
const toggleGridBtn = document.getElementById('toggleGrid');
const grid = document.getElementById('gridLayer');
const gridCheck = document.getElementById('gridCheck');

let gridVisible = false;

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
  grid.innerHTML = '';

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

    grid.appendChild(line);
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

    grid.appendChild(line);
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

  // ✅ Only show selection rectangle in TRANSFORM tool
  if (toolName === 'transform') {
    drawSelectionBoxes();
  } else {
    selectionLayer.innerHTML = ''; // hide selection rectangle in edit/add/delete/join
  }

  if (
    (toolName === 'edit' ||
     toolName === 'delete-anchor' ||
     toolName === 'add-anchor' ||
     toolName === 'join-anchor') &&
    selectedElements.length === 1 &&
    selectedElement?.tagName === 'path'
  ) {
    // ✅ ellipse uses special handles
    if (selectedElement && selectedElement.tagName === 'path') {
      ensurePointsModel(selectedElement, true);
    }

    if (selectedElement && selectedElement.__shape === 'ellipse') {
      drawEllipseControls(selectedElement);
    } else {
      drawControlPoints(selectedElement);
    }
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
  snapshotDocHistory();

  drawing = true;

  const pt = getSVGPoint(e);

  freehandPoints = [{ x: pt.x, y: pt.y }];

  activeFreehandPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');

  // ✅ ADD THESE 2 LINES HERE
  setIsLayer(activeFreehandPath, false);   // not in layers until symbol
  ensureUID(activeFreehandPath);

  activeFreehandPath.setAttribute('d', `M ${pt.x} ${pt.y}`);
  activeFreehandPath.setAttribute('fill', 'none');
  activeFreehandPath.setAttribute('stroke', '#000');
  activeFreehandPath.setAttribute('stroke-width', '2');
  applyNonScalingStroke(activeFreehandPath);
  activeFreehandPath.setAttribute('stroke-linecap', 'round');
  activeFreehandPath.setAttribute('stroke-linejoin', 'round');

  // 🔹 Append to SVG so user can see it while drawing
  getActiveLayerGroup().appendChild(activeFreehandPath);

  // 🔹 Track for later conversion to symbol
  newElements.push(activeFreehandPath);

  // ❌ Do NOT call updateLayersPanel() yet
}

function handleRectangleStart(e) {
  snapshotDocHistory();

  rectDrawing = true;
  rectStart = getSVGPoint(e);

  // ✅ create PATH (not RECT)
  currentRect = document.createElementNS(NS, 'path');

  setIsLayer(currentRect, false);
  ensureUID(currentRect);

  // default style (same as your old rect)
  currentRect.setAttribute('fill', 'none');
  currentRect.setAttribute('stroke', '#000');
  currentRect.setAttribute('stroke-width', '2');
  applyNonScalingStroke(currentRect);
  currentRect.setAttribute('stroke-linecap', 'round');
  currentRect.setAttribute('stroke-linejoin', 'round');

  // initial tiny rectangle path
  currentRect.setAttribute('d', rectPathD(rectStart.x, rectStart.y, 0, 0));
  currentRect.__closed = true;

  // ✅ append so we can see it while dragging
  getActiveLayerGroup().appendChild(currentRect);

  // track for later symbol conversion
  newElements.push(currentRect);

  // do NOT add to layer panel unless it’s symbol (your system)
  // updateLayersPanel();  // keep off if you want
}

function handleRectangleMove(e) {
  if (!rectDrawing || !currentRect || !rectStart) return;

  const pt = getSVGPoint(e);
  setPathRectFromPoints(currentRect, rectStart, pt);
}

function handleRectangleEnd(e) {
  if (!rectDrawing || !currentRect) return;

  // finalize one last time
  handleRectangleMove(e);

  const w = currentRect.__rectW || 0;
  const h = currentRect.__rectH || 0;

  const MIN_SIZE = 2 / camScale;
  if (w < MIN_SIZE || h < MIN_SIZE) {
    currentRect.remove();
  } else {
    // ✅ build points model NOW so anchor tools work immediately
    // Path is: M -> L -> L -> L -> Z, so we store 4 points (M + 3 L)
    const d = currentRect.getAttribute('d');
    const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) || [];
    // nums: [x,y, x2,y2, x3,y3, x4,y4]
    if (nums.length >= 8) {
      currentRect.__points = [
        { type: 'M', x: nums[0], y: nums[1] },
        { type: 'L', x: nums[2], y: nums[3] },
        { type: 'L', x: nums[4], y: nums[5] },
        { type: 'L', x: nums[6], y: nums[7] }
      ];
    }

    // switch to transform + select
    selectElement(currentRect, false);
  }

  rectDrawing = false;
  rectStart = null;
  currentRect = null;
}

function handleTransformStart(e) {
  if (activeTool !== 'transform') return;
  if (e.button !== 0) return; // ✅ left only

  // get actual drawable element inside timeline groups
  const hit = e.target.closest('#contentLayer g[data-tl] > *');
  const target = hit || e.target;

  if (target.closest('.selection-rect-group')) return;

  // clicked empty canvas (not a drawable element)
  if (!hit || target.style.display === 'none' || isLayerLocked(target)) {
    clearSelection();
    startMarquee(e);
    return;
  }

  const additive = e.shiftKey;

  if (!selectedElements.includes(target)) {
    selectElement(target, additive);
  }

  snapshotTransformHistory(selectedElements);
  isDragging = true;
  dragStart = getSVGPoint(e);

  startTransforms.clear();
  selectedElements.forEach(el => {
    startTransforms.set(el, getLocalDOMMatrix(el));
  });

  e.preventDefault();
}

function handleEditStart(e) {
  const hit = e.target.closest('#contentLayer g[data-tl] > *');
  const target = hit || e.target;

  if (!hit || target.tagName !== 'path' || isLayerLocked(target)) {
    clearSelection();
    return;
  }

  if (!selectedElements.includes(target)) selectElement(target);
  e.stopPropagation();
}

function handleEllipseStart(e) {
  snapshotDocHistory();

  ellipseDrawing = true;
  ellipseStart = getSVGPoint(e);

  // ✅ create PATH (not ELLIPSE)
  currentEllipse = document.createElementNS(NS, 'path');
  setIsLayer(currentEllipse, false);
  ensureUID(currentEllipse);

  currentEllipse.__shape = 'ellipse';
  currentEllipse.__closed = true;

  currentEllipse.setAttribute('fill', 'none');
  currentEllipse.setAttribute('stroke', '#000');
  currentEllipse.setAttribute('stroke-width', '2');
  applyNonScalingStroke(currentEllipse);
  currentEllipse.setAttribute('stroke-linecap', 'round');
  currentEllipse.setAttribute('stroke-linejoin', 'round');

  // initial tiny ellipse
  setPathEllipseFromBox(currentEllipse, ellipseStart, ellipseStart);

  getActiveLayerGroup().appendChild(currentEllipse);
  newElements.push(currentEllipse);
}

function handleEllipseMove(e) {
  if (!ellipseDrawing || !currentEllipse || !ellipseStart) return;
  const pt = getSVGPoint(e);

  // ✅ Shift = circle during draw
  setPathEllipseFromBox(currentEllipse, ellipseStart, pt, e.shiftKey);
}

function handleEllipseEnd(e) {
  if (!ellipseDrawing || !currentEllipse) return;

  handleEllipseMove(e);

  const w = currentEllipse.__ellW || 0;
  const h = currentEllipse.__ellH || 0;

  const MIN_SIZE = 2 / camScale;
  if (w < MIN_SIZE || h < MIN_SIZE) {
    currentEllipse.remove();
  } else {
    selectElement(currentEllipse, false);
  }

  ellipseDrawing = false;
  ellipseStart = null;
  currentEllipse = null;
}

document.addEventListener('DOMContentLoaded', () => {
  contentLayer.querySelectorAll('g[data-tl] > *').forEach(applyNonScalingStroke);
  
  updateStage();
  centerStage();

  // Remove browser default right click menu
  document.addEventListener('contextmenu', e => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY);
  });

  /*svg.addEventListener('mousedown', () => {
    console.log('SVG mousedown');
  });

  if (!svg) {
    console.error('SVG canvas (#svgCanvas) not found');
    return;
  }*/

  svg.addEventListener('mousedown', e => {
    // ✅ Only LEFT click manipulates objects/tools.
    // Middle = camera pan, Right = context menu (no transforms)
    if (e.button !== 0) return;

    const handle = e.target.closest('.handle-rect');
    const rectGroup = e.target.closest('.selection-rect-group');
    const editLayerTarget = e.target.closest('#editLayer');

    // ✅ Let editLayer (anchors/handles) work normally
    if (editLayerTarget  && activeTool !== 'spline') {
      return;
    }

    timelineBeforeMutate('copy');

    const rotateHandle = e.target.closest('.rotate-handle');
    if (rotateHandle && activeTool === 'transform' && selectedElements.length) {
      e.stopImmediatePropagation();
      e.preventDefault();
      ignoreDeselect = true;
      timelineBeforeMutate('copy');
      startRotateDrag(e);
      return;
    }

    // ⛔ Ignore clicks on edit-layer UI, handles, or selection rectangle
    if (handle || rectGroup || editLayerTarget) {
      e.stopImmediatePropagation();
      e.preventDefault();
      ignoreDeselect = true;

      // 1) Handle drag has priority
      if (handle) {
        timelineBeforeMutate('copy');
        startHandleDrag(e, handle);
        return;
      }

      // 2) Click inside selection rectangle should MOVE selection (transform tool only)
      if (rectGroup && activeTool === 'transform' && selectedElements.length) {
        timelineBeforeMutate('copy');
        isDragging = true;
        dragStart = getSVGPoint(e);

        startTransforms.clear();
        selectedElements.forEach(el => {
          startTransforms.set(el, getLocalDOMMatrix(el)); // ✅ store full matrix
        });

        return;
      }

      // 3) Edit layer clicks: do nothing here (your pointerdown handlers handle anchors)
      return;
    }

    // Middle mouse = camera pan
    if (e.button === 1) return;

    // Tools
    if (activeTool === 'add-anchor' && selectedElements.length === 1 && selectedElement && selectedElement.tagName === 'path') {
      const pt = getSVGPoint(e);

      // 1) modify the path first
      addAnchorToPath(selectedElement, pt.x, pt.y);

      // 2) rebuild points model from new 'd'
      ensurePointsModel(selectedElement, true);

      // 3) redraw control points after mutation
      clearControlPoints();
      drawControlPoints(selectedElement);

      return;
    }

    if (activeTool === 'delete-anchor' && editLayerTarget) return;

    if (activeTool === 'rectangle') { 
      timelineBeforeMutate('copy'); 
      handleRectangleStart(e); 
      return; 
    }

    if (activeTool === 'draw') {
      handleDrawStart(e);
      return;
    }

    if (activeTool === 'transform') {
      handleTransformStart(e);
      return;
    }

    if (activeTool === 'edit') {
      snapshotAnchorHistory();
      handleEditStart(e);
      return;
    }

    if (activeTool === 'spline') {
      timelineBeforeMutate('copy');
      handleSplineMouseDown(e);
      return;
    }

    if (activeTool === 'ellipse') { 
      timelineBeforeMutate('copy'); 
      handleEllipseStart(e); 
      return; 
    }
  });

  svg.addEventListener('mousemove', e => {
    if (activeTool === 'spline') {
      handleSplineMouseMove(e);
      return;
    }
  });

  svg.addEventListener('pointerup', e => {
    timelineAfterMutate();

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

    // 🔹 Ellipse handle drag (rx/ry)
    if (draggingPath && (draggingAnchor === 'ellipse-rx' || draggingAnchor === 'ellipse-ry')) {
      if (!activeControlPoint || !activeControlPoint.__start) return;

      const start = activeControlPoint.__start;

      const worldMouse = getSVGPoint(e);
      const localMouse = worldToLocal(draggingPath, worldMouse.x, worldMouse.y);

      const data = draggingPath.__ellipse || { cx: start.cx, cy: start.cy, rx: start.rx, ry: start.ry };
      data.cx = start.cx;
      data.cy = start.cy;

      if (draggingAnchor === 'ellipse-rx') {
        data.rx = Math.max(0.001, Math.abs(localMouse.x - data.cx));
      } else {
        data.ry = Math.max(0.001, Math.abs(localMouse.y - data.cy));
      }

      // ✅ Shift = keep perfect circle while dragging handle (allow shrink!)
      if (e.shiftKey) {
        if (draggingAnchor === 'ellipse-rx') {
          data.ry = data.rx;  // lock Y radius to X radius
        } else if (draggingAnchor === 'ellipse-ry') {
          data.rx = data.ry;  // lock X radius to Y radius
        }
      }

      draggingPath.__ellipse = data;
      draggingPath.__shape = 'ellipse';
      draggingPath.__closed = true;

      draggingPath.setAttribute('d', ellipsePathD(data.cx, data.cy, data.rx, data.ry));

      clearControlPoints();
      drawEllipseControls(draggingPath);
      return;
    }

    // 🔹 Anchor drag
    if (draggingPath && draggingAnchor !== null && draggingAnchor !== 'bezier') {
      if (!activeControlPoint || !activeControlPoint.__start) return;

      const start = activeControlPoint.__start;
      const pt = draggingPath.__points[draggingAnchor];

      const worldMouse = getSVGPoint(e);
      const localMouse = worldToLocal(draggingPath, worldMouse.x, worldMouse.y);

      const dx = localMouse.x - start.mouseLocalX;
      const dy = localMouse.y - start.mouseLocalY;

      pt.x = start.x + dx;
      pt.y = start.y + dy;

      rebuildPathFromPoints(draggingPath);
      clearControlPoints();
      drawControlPoints(draggingPath);
      return;
    }

    // 🔹 Bezier handle drag
    if (draggingAnchor === 'bezier' && activeHandle) {
      var path = activeHandle.path;
      if (!path) return;

      // rebuild model if needed
      ensurePointsModel(path);

      // mouse in LOCAL space of the path
      var ptW = getSVGPoint(e);
      var localMouse = worldToLocal(path, ptW.x, ptW.y);

      var dx = localMouse.x - activeHandle.startMouseX;
      var dy = localMouse.y - activeHandle.startMouseY;

      var p = path.__points[activeHandle.pointIndex];
      if (!p || p.type !== 'C') return; // everything should be C now

      if (activeHandle.kind === 'c1') {
        p.c1x = activeHandle.startCX + dx;
        p.c1y = activeHandle.startCY + dy;
      } else {
        p.c2x = activeHandle.startCX + dx;
        p.c2y = activeHandle.startCY + dy;
      }

      rebuildPathFromPoints(path);
      drawControlPoints(path);
      return;
    }
  });

  // ---------- Library drag-drop onto stage ----------
  svg.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  svg.addEventListener('drop', (e) => {
    e.preventDefault();

    const assetId = e.dataTransfer.getData('text/asset-id');
    if (!assetId || !libraryAssets.has(assetId)) return;

    const asset = libraryAssets.get(assetId);

    snapshotDocHistory();

    const pt = getSVGPoint(e);
    const imgEl = document.createElementNS(NS, 'image');

    imgEl.dataset.assetId = assetId;
    imgEl.dataset.assetName = asset.name;
    imgEl.setAttribute('data-layer-name', asset.name);

    setIsLayer(imgEl, true);
    ensureUID(imgEl);

    imgEl.setAttribute('href', asset.href);

    // drop position
    imgEl.setAttribute('x', pt.x);
    imgEl.setAttribute('y', pt.y);

    imgEl.setAttribute('width', asset.w || 200);
    imgEl.setAttribute('height', asset.h || 200);

    getActiveLayerGroup().appendChild(imgEl);

    setActiveTool(transformTool, 'transform');
    selectElement(imgEl, false);

    // ✅ force correct transform selection UI immediately
    clearControlPoints();
    drawSelectionBoxes();

    updateLayersPanel();
  });

  const contextMenu = document.getElementById('contextMenu');
  const menuAbout = document.getElementById('menuAbout');

  wireTimelineHorizontalScroll();
  updatePlayhead();
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

const MARQUEE_MIN_DRAG = 6; // px (world-ish). tweak 4–8

function startMarquee(e) {
  marqueeActive = true;
  marqueeStart = getSVGPoint(e);

  // ✅ don't create marqueeRect yet (only after dragging enough)
  marqueeRect = null;
  //marqueeRect = document.createElementNS(NS, 'rect');
  //marqueeRect.classList.add('marquee-rect');

  //overlayLayer.appendChild(marqueeRect);
}

function handleMarqueeMove(e) {
  if (!marqueeActive || !marqueeStart) return;

  const pt = getSVGPoint(e);

  const dx = pt.x - marqueeStart.x;
  const dy = pt.y - marqueeStart.y;

  // ✅ 아직 드래그가 너무 작으면 marquee 자체를 만들지 않음 (Flash 느낌)
  if (!marqueeRect) {
    if (Math.abs(dx) < MARQUEE_MIN_DRAG && Math.abs(dy) < MARQUEE_MIN_DRAG) return;

    marqueeRect = document.createElementNS(NS, 'rect');
    marqueeRect.classList.add('marquee-rect');
    overlayLayer.appendChild(marqueeRect);
  }

  const x = Math.min(pt.x, marqueeStart.x);
  const y = Math.min(pt.y, marqueeStart.y);
  const w = Math.abs(dx);
  const h = Math.abs(dy);

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

  for (const el of contentLayer.querySelectorAll('g[data-tl] > *')) {
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

function selectElement(el, additive = false) {
  if (!additive) {
    clearSelection();
  }

  if (!selectedElements.includes(el)) {
    selectedElements.push(el);
  }

  selectedElement = el; // last selected
  // ✅ Only show selection rectangle in transform mode (hide in edit mode)
  if (activeTool === 'transform' || activeTool === 'rectangle' || activeTool === 'ellipse' || activeTool === 'draw' || activeTool === 'spline') {
    drawSelectionBoxes();
  } else {
    selectionLayer.innerHTML = ''; // hide selection rect in edit/delete/add/join
  }
  updateInspector();

  // 🔹 Only update layers panel if element is marked as a symbol
  if (el.dataset.symbol === 'true') updateLayersPanel();

  if (activeTool === 'edit' && selectedElements.length === 1 && el.tagName === 'path') {
    drawControlPoints(el);
  } else {
    clearControlPoints();
  }
}

//--------------- Clear selection -----------------
function clearSelection() {
  if (ignoreDeselect) return; // ✅ ADD THIS

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

  snapshotDocHistory();

  const OFFSET = 10;
  const newSelection = [];

  selectedElements.forEach(el => {
    const clone = el.cloneNode(true);

    // give a new uid
    clone.removeAttribute('data-uid');
    ensureUID(clone);

    // preserve flags (cloneNode already copies dataset attrs, but safe)
    if (el.dataset.isLayer) clone.dataset.isLayer = el.dataset.isLayer;
    if (el.dataset.symbol)  clone.dataset.symbol  = el.dataset.symbol;
    if (el.dataset.locked)  clone.dataset.locked  = el.dataset.locked;

    // ✅ preserve full transform (rotation/scale/etc) + add offset
    const m = getLocalDOMMatrix(el);                      // original matrix
    const moveM = new DOMMatrix().translate(OFFSET, OFFSET);
    const nextM = moveM.multiply(m);                      // world move after existing transform
    setLocalDOMMatrix(clone, nextM);

    // keep it in the same timeline layer group
    const parent = el.closest('g[data-tl]') || getActiveLayerGroup();
    parent.appendChild(clone);

    newSelection.push(clone);
  });

  // select duplicates
  clearSelection();
  newSelection.forEach(n => selectedElements.push(n));
  selectedElement = newSelection[newSelection.length - 1];

  drawSelectionBoxes();
  updateLayersPanel();
  updateInspector();
}

//--------------- Delete selected path -----------------
function deleteSelected() {
  if (!selectedElements.length) return;

  snapshotDocHistory();

  selectedElements.forEach(el => {
    if (el && el.closest('#contentLayer')) el.remove();
  });

  clearSelection();
  updateLayersPanel();
  updateInspector();
  clearControlPoints();
}

/* ----------------------------------------------------------------------------- */
/* ------------------------------- Arrange logic ------------------------------- */
/* ----------------------------------------------------------------------------- */
function getArrangeParent() {
  const ref = selectedElements[selectedElements.length - 1];
  const parent = (ref && ref.closest('g[data-tl]')) || getActiveLayerGroup();

  // ✅ block cross-layer arrange
  const cross = selectedElements.some(el => el.closest('g[data-tl]') !== parent);
  if (cross) return null;

  return parent;
}

function bringToFront() {
  if (!selectedElements.length) return;

  const parent = getArrangeParent();
  if (!parent) return;

  snapshotDocHistory();

  const kids = [...parent.children];
  const sel = new Set(selectedElements);

  const selectedOrdered = kids.filter(el => sel.has(el));
  const rest = kids.filter(el => !sel.has(el));

  // front = end of DOM
  [...rest, ...selectedOrdered].forEach(el => parent.appendChild(el));

  drawSelectionBoxes();
  updateLayersPanel();
}

function sendToBack() {
  if (!selectedElements.length) return;

  const parent = getArrangeParent();
  if (!parent) return;

  snapshotDocHistory();

  const kids = [...parent.children];
  const sel = new Set(selectedElements);

  const selectedOrdered = kids.filter(el => sel.has(el));
  const rest = kids.filter(el => !sel.has(el));

  // back = start of DOM
  [...selectedOrdered, ...rest].forEach(el => parent.appendChild(el));

  drawSelectionBoxes();
  updateLayersPanel();
}

function bringForward() {
  if (!selectedElements.length) return;

  const parent = getArrangeParent();
  if (!parent) return;

  snapshotDocHistory();

  const kids = [...parent.children];
  const sel = new Set(selectedElements);

  // move each selected one step forward (towards end)
  for (let i = kids.length - 2; i >= 0; i--) {
    const el = kids[i];
    const next = kids[i + 1];
    if (sel.has(el) && !sel.has(next)) {
      kids[i] = next;
      kids[i + 1] = el;
    }
  }

  kids.forEach(el => parent.appendChild(el));

  drawSelectionBoxes();
  updateLayersPanel();
}

function sendBackward() {
  if (!selectedElements.length) return;

  const parent = getArrangeParent();
  if (!parent) return;

  snapshotDocHistory();

  const kids = [...parent.children];
  const sel = new Set(selectedElements);

  // move each selected one step backward (towards start)
  for (let i = 1; i < kids.length; i++) {
    const el = kids[i];
    const prev = kids[i - 1];
    if (sel.has(el) && !sel.has(prev)) {
      kids[i] = prev;
      kids[i - 1] = el;
    }
  }

  kids.forEach(el => parent.appendChild(el));

  drawSelectionBoxes();
  updateLayersPanel();
}

/* ----------------------------------------------------------------------------- */
/* ------------------------------ Inspector logic ------------------------------ */
/* ----------------------------------------------------------------------------- */
const inspectorEmpty = document.getElementById('inspectorEmpty');

const inspectorPath = document.getElementById('inspectorPath');

const strokeWidthInput = document.getElementById('strokeWidth');

strokeWidthInput.addEventListener('pointerdown', () => {
  if (selectedElement) snapshotDocHistory();
});

strokeWidthInput.addEventListener('input', () => {
  if (!selectedElement) return;
  selectedElement.setAttribute('stroke-width', strokeWidthInput.value);
  drawSelectionBoxes();
});

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

// ---------- extra color utils ----------
function hexToRgb(hex) {
  const h = (hex || '').replace('#','').trim();
  if (h.length === 3) {
    return {
      r: parseInt(h[0]+h[0],16),
      g: parseInt(h[1]+h[1],16),
      b: parseInt(h[2]+h[2],16)
    };
  }
  if (h.length === 6) {
    return {
      r: parseInt(h.slice(0,2),16),
      g: parseInt(h.slice(2,4),16),
      b: parseInt(h.slice(4,6),16)
    };
  }
  return null;
}

function rgbToHsv(r,g,b){
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  const d=max-min;
  let h=0;
  if(d!==0){
    if(max===r) h=((g-b)/d)%6;
    else if(max===g) h=(b-r)/d+2;
    else h=(r-g)/d+4;
    h*=60; if(h<0) h+=360;
  }
  const s = max===0 ? 0 : d/max;
  const v = max;
  return {h,s,v};
}

function clamp(v,lo,hi){ return Math.max(lo, Math.min(hi, v)); }
function rgbaCss(r,g,b,a){ return `rgba(${r},${g},${b},${a})`; }

const backdrop = document.getElementById('cpBackdrop');

// ---------- Flash/GIMP style picker ----------
const CP = (() => {
  const root = document.getElementById('colorPicker');
  const title = document.getElementById('cpTitle');
  const closeBtn = document.getElementById('cpClose');
  const cancelBtn = document.getElementById('cpCancel');
  const okBtn = document.getElementById('cpOK');

  const sv = document.getElementById('cpSV');
  const hue = document.getElementById('cpHue');
  const alpha = document.getElementById('cpAlpha');

  const cursor = document.getElementById('cpCursor');
  const hueCursor = document.getElementById('cpHueCursor');
  const alphaCursor = document.getElementById('cpAlphaCursor');

  const newChip = document.getElementById('cpNew');
  const oldChip = document.getElementById('cpOld');

  const hexInput = document.getElementById('cpHex');
  const rIn = document.getElementById('cpR');
  const gIn = document.getElementById('cpG');
  const bIn = document.getElementById('cpB');
  const aIn = document.getElementById('cpA');

  const swatchWrap = document.getElementById('cpSwatches');

  let suspendApply = false;
  let oldRawColor = null;     // original attribute string or null
  let oldRawOpacity = null;   // original opacity string or null

  let targetAttr = 'stroke';
  let hsv = { h: 0, s: 1, v: 1 };
  let a = 1;
  let old = { r:0,g:0,b:0,a:1 };
  let dragging = null; // 'sv' | 'hue' | 'alpha'
  let didSnapshot = false;

  function drawHue() {
    const ctx = hue.getContext('2d');
    const w = hue.width, hgt = hue.height;
    const grd = ctx.createLinearGradient(0,0,0,hgt);
    for (let i=0;i<=360;i+=60) grd.addColorStop(i/360, `hsl(${i},100%,50%)`);
    ctx.clearRect(0,0,w,hgt);
    ctx.fillStyle = grd;
    ctx.fillRect(0,0,w,hgt);
  }

  function drawSV() {
    const ctx = sv.getContext('2d');
    const w = sv.width, hgt = sv.height;

    ctx.clearRect(0,0,w,hgt);
    ctx.fillStyle = `hsl(${hsv.h},100%,50%)`;
    ctx.fillRect(0,0,w,hgt);

    const g1 = ctx.createLinearGradient(0,0,w,0);
    g1.addColorStop(0, '#fff');
    g1.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g1;
    ctx.fillRect(0,0,w,hgt);

    const g2 = ctx.createLinearGradient(0,0,0,hgt);
    g2.addColorStop(0, 'rgba(0,0,0,0)');
    g2.addColorStop(1, '#000');
    ctx.fillStyle = g2;
    ctx.fillRect(0,0,w,hgt);
  }

  function drawAlphaStrip(r,g,b) {
    const ctx = alpha.getContext('2d');
    const w = alpha.width, hgt = alpha.height;

    // checker
    const size = 6;
    ctx.clearRect(0,0,w,hgt);
    for (let y=0;y<hgt;y+=size){
      for (let x=0;x<w;x+=size){
        ctx.fillStyle = ((x/size + y/size) % 2 === 0) ? '#2a2a2a' : '#1b1b1b';
        ctx.fillRect(x,y,size,size);
      }
    }

    const grd = ctx.createLinearGradient(0,0,0,hgt);
    grd.addColorStop(0, rgbaCss(r,g,b,1));
    grd.addColorStop(1, rgbaCss(r,g,b,0));
    ctx.fillStyle = grd;
    ctx.fillRect(0,0,w,hgt);
  }

  function beginInteraction() {
    if (!didSnapshot && selectedElement) {
      snapshotDocHistory();
      didSnapshot = true;
    }
  }

  function applyToElement() {
    if (!selectedElement) return;
    if (suspendApply) return;

    const [rr, gg, bb] = hsvToRgb(hsv.h, hsv.s, hsv.v);
    const hex = rgbToHex(rr, gg, bb);

    if (targetAttr === 'stroke') {
      selectedElement.setAttribute('stroke', hex);

      // If alpha is 0, you can either hide stroke or keep stroke-opacity=0
      // Here we keep it, but with opacity:
      selectedElement.setAttribute('stroke-opacity', a.toFixed(3));
    }

    if (targetAttr === 'fill') {
      // IMPORTANT: keep fill transparent when alpha=0
      if (a <= 0.001) {
        // preserve "no fill" behavior
        selectedElement.setAttribute('fill', 'none');
        selectedElement.removeAttribute('fill-opacity');
      } else {
        selectedElement.setAttribute('fill', hex);
        selectedElement.setAttribute('fill-opacity', a.toFixed(3));
      }
    }
  }

  function updateChipsInInspector() {
    const strokeChip = document.getElementById('strokeChip');
    const fillChip = document.getElementById('fillChip');
    if (!selectedElement) return;
    if (strokeChip) strokeChip.style.background = selectedElement.getAttribute('stroke') || '#000000';
    if (fillChip) fillChip.style.background = selectedElement.getAttribute('fill') || 'transparent';
  }

  function updateUI() {
    const [rr,gg,bb] = hsvToRgb(hsv.h, hsv.s, hsv.v);

    drawSV();
    drawAlphaStrip(rr,gg,bb);

    newChip.style.background = rgbaCss(rr,gg,bb,a);
    hexInput.value = rgbToHex(rr,gg,bb).toUpperCase();

    rIn.value = rr; gIn.value = gg; bIn.value = bb;
    aIn.value = Math.round(a * 100);

    // cursors
    const svRect = sv.getBoundingClientRect();
    cursor.style.left = `${hsv.s * svRect.width}px`;
    cursor.style.top = `${(1 - hsv.v) * svRect.height}px`;

    const hueRect = hue.getBoundingClientRect();
    hueCursor.style.top = `${(hsv.h / 360) * hueRect.height}px`;

    const aRect = alpha.getBoundingClientRect();
    alphaCursor.style.top = `${(1 - a) * aRect.height}px`;

    applyToElement();
    updateInspector();
    updateChipsInInspector();
  }

  function pickSV(clientX, clientY) {
    const rect = sv.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    const y = clamp(clientY - rect.top, 0, rect.height);
    hsv.s = x / rect.width;
    hsv.v = 1 - (y / rect.height);
    updateUI();
  }

  function pickHue(clientY) {
    const rect = hue.getBoundingClientRect();
    const y = clamp(clientY - rect.top, 0, rect.height);
    hsv.h = (y / rect.height) * 360;
    updateUI();
  }

  function pickAlpha(clientY) {
    const rect = alpha.getBoundingClientRect();
    const y = clamp(clientY - rect.top, 0, rect.height);
    a = 1 - (y / rect.height);
    updateUI();
  }

  function setFromRGBA(r,g,b,aa) {
    hsv = rgbToHsv(r,g,b);
    a = clamp(aa, 0, 1);
    updateUI();
  }

  function open(attr) {
    if (!selectedElement) return;

    targetAttr = attr;
    title.textContent = (attr === 'stroke') ? 'Stroke Color' : 'Fill Color';

    didSnapshot = false;
    dragging = null;

    // store raw originals so Cancel restores EXACTLY
    oldRawColor = selectedElement.getAttribute(attr);
    oldRawOpacity = selectedElement.getAttribute(attr === 'stroke' ? 'stroke-opacity' : 'fill-opacity');

    // Determine current RGBA
    let rgb = { r: 0, g: 0, b: 0 };
    let oa = 1;

    const cur = (oldRawColor || '').trim().toLowerCase();

    if (attr === 'fill' && (!oldRawColor || cur === 'none' || cur === 'transparent')) {
      // If fill is not set / none / transparent -> treat as fully transparent
      oa = 0;
      rgb = { r: 0, g: 0, b: 0 }; // color irrelevant if alpha=0
    } else {
      const curHex = oldRawColor || '#000000';
      const parsed = hexToRgb(curHex);
      if (parsed) rgb = parsed;

      const opAttr = (attr === 'stroke') ? 'stroke-opacity' : 'fill-opacity';
      const parsedA = parseFloat(selectedElement.getAttribute(opAttr) || '1');
      oa = Number.isFinite(parsedA) ? parsedA : 1;
    }

    old = { ...rgb, a: oa };
    oldChip.style.background = rgbaCss(old.r, old.g, old.b, old.a);

    drawHue();

    // ✅ show modal UI
    backdrop.classList.remove('hidden');
    root.classList.remove('hidden');

    // ✅ IMPORTANT: don't apply while opening
    suspendApply = true;
    setFromRGBA(rgb.r, rgb.g, rgb.b, oa);
    suspendApply = false;
  }

  function close() {
    root.classList.add('hidden');
    backdrop.classList.add('hidden');
    dragging = null;
  }

  // dragging
  sv.addEventListener('pointerdown', e => {
    beginInteraction();
    dragging = 'sv';
    pickSV(e.clientX, e.clientY);
    sv.setPointerCapture(e.pointerId);
  });
  sv.addEventListener('pointermove', e => { if (dragging==='sv') pickSV(e.clientX, e.clientY); });
  sv.addEventListener('pointerup', () => { if(dragging==='sv') dragging=null; });

  hue.addEventListener('pointerdown', e => {
    beginInteraction();
    dragging = 'hue';
    pickHue(e.clientY);
    hue.setPointerCapture(e.pointerId);
  });
  hue.addEventListener('pointermove', e => { if (dragging==='hue') pickHue(e.clientY); });
  hue.addEventListener('pointerup', () => { if(dragging==='hue') dragging=null; });

  alpha.addEventListener('pointerdown', e => {
    beginInteraction();
    dragging = 'alpha';
    pickAlpha(e.clientY);
    alpha.setPointerCapture(e.pointerId);
  });
  alpha.addEventListener('pointermove', e => { if (dragging==='alpha') pickAlpha(e.clientY); });
  alpha.addEventListener('pointerup', () => { if(dragging==='alpha') dragging=null; });

  // inputs
  hexInput.addEventListener('change', () => {
    const rgb = hexToRgb(hexInput.value);
    if (!rgb) return;
    beginInteraction();
    setFromRGBA(rgb.r, rgb.g, rgb.b, a);
  });

  function onRGBAInput() {
    const r = clamp(parseInt(rIn.value||'0',10),0,255);
    const g = clamp(parseInt(gIn.value||'0',10),0,255);
    const b = clamp(parseInt(bIn.value||'0',10),0,255);
    const aa = clamp((parseInt(aIn.value||'100',10)/100),0,1);
    beginInteraction();
    setFromRGBA(r,g,b,aa);
  }
  [rIn,gIn,bIn,aIn].forEach(i => i.addEventListener('change', onRGBAInput));

  // swatches
  const swatches = [
    '#000000','#404040','#808080','#C0C0C0','#FFFFFF',
    '#7F0000','#FF0000','#FF7F00','#FFFF00','#00FF00',
    '#007F00','#00FFFF','#0000FF','#7F00FF','#FF00FF',
    '#7F007F','#8B4513','#D2691E','#F4A460','#FFD700'
  ];
  swatchWrap.innerHTML = '';
  swatches.forEach(hx => {
    const btn = document.createElement('button');
    btn.className = 'cp-swatch-btn';
    btn.type = 'button';
    btn.style.background = hx;
    btn.addEventListener('click', () => {
      const rgb = hexToRgb(hx);
      if (!rgb) return;
      beginInteraction();
      setFromRGBA(rgb.r, rgb.g, rgb.b, a);
    });
    swatchWrap.appendChild(btn);
  });

  // buttons
  closeBtn.onclick = close;

  cancelBtn.onclick = () => {
    if (selectedElement) {
      const opAttr = (targetAttr === 'stroke') ? 'stroke-opacity' : 'fill-opacity';

      // restore color attribute EXACTLY
      if (oldRawColor == null) selectedElement.removeAttribute(targetAttr);
      else selectedElement.setAttribute(targetAttr, oldRawColor);

      // restore opacity attribute EXACTLY
      if (oldRawOpacity == null) selectedElement.removeAttribute(opAttr);
      else selectedElement.setAttribute(opAttr, oldRawOpacity);
    }

    updateInspector();
    updateChipsInInspector();
    close();
  };

  okBtn.onclick = () => {
    updateInspector();
    updateChipsInInspector();
    close();
  };

  return { open, close };
})();

document.getElementById('pickStroke')?.addEventListener('click', () => {
  if (!selectedElement) return;
  CP.open('stroke');
});

document.getElementById('pickFill')?.addEventListener('click', () => {
  if (!selectedElement) return;
  CP.open('fill');
});

function updateInspector() {
  // Nothing selected
  if (!selectedElement) {
    inspectorEmpty.style.display = 'block';
    inspectorPath.classList.add('hidden');

    const strokeChip = document.getElementById('strokeChip');
    const fillChip = document.getElementById('fillChip');
    if (strokeChip) strokeChip.style.background = '#000000';
    if (fillChip) fillChip.style.background = 'transparent';
    return;
  }

  const tag = (selectedElement.tagName || '').toLowerCase();

  // ✅ Show inspector for shape elements (path/rect/ellipse etc.)
  const supportsAppearance = ['path', 'rect', 'ellipse', 'polygon', 'polyline', 'line'].includes(tag);

  if (!supportsAppearance) {
    inspectorEmpty.style.display = 'block';
    inspectorPath.classList.add('hidden');
    return;
  }

  inspectorEmpty.style.display = 'none';
  inspectorPath.classList.remove('hidden');

  // stroke width
  strokeWidthInput.value = selectedElement.getAttribute('stroke-width') || 1;

  // update chips
  const strokeChip = document.getElementById('strokeChip');
  const fillChip = document.getElementById('fillChip');

  const stroke = selectedElement.getAttribute('stroke') || '#000000';
  const fill = selectedElement.getAttribute('fill') || 'transparent';

  if (strokeChip) strokeChip.style.background = stroke;

  // if no fill, show transparent chip
  if (fillChip) {
    const f = (fill || '').toLowerCase();
    fillChip.style.background = (f === 'none' || f === 'transparent' || f === '') ? 'transparent' : fill;
  }
}

/* ----------------------------------------------------------------------------- */
/* ------------------------- Convert object to symbol -------------------------- */
/* ----------------------------------------------------------------------------- */
function convertToSymbol(elements) {
  if (!elements || !elements.length) return;

  snapshotDocHistory();

  elements.forEach(el => {
    setIsLayer(el, true);
    ensureUID(el);
    el.dataset.symbol = 'true';
    el.dataset.locked = 'true';

    // ✅ DO NOT move it to contentLayer
    // keep it where it is (inside g[data-tl])
  });

  newElements = [];
  updateLayersPanel();
}

/* ----------------------------------------------------------------------------- */
/* ---------------------------- Layer panel logic ------------------------------ */
/* ----------------------------------------------------------------------------- */
function updateLayersPanel() {
  const list = document.getElementById('layersList');
  if (!list) return;

  list.innerHTML = '';

  // newest first
  const assets = [...libraryAssets.entries()].reverse();

  assets.forEach(([assetId, asset]) => {
    const item = document.createElement('div');
    item.className = 'layer-item';
    if (assetId === selectedLibraryAssetId) item.classList.add('selected');

    const row = document.createElement('div');
    row.className = 'layer-row';

    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = asset.name || '(unnamed)';
    name.dataset.assetId = assetId; // ✅ add this

    row.appendChild(name);
    item.appendChild(row);
    list.appendChild(item);

    // ✅ click in library DOES NOT select stage
    item.onclick = (e) => {
      if (isRenamingLayer) return;
      e.stopPropagation();
      setLibrarySelection(assetId);
    };

    // ✅ make draggable for drag-drop to stage
    item.draggable = true;

    item.addEventListener('dragstart', (e) => {
      libraryHasFocus = true;
      e.dataTransfer.setData('text/asset-id', assetId);
      e.dataTransfer.effectAllowed = 'copy';
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();      // ✅ prevents your document-level contextmenu handler
      setLibrarySelection(assetId);
      updateLibraryPreview?.();
      showLibMenu(e.clientX, e.clientY, assetId);
    });

    // ✅ rename asset
    name.ondblclick = (e) => {
      e.stopPropagation();
      isRenamingLayer = true;

      name.textContent = asset.name || '';
      name.contentEditable = 'true';
      name.classList.add('editing');
      name.focus();

      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(name);
      sel.addRange(range);
    };

    name.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        name.textContent = asset.name || '';
        name.blur();
      }
    };

    name.onblur = () => {
      name.contentEditable = 'false';
      name.classList.remove('editing');

      const newName = name.textContent.trim();
      if (newName) {
        asset.name = newName;

        // optional: update instances display names
        contentLayer.querySelectorAll(`g[data-tl] > image[data-asset-id="${assetId}"]`).forEach(inst => {
          inst.dataset.assetName = newName;
          inst.setAttribute('data-layer-name', newName);
        });
      }

      isRenamingLayer = false;
      updateLayersPanel();
    };
  });
}

//--------------- On new drawing increase the object name bunber -------------
function getNextLayerName(el) {
  let type = el.tagName.toUpperCase();

  // ✅ make imported images show "Image" instead of "IMAGE"
  if (type === 'IMAGE') type = 'Image';

  let max = 0;

  const all = [...contentLayer.querySelectorAll('g[data-tl] > *')];

  all.forEach(node => {
    if (node === el) return;
    const name = node.getAttribute('data-layer-name');
    if (!name) return;

    const m = name.match(new RegExp(`^${type} (\\d+)$`));
    if (m) max = Math.max(max, parseInt(m[1], 10));
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
  ensurePointsModel(path);

  const pts = path.__points;
  if (!pts || !pts.length) return [];

  // Anchor = end point of each command (M/L/Q)
  return pts.map(p => ({ x: p.x, y: p.y }));
}

function getQuadraticHandlesFromPath(path) {
  ensurePointsModel(path);

  const pts = path.__points;
  if (!pts || !pts.length) return [];

  // Handle exists only for Q commands
  // Return in the same format you already consume: {cx,cy,x,y}
  return pts
    .map(p => {
      if (p.type !== 'Q') return null;
      return { cx: p.cx, cy: p.cy, x: p.x, y: p.y };
    })
    .filter(Boolean);
}

function getCubicHandlesFromPath(path) {
  ensurePointsModel(path);

  const pts = path.__points;
  if (!pts || pts.length < 2) return [];

  const out = [];
  let prev = pts[0]; // M

  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];

    if (p.type === 'C') {
      // handle 1 is anchored at PREVIOUS anchor
      out.push({
        kind: 'c1',
        pointIndex: i,
        x: prev.x, y: prev.y,
        cx: p.c1x, cy: p.c1y
      });

      // handle 2 is anchored at CURRENT anchor
      out.push({
        kind: 'c2',
        pointIndex: i,
        x: p.x, y: p.y,
        cx: p.c2x, cy: p.c2y
      });
    }

    // advance "prev anchor"
    prev = p;
  }

  return out;
}

function rebuildPathFromPoints(path) {
  // ✅ never rebuild ellipse from __points (it uses A arcs)
  if (path.__shape === 'ellipse') return;

  const pts = path.__points;
  if (!pts || !pts.length) return;

  let d = '';

  pts.forEach((p, i) => {
    if (p.type === 'M') d += `M ${p.x} ${p.y}`;
    if (p.type === 'L') d += ` L ${p.x} ${p.y}`;
    if (p.type === 'Q') d += ` Q ${p.cx} ${p.cy} ${p.x} ${p.y}`;
    if (p.type === 'C') d += ` C ${p.c1x} ${p.c1y} ${p.c2x} ${p.c2y} ${p.x} ${p.y}`;
  });

  // ✅ keep closed shapes closed (rect path uses Z)
  if (path.__closed) d += ' Z';

  path.setAttribute('d', d);
}

function deleteAnchorAtIndex(path, index) {
  ensurePointsModel(path);

  const pts = path.__points;
  if (!pts || pts.length <= 0) return;

  snapshotAnchorHistory(); // 🔥 push state BEFORE delete

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
  ensurePointsModel(path);

  const pts = path.__points;
  if (!pts || pts.length < 2) return;

  snapshotAnchorHistory(); // 🔥 push state BEFORE delete

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
  // ✅ SPECIAL CASE: ellipse paths are arc-based (A commands) → DO NOT parse/rebuild as M/L/Q
  if (path.__shape === 'ellipse' && path.__ellipse) {
    drawEllipseControls(path);
    return;
  }

  ensurePointsModel(path);

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

  // ✅ constant-size UI in screen pixels
  const px = 1 / camScale;          // 1 screen px in world units
  const ANCHOR_R_PX = 4;
  const HANDLE_R_PX = 4;

  // Use your editable model (local coords)
  const pts = path.__points || [];

  // Build anchor list from __points (local)
  const anchors = pts
    .map((p, pointIndex) => ({ pointIndex, type: p.type, x: p.x, y: p.y }))
    .filter(p => p.type === 'M' || p.type === 'L' || p.type === 'Q' || p.type === 'C');

  anchors.forEach((pt, index) => {
    const w = localToWorld(path, pt.x, pt.y);

    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', w.x);
    c.setAttribute('cy', w.y);
    c.setAttribute('r', ANCHOR_R_PX * px); // ✅ stays same on screen
    c.classList.add('control-point');

    // ✅ stroke doesn't scale
    uiNonScaling(c);

    if (path === selectedAnchorPath && pt.pointIndex === selectedAnchorIndex) {
      c.style.fill = '#007aff';
    }

    c.dataset.pointIndex = String(pt.pointIndex);
    c.__path = path;

    c.addEventListener('pointerdown', e => {
      e.stopPropagation();
      const idx = parseInt(c.dataset.pointIndex, 10);

      if (activeTool === 'delete-anchor') {
        snapshotAnchorHistory();
        deleteAnchorAtIndex(path, idx);
        return;
      }

      if (activeTool === 'join-anchor') {
        snapAnchorsIfClose(selectedAnchorPath, selectedAnchorIndex);
        return;
      }

      if (activeTool !== 'edit') return;

      selectedAnchorPath = path;
      selectedAnchorIndex = idx;
      activeControlPoint = c;

      snapshotAnchorHistory();

      draggingAnchor = idx;
      draggingPath = path;
      activeAnchorIndex = idx;

      timelineBeforeMutate('copy');

      const ptData = path.__points[idx];

      // ✅ store start in LOCAL coords, and also store mouse in LOCAL coords
      const worldMouse = getSVGPoint(e);
      const localMouse = worldToLocal(path, worldMouse.x, worldMouse.y);

      c.__start = {
        x: ptData.x,
        y: ptData.y,
        mouseLocalX: localMouse.x,
        mouseLocalY: localMouse.y
      };

      svg.setPointerCapture(e.pointerId);
    });

    editLayer.appendChild(c);
  });

  // ---- Quadratic Bezier handles ----
  const handles = getQuadraticHandlesFromPath(path);

  handles.forEach((handle, qIndex) => {
    const wAnchor = localToWorld(path, handle.x, handle.y);
    const wCtrl   = localToWorld(path, handle.cx, handle.cy);

    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', wAnchor.x);
    line.setAttribute('y1', wAnchor.y);
    line.setAttribute('x2', wCtrl.x);
    line.setAttribute('y2', wCtrl.y);
    line.classList.add('bezier-handle-line');

    // ✅ stroke doesn't scale
    uiNonScaling(line);

    editLayer.appendChild(line);

    const point = document.createElementNS(NS, 'circle');
    point.setAttribute('cx', wCtrl.x);
    point.setAttribute('cy', wCtrl.y);
    point.setAttribute('r', HANDLE_R_PX * px); // ✅ stays same on screen
    point.classList.add('bezier-handle');

    // ✅ stroke doesn't scale (you missed this earlier)
    uiNonScaling(point);

    point.__handleTarget = handle;           // {cx,cy,x,y}
    point.__pathTarget = path;
    point.__pointIndex = qPointIndices[qIndex];          // ✅ correct Q index
    point.dataset.pointIndex = String(qPointIndices[qIndex]); // ✅ optional but good

    enableBezierHandleDrag(point);
    editLayer.appendChild(point);
  });

  const cubicHandles = getCubicHandlesFromPath(path);

  cubicHandles.forEach((handle) => {
    const wAnchor = localToWorld(path, handle.x, handle.y);
    const wCtrl   = localToWorld(path, handle.cx, handle.cy);

    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', wAnchor.x);
    line.setAttribute('y1', wAnchor.y);
    line.setAttribute('x2', wCtrl.x);
    line.setAttribute('y2', wCtrl.y);
    line.classList.add('bezier-handle-line');
    uiNonScaling(line);
    editLayer.appendChild(line);

    const point = document.createElementNS(NS, 'circle');
    point.setAttribute('cx', wCtrl.x);
    point.setAttribute('cy', wCtrl.y);
    point.setAttribute('r', HANDLE_R_PX * px);
    point.classList.add('bezier-handle');
    uiNonScaling(point);

    // used by the drag code
    point.__handleTarget = handle;   // {cx,cy,...}
    point.__pathTarget   = path;
    point.__pointIndex   = handle.pointIndex;
    point.__handleKind   = handle.kind; // 'c1' or 'c2'

    point.dataset.kind = handle.kind;                 // "c1" or "c2"
    point.dataset.pointIndex = String(handle.pointIndex);

    enableBezierHandleDrag(point);
    editLayer.appendChild(point);
  });
}

function clearControlPoints() {
  editLayer.innerHTML = '';
}

function drawEllipseControls(path) {
  // path must be a special ellipse-path
  const data = path.__ellipse;
  if (!data) return;

  editLayer.innerHTML = '';

  const { cx, cy, rx, ry } = data;

  // world points
  const wRX = localToWorld(path, cx + rx, cy);
  const wRY = localToWorld(path, cx, cy + ry);

  const makeHandle = (worldPt, kind) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', worldPt.x);
    c.setAttribute('cy', worldPt.y);
    c.setAttribute('r', 5);
    c.classList.add('control-point');
    c.dataset.kind = kind; // 'rx' or 'ry'

    c.addEventListener('pointerdown', e => {
      e.stopPropagation();
      if (activeTool !== 'edit') return;

      snapshotDocHistory();

      draggingPath = path;
      draggingAnchor = `ellipse-${kind}`;
      activeControlPoint = c;

      timelineBeforeMutate('copy');

      const worldMouse = getSVGPoint(e);
      const localMouse = worldToLocal(path, worldMouse.x, worldMouse.y);

      c.__start = {
        cx: data.cx, cy: data.cy,
        rx: data.rx, ry: data.ry,
        mouseLocalX: localMouse.x,
        mouseLocalY: localMouse.y
      };

      svg.setPointerCapture(e.pointerId);
    });

    editLayer.appendChild(c);
  };

  makeHandle(wRX, 'rx');
  makeHandle(wRY, 'ry');
}

//--------------- Draw selection boxes -----------------
function drawSelectionBoxes() {
  if (activeTool !== 'transform') {
    selectionLayer.innerHTML = '';
    return;
  }

  selectionLayer.innerHTML = '';

  // 1 screen px == (1/camScale) world units
  const px = 1 / camScale;

  const HANDLE_PX = 8;              // desired on-screen size
  const ROTATE_R_PX = 6;
  const ROTATE_OFFSET_PX = 24;

  const handleSize = HANDLE_PX * px;
  const rotateR = ROTATE_R_PX * px;
  const rotateOffset = ROTATE_OFFSET_PX * px;

  selectedElements.forEach(el => {
    const b = el.getBBox();
    const m = getLocalDOMMatrix(el);

    const tl = new DOMPoint(b.x, b.y).matrixTransform(m);
    const tr = new DOMPoint(b.x + b.width, b.y).matrixTransform(m);
    const br = new DOMPoint(b.x + b.width, b.y + b.height).matrixTransform(m);
    const bl = new DOMPoint(b.x, b.y + b.height).matrixTransform(m);

    const g = document.createElementNS(NS, 'g');
    g.classList.add('selection-rect-group');

    const poly = document.createElementNS(NS, 'polygon');
    poly.setAttribute('points', `${tl.x},${tl.y} ${tr.x},${tr.y} ${br.x},${br.y} ${bl.x},${bl.y}`);
    poly.classList.add('selection-rect');
    poly.setAttribute('fill', 'transparent');
    poly.setAttribute('pointer-events', 'all');

    // ✅ stroke stays same thickness on screen
    poly.setAttribute('vector-effect', 'non-scaling-stroke');

    g.appendChild(poly);

    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    const positions = [
      { id: 'nw', p: tl },
      { id: 'n',  p: mid(tl, tr) },
      { id: 'ne', p: tr },
      { id: 'e',  p: mid(tr, br) },
      { id: 'se', p: br },
      { id: 's',  p: mid(bl, br) },
      { id: 'sw', p: bl },
      { id: 'w',  p: mid(tl, bl) }
    ];

    positions.forEach(({ id, p }) => {
      const handle = document.createElementNS(NS, 'rect');
      handle.setAttribute('x', p.x - handleSize / 2);
      handle.setAttribute('y', p.y - handleSize / 2);
      handle.setAttribute('width', handleSize);
      handle.setAttribute('height', handleSize);
      handle.classList.add('handle-rect');
      handle.dataset.handle = id;

      handle.setAttribute('fill', 'white');
      handle.setAttribute('stroke', '#007aff');
      handle.setAttribute('stroke-width', 1 * px); // (optional) constant-ish if you don’t rely on vector-effect
      handle.setAttribute('vector-effect', 'non-scaling-stroke');
      handle.setAttribute('pointer-events', 'all');

      g.appendChild(handle);
    });

    const topMid = mid(tl, tr);

    const cx = (tl.x + tr.x + br.x + bl.x) / 4;
    const cy = (tl.y + tr.y + br.y + bl.y) / 4;

    let ex = tr.x - tl.x, ey = tr.y - tl.y;
    let nx = -ey, ny = ex;
    const nlen = Math.hypot(nx, ny) || 1;
    nx /= nlen; ny /= nlen;

    const toCenterX = topMid.x - cx;
    const toCenterY = topMid.y - cy;
    if (nx * toCenterX + ny * toCenterY < 0) { nx = -nx; ny = -ny; }

    const rx = topMid.x + nx * rotateOffset;
    const ry = topMid.y + ny * rotateOffset;

    const rLine = document.createElementNS(NS, 'line');
    rLine.classList.add('rotate-handle-line');
    rLine.setAttribute('x1', topMid.x);
    rLine.setAttribute('y1', topMid.y);
    rLine.setAttribute('x2', rx);
    rLine.setAttribute('y2', ry);
    rLine.setAttribute('vector-effect', 'non-scaling-stroke'); // ✅
    g.appendChild(rLine);

    const rHandle = document.createElementNS(NS, 'circle');
    rHandle.classList.add('rotate-handle');
    rHandle.setAttribute('cx', rx);
    rHandle.setAttribute('cy', ry);
    rHandle.setAttribute('r', rotateR); // ✅ constant pixel size
    rHandle.dataset.rotate = '1';
    rHandle.setAttribute('vector-effect', 'non-scaling-stroke');
    g.appendChild(rHandle);

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
    const startM = startTransforms.get(el) || new DOMMatrix();

    // ✅ apply move without destroying scale/rotate
    const moveM = new DOMMatrix().translate(dx, dy);
    const nextM = moveM.multiply(startM);

    setLocalDOMMatrix(el, nextM);
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
  handleEl.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    e.stopPropagation();

    // keep move events flowing to svg (your app uses svg pointermove)
    try { svg.setPointerCapture(e.pointerId); } catch (_) {}

    isHandleDragging = true;
    draggingAnchor = 'bezier';

    var path = handleEl.__pathTarget;
    if (!path) return;

    draggingPath = path; // ✅ required (your pointermove guard uses this)

    timelineBeforeMutate('copy');

    // Make sure model exists (and is cubic now)
    ensurePointsModel(path);

    // Which handle on which segment
    var kind = (handleEl.dataset && handleEl.dataset.kind) || handleEl.__handleKind || 'c1';
    var pointIndex = parseInt(
      (handleEl.dataset && handleEl.dataset.pointIndex) || handleEl.__pointIndex,
      10
    );

    var p = path.__points[pointIndex];
    if (!p || p.type !== 'C') return;

    // mouse in LOCAL path space
    var ptW = getSVGPoint(e);
    var localMouse = worldToLocal(path, ptW.x, ptW.y);

    // starting control point
    var startCX, startCY;
    if (kind === 'c1') { startCX = p.c1x; startCY = p.c1y; }
    else              { startCX = p.c2x; startCY = p.c2y; }

    activeHandle = {
      path: path,
      pointIndex: pointIndex,
      kind: kind,
      startCX: startCX,
      startCY: startCY,
      startMouseX: localMouse.x,
      startMouseY: localMouse.y
    };
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

  // ✅ HANDLE SCALE DRAG (put your block here)
  if (isHandleDragging && handleDrag) {
    const pt = getSVGPoint(e);

    const dot = (a, b) => a.x * b.x + a.y * b.y;

    const ax = handleDrag.anchor.x;
    const ay = handleDrag.anchor.y;

    // vector from anchor to mouse (WORLD)
    const vec = { x: pt.x - ax, y: pt.y - ay };

    // project onto rotated axes
    let du = dot(vec, handleDrag.u); // along u
    let dv = dot(vec, handleDrag.v); // along v

    // base scale factors
    let sx = 1, sy = 1;

    // which axes this handle is allowed to scale
    const id = handleDrag.handleId;

    const scalesU = (id === 'nw' || id === 'ne' || id === 'se' || id === 'sw' || id === 'e' || id === 'w');
    const scalesV = (id === 'nw' || id === 'ne' || id === 'se' || id === 'sw' || id === 'n' || id === 's');

    // for side handles, lock the other axis
    if (id === 'n' || id === 's') du = handleDrag.w;
    if (id === 'e' || id === 'w') dv = handleDrag.h;

    // use absolute sizes (allows flip if you cross; keep it if you like)
    const newW = Math.max(1e-6, Math.abs(du));
    const newH = Math.max(1e-6, Math.abs(dv));

    if (scalesU) sx = newW / handleDrag.w;
    if (scalesV) sy = newH / handleDrag.h;

    // Shift = uniform scale
    if (handleDrag.keepAspect) {
      const uni = Math.max(sx, sy);
      sx = uni;
      sy = uni;
    }

    // build scale matrix in rotated basis about anchor:
    // T(a) * R(theta) * S(sx,sy) * R(-theta) * T(-a)
    const deg = (handleDrag.theta * 180) / Math.PI;

    const scaleAboutAnchorRotBasis =
      new DOMMatrix()
        .translate(ax, ay)
        .rotate(deg)
        .scale(sx, sy)
        .rotate(-deg)
        .translate(-ax, -ay);

    handleDrag.starts.forEach(({ el, m }) => {
      const next = scaleAboutAnchorRotBasis.multiply(m);
      setLocalDOMMatrix(el, next);
    });

    drawSelectionBoxes();
    return;
  }

  // Object rotation
  if (isRotateDragging && rotateDrag) {
    const pt = getSVGPoint(e);

    const { cx, cy } = rotateDrag;

    const ang = Math.atan2(pt.y - cy, pt.x - cx);
    let delta = ang - rotateDrag.startAngle;

    // Shift = snap 15°
    if (rotateDrag.snap) {
      const step = (15 * Math.PI) / 180;
      delta = Math.round(delta / step) * step;
    }

    const rotAboutCenter =
      new DOMMatrix()
        .translate(cx, cy)
        .rotate((delta * 180) / Math.PI)
        .translate(-cx, -cy);

    rotateDrag.starts.forEach(({ el, m }) => {
      const next = rotAboutCenter.multiply(m);
      setLocalDOMMatrix(el, next);
    });

    drawSelectionBoxes();
    return;
  }

  // Rectangle draw has priority while dragging
  if (activeTool === 'rectangle' && rectDrawing) {
    handleRectangleMove(e);
    return;
  }

  // Ellipse draw has priority while dragging
  if (activeTool === 'ellipse' && ellipseDrawing) {
    handleEllipseMove(e);
    return;
  }

  /*--------------- Left toolbar -----------------*/
  if (activeTool === 'draw') {
    timelineBeforeMutate('copy');
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

window.addEventListener('mouseup', (event) => {
  ignoreDeselect = false; // ✅ ADD THIS FIRST LINE

  if (isHandleDragging) {
    isHandleDragging = false;
    handleDrag = null;
  }

  // ✅ ROTATE STOP — PUT THIS HERE
  if (isRotateDragging) {
    isRotateDragging = false;
    rotateDrag = null;
  }

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

  if (rectDrawing && activeTool === 'rectangle') {
    handleRectangleEnd(event); // use the mouse event
  }

  if (ellipseDrawing && activeTool === 'ellipse') {
    handleEllipseEnd(event);
  }

  if (drawing) {
    drawing = false;

    if (activeFreehandPath) {
      activeFreehandPath.setAttribute('d', simplifyPath(activeFreehandPath.getAttribute('d')));
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

window.addEventListener('pointerup', function () {
  if (draggingAnchor === 'bezier') {
    isHandleDragging = false;
    draggingAnchor = null;
    activeHandle = null;
  }
});

window.addEventListener('keydown', e => {
  // Ignore if user is typing in an input (future-safe)
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  // Redo
  if (e.ctrlKey && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
    return;
  }

  // Undo
  if (e.ctrlKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
    return;
  }

  // Duplicate path
  if (e.ctrlKey && e.key.toLowerCase() === 'd') {
    if (selectedElements.length) {
      e.preventDefault();
      duplicateSelected();
    }
  }

  // Delete path
  if (e.key === 'Delete') {
    // ✅ if library is focused -> delete asset + all instances
    if (libraryHasFocus && selectedLibraryAssetId) {
      e.preventDefault();
      deleteLibraryAsset(selectedLibraryAssetId);
      return;
    }

    // ✅ otherwise delete only selected stage instance(s)
    if (selectedElements.length) {
      e.preventDefault();
      deleteSelected();
    }
  }
});

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

const timelineRulerInner = document.getElementById('timelineRulerInner'); // ✅ ADD

const timelineBody = document.getElementById('timelineBody');
const timelineFramesViewport = document.getElementById('timelineFramesViewport');
const timelineHScroll = document.getElementById('timelineHScroll');
const timelineScrollInner = document.getElementById('timelineScrollInner');

// ---- Config ----
const totalFrames = 120;    // total number of frames
let currentFrame = 1; // 1..totalFrames
const frameWidth = 20;      // width of each frame-cell in px
const highlightStep = 5;    // highlight every 5 frames (like ruler)

let syncingTimelineScroll = false;

// ---------------- Timeline state ----------------
let timelineLayerCount = 0;
let activeTimelineLayerId = null;

// --- Drag-scrub playhead ONLY on the ruler ---
let rulerScrubbing = false;
let rulerPointerId = null;

function updateTimelineScrollWidth() {
  if (!timelineHScroll || !timelineScrollInner || !timelineRulerInner) return;

  const row = timelineFrames.querySelector('.frame-row');
  const rowW = row ? row.scrollWidth : (totalFrames * frameWidth);

  // How wide is the visible frames viewport?
  // Use the frames viewport width, not the scrollbar width.
  const viewW = timelineFramesViewport
    ? timelineFramesViewport.clientWidth
    : timelineHScroll.clientWidth;

  // Make scrollbar content long enough so max scroll reaches the end
  const scrollW = rowW + viewW;

  timelineScrollInner.style.width = scrollW + 'px';
  timelineScrollInner.style.minWidth = scrollW + 'px';

  timelineRulerInner.style.width = rowW + 'px';
  timelineRulerInner.style.minWidth = rowW + 'px';

  // Optional: clamp current scroll so it can't exceed the new max
  const maxScroll = Math.max(0, rowW - viewW);
  if (timelineHScroll.scrollLeft > maxScroll) timelineHScroll.scrollLeft = maxScroll;
}

function updatePlayhead() {
  if (!timelineFramesViewport || !timelineHScroll) return;

  // frame center in "timeline content space"
  const frameCenterX = (currentFrame - 1) * frameWidth + frameWidth / 2;

  // convert to viewport space by subtracting scrollLeft
  const x = frameCenterX - timelineHScroll.scrollLeft;

  playhead.style.left = `${x}px`;
}

function syncTimelineLayerRenderOrder() {
  // UI order: top -> bottom
  const ui = [...timelineLayers.querySelectorAll('.timeline-layer[data-layer-id]')];

  // SVG must be bottom -> top so top layer draws on top
  const idsBottomToTop = ui.map(el => el.dataset.layerId).reverse();

  for (const id of idsBottomToTop) {
    const g = contentLayer.querySelector(`g[data-tl="${id}"]`);
    if (g) contentLayer.appendChild(g); // move to end = above others
  }
}

// Creates (or returns) the SVG group for a timeline layer
function ensureTimelineSVGGroup(layerId) {
  let g = contentLayer.querySelector(`g[data-tl="${layerId}"]`);
  if (!g) {
    g = document.createElementNS(NS, 'g');
    g.dataset.tl = layerId;
    contentLayer.appendChild(g);
    syncTimelineLayerRenderOrder(); // ✅ IMPORTANT
  }
  return g;
}

// Select a timeline layer (UI + remember active + ensure svg group exists)
function selectTimelineLayer(layerId) {
  activeTimelineLayerId = layerId;

  // highlight left layer list
  [...timelineLayers.querySelectorAll('.timeline-layer')].forEach(el => {
    el.classList.toggle('selected', el.dataset.layerId === layerId);
  });

  // (optional) highlight frame row
  [...timelineFrames.querySelectorAll('.frame-row')].forEach(row => {
    row.classList.toggle('selected', row.dataset.layerId === layerId);
  });

  // ensure svg group exists (for future “draw only in active layer”)
  ensureTimelineSVGGroup(layerId);
  updateTimelineLayerUI(layerId);
}

// Builds a single frame row for a layer
function buildFrameRow(layerId) {
  const row = document.createElement('div');
  row.className = 'frame-row';
  row.dataset.layerId = layerId;

  for (let i = 1; i <= totalFrames; i++) {
    const cell = document.createElement('div');
    cell.className = 'frame-cell';
    cell.style.width = frameWidth + 'px';

    if (i !== 1 && i % highlightStep === 0) cell.style.backgroundColor = '#777';
    else cell.style.backgroundColor = '#525151';

    // ✅ restore the inner block for frame 1 (the thing you were seeing)
    if (i === 1) {
      const frameContentRow = document.createElement('div');
      frameContentRow.className = 'frame-content-row';
      frameContentRow.style.width = '100%';
      frameContentRow.style.height = '100%';
      frameContentRow.style.position = 'relative';
      cell.appendChild(frameContentRow);
    }

    row.appendChild(cell);
  }

  return row;
}

// Creates a new timeline layer (UI + row) and selects it
function createTimelineLayer(name) {
  timelineLayerCount++;
  const layerId = `tl_${timelineLayerCount}`;
  const layerName = name || `Layer ${timelineLayerCount}`;

  // left list item
  const layerDiv = document.createElement('div');
  layerDiv.className = 'timeline-layer';
  layerDiv.dataset.layerId = layerId;

  const nameSpan = document.createElement('span');
  nameSpan.className = 'tl-name';
  nameSpan.textContent = layerName;

  const eye = document.createElement('span');
  eye.className = 'tl-eye';
  eye.textContent = '👁';

  const lock = document.createElement('span');
  lock.className = 'tl-lock';
  lock.textContent = '🔓';

  eye.addEventListener('click', (e) => {
    e.stopPropagation();
    setTimelineLayerVisible(layerId, !isTimelineLayerVisible(layerId));
  });

  lock.addEventListener('click', (e) => {
    e.stopPropagation();
    setTimelineLayerLocked(layerId, !isTimelineLayerLocked(layerId));
  });

  // clicking the row selects the layer
  layerDiv.addEventListener('click', () => {
    // optional: don’t allow selecting a locked timeline layer
    // if (isTimelineLayerLocked(layerId)) return;
    selectTimelineLayer(layerId);
  });

  layerDiv.appendChild(nameSpan);
  layerDiv.appendChild(eye);
  layerDiv.appendChild(lock);

  timelineLayers.appendChild(layerDiv);

  // ensure defaults are reflected in UI
  updateTimelineLayerUI(layerId);

  // right frames row (append in same order as left list)
  const row = buildFrameRow(layerId);
  timelineFrames.appendChild(row);

  // make it active
  selectTimelineLayer(layerId);
  renderFrame(currentFrame);

  syncTimelineLayerRenderOrder();

  ensureTimelineLayerState(layerId);
  ensureKeyframe(layerId, 1, 'blank');  // frame 1 starts as a keyframe
  updateKeyframeCellUI(layerId, 1);
  updateHoldsUI(layerId);

  return layerId;
}

function removeTimelineLayer(layerId = activeTimelineLayerId) {
  if (!layerId) return;

  // if selection is inside the layer being removed, clear it
  if (selectedElements.some(el => el.closest('g[data-tl]')?.dataset.tl === layerId)) {
    clearSelection();
  }

  const layerItems = [...timelineLayers.querySelectorAll('.timeline-layer')];
  if (layerItems.length <= 1) {
    alert("You can't remove the last layer.");
    return;
  }

  // find the index of the layer being removed
  const idx = layerItems.findIndex(el => el.dataset.layerId === layerId);

  // pick next layer to select (prefer previous, else next)
  const nextEl =
    layerItems[idx - 1] ||
    layerItems[idx + 1] ||
    null;

  const nextId = nextEl ? nextEl.dataset.layerId : null;

  // remove left item
  const layerDiv = timelineLayers.querySelector(`.timeline-layer[data-layer-id="${layerId}"]`);
  if (layerDiv) layerDiv.remove();

  // remove frame row
  const row = timelineFrames.querySelector(`.frame-row[data-layer-id="${layerId}"]`);
  if (row) row.remove();

  // remove SVG group for this layer
  const g = contentLayer.querySelector(`g[data-tl="${layerId}"]`);
  if (g) g.remove();

  // update active selection
  activeTimelineLayerId = null;
  if (nextId) selectTimelineLayer(nextId);

  syncTimelineLayerRenderOrder();
}

function getActiveLayerGroup() {
  // if nothing selected yet, auto-pick first timeline layer
  if (!activeTimelineLayerId) {
    const first = timelineLayers.querySelector('.timeline-layer');
    if (first) selectTimelineLayer(first.dataset.layerId);
  }
  // always return a valid group
  return ensureTimelineSVGGroup(activeTimelineLayerId);
}

// ✅ Playhead (starts at center of frame 1)
const playhead = document.createElement('div');
playhead.id = 'playhead';

// frame 1 center = frameWidth/2
playhead.style.left = `${frameWidth / 2}px`;

timelineFramesViewport.appendChild(playhead);

// ---- 1. Create Layer 1 ----
createTimelineLayer('Layer 1');

// ---- 3. Create sparse frame ruler (numbers every highlightStep) ----
timelineRuler.style.display = 'flex';

timelineRulerInner.innerHTML = '';
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

  timelineRulerInner.appendChild(tick);
}

timelineRuler.addEventListener('click', (e) => {
  // click position inside ruler viewport
  const rect = timelineRuler.getBoundingClientRect();
  const localX = e.clientX - rect.left;

  // convert to timeline content space by adding horizontal scroll
  const x = localX + timelineHScroll.scrollLeft;

  // frame index from x
  const idx = Math.floor(x / frameWidth) + 1;

  currentFrame = Math.max(1, Math.min(totalFrames, idx));
  updatePlayhead();
});

wireTimelineHorizontalScroll();
updatePlayhead();

timelineFrames.addEventListener('click', (e) => {
  const cell = e.target.closest('.frame-cell');
  if (!cell) return;

  const row = cell.closest('.frame-row');
  if (!row) return;

  const idx = [...row.children].indexOf(cell);
  if (idx < 0) return;

  setCurrentFrame(idx + 1);
});

function setFrameFromRulerClientX(clientX) {
  const rect = timelineRuler.getBoundingClientRect();
  const localX = clientX - rect.left;

  // ruler viewport -> timeline content space
  const x = localX + timelineHScroll.scrollLeft;

  const idx = Math.floor(x / frameWidth) + 1;
  setCurrentFrame(idx);
}

// Click-to-jump + drag-to-scrub
timelineRuler.addEventListener('pointerdown', (e) => {
  // only left button
  if (e.button !== 0) return;

  rulerScrubbing = true;
  rulerPointerId = e.pointerId;

  // capture so dragging keeps working even if cursor leaves ruler
  timelineRuler.setPointerCapture(rulerPointerId);

  setFrameFromRulerClientX(e.clientX);
  e.preventDefault();
});

timelineRuler.addEventListener('pointermove', (e) => {
  if (!rulerScrubbing || e.pointerId !== rulerPointerId) return;
  setFrameFromRulerClientX(e.clientX);
});

function stopRulerScrub(e) {
  if (!rulerScrubbing) return;
  if (rulerPointerId != null && e.pointerId === rulerPointerId) {
    try { timelineRuler.releasePointerCapture(rulerPointerId); } catch {}
  }
  rulerScrubbing = false;
  rulerPointerId = null;
}

timelineRuler.addEventListener('pointerup', stopRulerScrub);
timelineRuler.addEventListener('pointercancel', stopRulerScrub);
timelineRuler.addEventListener('lostpointercapture', () => {
  rulerScrubbing = false;
  rulerPointerId = null;
});

function applyTimelineScrollX(x) {
  timelineFrames.style.transform = `translateX(${-x}px)`;
  timelineRulerInner.style.transform = `translateX(${-x}px)`;
}

window.addEventListener('resize', () => {
  updateTimelineScrollWidth();
  applyTimelineScrollX(timelineHScroll.scrollLeft);
});

function wireTimelineHorizontalScroll() {
  if (!timelineHScroll || !timelineScrollInner || !timelineRulerInner) return;

  updateTimelineScrollWidth();

  // ✅ IMPORTANT: don't stack listeners every reset (use onscroll)
  timelineHScroll.onscroll = () => {
    applyTimelineScrollX(timelineHScroll.scrollLeft);
    updatePlayhead();
  };

  // initial align
  applyTimelineScrollX(timelineHScroll.scrollLeft);
  updatePlayhead();
}

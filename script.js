/* script.js
   Fix: keep painting stable at window resize by using a fixed logical canvas space (800x600).
   Only this file is changed compared to previous repo: resize + coordinate mapping updated.
   Other UI (palette, buttons, etc.) is left unchanged.
*/

// ---- Constants: keep these exactly as required ----
const LOGICAL_W = 1200;
const LOGICAL_H = 720;

// ---- DOM ----
const paintCanvas = document.getElementById('paintCanvas');
const outlineCanvas = document.getElementById('outlineCanvas');
const canvasWrap = document.getElementById('canvasWrap');

const paintCtx = paintCanvas.getContext('2d');
const outlineCtx = outlineCanvas.getContext('2d');

const colorPicker = document.getElementById('colorPicker');
const pickerBottom = document.getElementById('pickerBottom');
const sizeRange = document.getElementById('sizeRange');

const defaultPaletteEl = document.getElementById('defaultPalette');
const customPaletteEl = document.getElementById('customPalette');
const addColorBtn = document.getElementById('addColorBtn');
const clearCustomBtn = document.getElementById('clearCustomBtn');

let tool = 'brush';
let currentColor = '#FF6B6B';
let size = 12;
let drawing = false;
let last = {x:0, y:0};
let currentSVGUrl = null;

// fallback files (keeps behavior if manifest missing)
const fallbackFiles = [
  "images/sample1.svg",
  "images/sample2.svg",
  "images/sample3.svg"
];

// --- Setup: initialize canvas backing buffers once (DPR-aware)
function initCanvases() {
  const dpr = window.devicePixelRatio || 1;
  // set backing store size to logical * dpr (do NOT change this on window resize)
  paintCanvas.width = Math.round(LOGICAL_W * dpr);
  paintCanvas.height = Math.round(LOGICAL_H * dpr);
  outlineCanvas.width = Math.round(LOGICAL_W * dpr);
  outlineCanvas.height = Math.round(LOGICAL_H * dpr);

  // set transform so that drawing commands use logical coordinates (0..LOGICAL_W)
  paintCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  outlineCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// --- Resize display (changes CSS size to fit container, keeps aspect ratio)
// We DO NOT change canvas.width/height here (so pixel buffer unchanged).
function resizeDisplay() {
  // compute available width inside wrapper parent (canvasWrap's parent)
  // We'll set CSS width equal to the wrapper's computed width (it is responsive), and compute height by aspect ratio.
  const wrapperRect = canvasWrap.getBoundingClientRect();
  const availableW = Math.max(40, Math.round(wrapperRect.width)); // at least tiny non-zero
  const cssW = availableW;
  const cssH = Math.round(cssW * (LOGICAL_H / LOGICAL_W));

  // set explicit height on wrapper so canvases (100%/100%) scale nicely
  canvasWrap.style.height = cssH + 'px';

  // set canvas CSS display size
  paintCanvas.style.width = cssW + 'px';
  paintCanvas.style.height = cssH + 'px';
  outlineCanvas.style.width = cssW + 'px';
  outlineCanvas.style.height = cssH + 'px';

  // re-render outline (it uses logical coords)
  if (currentSVGUrl) {
    renderSVGToOutline(currentSVGUrl).catch(err => console.error(err));
  }
}

// --- Helper: map a pointer event to logical canvas coordinates (0..LOGICAL_W/LOGICAL_H)
function getLogicalPosFromEvent(ev) {
  const rect = canvasWrap.getBoundingClientRect();
  const clientX = ev.clientX ?? (ev.touches && ev.touches[0] && ev.touches[0].clientX);
  const clientY = ev.clientY ?? (ev.touches && ev.touches[0] && ev.touches[0].clientY);
  // clientX may be undefined in rare cases; guard
  if (clientX == null || clientY == null) return { x: 0, y: 0 };

  const cssW = parseFloat(getComputedStyle(paintCanvas).width);
  const cssH = parseFloat(getComputedStyle(paintCanvas).height);

  // compute position in CSS pixels relative to canvas
  const cssX = clientX - rect.left;
  const cssY = clientY - rect.top;

  // map to logical coordinates
  const logicalX = (cssX / cssW) * LOGICAL_W;
  const logicalY = (cssY / cssH) * LOGICAL_H;
  return { x: logicalX, y: logicalY };
}

// --- Drawing stroke in logical coords
function drawStrokeLogical(p0, p1, eraser=false) {
  paintCtx.lineCap = 'round';
  paintCtx.lineJoin = 'round';
  paintCtx.lineWidth = size; // size in logical units
  if (eraser) {
    paintCtx.globalCompositeOperation = 'destination-out';
    paintCtx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    paintCtx.globalCompositeOperation = 'source-over';
    paintCtx.strokeStyle = currentColor;
  }
  paintCtx.beginPath();
  paintCtx.moveTo(p0.x, p0.y);
  paintCtx.lineTo(p1.x, p1.y);
  paintCtx.stroke();
  paintCtx.closePath();
  paintCtx.globalCompositeOperation = 'source-over';
}

// --- Flood fill (works in pixel buffer)
// We convert logical coords to pixel coords for ImageData operations.
function hexToRgba(hex) {
  const h = hex.replace('#','');
  const bigint = parseInt(h.length===3 ? h.split('').map(c=>c+c).join('') : h, 16);
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255, a: 255 };
}
function colorMatch(data, idx, color, tol=0) {
  return Math.abs(data[idx] - color.r) <= tol &&
         Math.abs(data[idx+1] - color.g) <= tol &&
         Math.abs(data[idx+2] - color.b) <= tol &&
         Math.abs(data[idx+3] - color.a) <= tol;
}
function floodFillLogical(logicalX, logicalY, fillColor, tolerance = 30) {
  const dpr = window.devicePixelRatio || 1;
  // convert logical to pixel coordinates in backing buffer
  const startXpx = Math.round(logicalX * dpr);
  const startYpx = Math.round(logicalY * dpr);

  const pixelW = paintCanvas.width;   // LOGICAL_W * dpr
  const pixelH = paintCanvas.height;  // LOGICAL_H * dpr

  if (startXpx < 0 || startYpx < 0 || startXpx >= pixelW || startYpx >= pixelH) return;

  const pImg = paintCtx.getImageData(0, 0, pixelW, pixelH);
  const oImg = outlineCtx.getImageData(0, 0, pixelW, pixelH);
  const data = pImg.data;
  const odata = oImg.data;

  const stack = [];
  const startIdx = (startYpx * pixelW + startXpx) * 4;
  const target = { r: data[startIdx], g: data[startIdx+1], b: data[startIdx+2], a: data[startIdx+3] };

  if (odata[startIdx + 3] > 10) return; // clicked on outline

  if (Math.abs(target.r - fillColor.r) <= tolerance &&
      Math.abs(target.g - fillColor.g) <= tolerance &&
      Math.abs(target.b - fillColor.b) <= tolerance &&
      target.a === 255) return;

  stack.push([startXpx, startYpx]);
  const visited = new Uint8Array(pixelW * pixelH);

  while (stack.length) {
    const [x, y] = stack.pop();
    const idx = (y * pixelW + x);
    const id = idx * 4;
    if (visited[idx]) continue;
    visited[idx] = 1;

    if (odata[id + 3] > 10) continue; // outline blocks

    if (!colorMatch(data, id, target, tolerance) && !(data[id+3] === 0 && target.a === 0)) continue;

    data[id] = fillColor.r;
    data[id+1] = fillColor.g;
    data[id+2] = fillColor.b;
    data[id+3] = fillColor.a;

    if (x + 1 < pixelW) stack.push([x+1, y]);
    if (x - 1 >= 0) stack.push([x-1, y]);
    if (y + 1 < pixelH) stack.push([x, y+1]);
    if (y - 1 >= 0) stack.push([x, y-1]);
  }

  paintCtx.putImageData(pImg, 0, 0);
}

// --- Render SVG into outline using logical coordinates (assumes viewBox 0 0 800 600)
async function renderSVGToOutline(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Fetch SVG failed: ' + url);
    const svgText = await res.text();
    const svg64 = btoa(unescape(encodeURIComponent(svgText)));
    const dataUrl = 'data:image/svg+xml;base64,' + svg64;
    const img = new Image();
    img.src = dataUrl;
    await img.decode();

    // draw the svg into logical area (0..LOGICAL_W, 0..LOGICAL_H)
    outlineCtx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
    // Because we set transform(dpr,0,0,dpr,..) earlier, drawing in logical coords is fine:
    outlineCtx.drawImage(img, 0, 0, LOGICAL_W, LOGICAL_H);
  } catch (err) {
    console.error('renderSVGToOutline error', err);
  }
}

// --- Save combined image (export at logical resolution)
function saveAsPNG() {
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = LOGICAL_W;
  exportCanvas.height = LOGICAL_H;
  const ctx = exportCanvas.getContext('2d');

  // draw paint (backing buffer is LOGICAL_W * dpr; draw scaled to logical size)
  ctx.drawImage(paintCanvas, 0, 0, paintCanvas.width, paintCanvas.height, 0, 0, LOGICAL_W, LOGICAL_H);
  ctx.drawImage(outlineCanvas, 0, 0, outlineCanvas.width, outlineCanvas.height, 0, 0, LOGICAL_W, LOGICAL_H);

  const dataUrl = exportCanvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = 'coloring.png';
  a.click();
}

// --- Manifest loader (same behaviour as before)
async function loadManifest() {
  try {
    const res = await fetch('images/manifest.json', { cache: "no-store" });
    if (!res.ok) throw new Error('no manifest');
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) throw new Error('manifest empty');
    return list.map(name => name.startsWith('images/') ? name : `images/${name}`);
  } catch (e) {
    return fallbackFiles;
  }
}

// --- Palette helpers (unchanged behavior; keep integration)
const defaultColors = [
  "#000000","#474747","#7f7f7f","#bfbfbf","#ffffff",
  "#ff4d4d","#e63946","#b00020",
  "#ffb703","#fb8500","#ffd166",
  "#ffd54f","#c5a300","#9a7d00",
  "#4caf50","#2e8b57","#0b8a3e",
  "#06b6d4","#0891b2","#05668d",
  "#3b82f6"
];
const LS_CUSTOM = 'rc_custom_colors_v1';

function createColorBox(color, targetEl, persist=false){
  const box = document.createElement('button');
  box.className = 'color-box';
  box.style.backgroundColor = color;
  box.setAttribute('aria-label', `Color ${color}`);
  box.title = color;
  box.type = 'button';
  box.addEventListener('click', () => {
    currentColor = color;
    colorPicker.value = color;
    pickerBottom.value = color;
  });
  if(persist){
    box.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if(confirm('Remove this color from favorites?')) removeCustomColor(color);
    });
  }
  targetEl.appendChild(box);
}
function loadDefaultPalette(){
  defaultPaletteEl.innerHTML = '';
  defaultColors.forEach(c => createColorBox(c, defaultPaletteEl, false));
}
function getCustomColors(){
  try {
    const raw = localStorage.getItem(LS_CUSTOM);
    if(!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch(e){ return []; }
}
function setCustomColors(arr){
  localStorage.setItem(LS_CUSTOM, JSON.stringify(arr));
}
function loadCustomPalette(){
  customPaletteEl.innerHTML = '';
  getCustomColors().forEach(c => createColorBox(c, customPaletteEl, true));
}
function addCustomColor(color){
  const arr = getCustomColors();
  if(arr.includes(color)) return;
  arr.unshift(color);
  if(arr.length > 48) arr.length = 48;
  setCustomColors(arr);
  loadCustomPalette();
}
function removeCustomColor(color){
  let arr = getCustomColors();
  arr = arr.filter(c => c !== color);
  setCustomColors(arr);
  loadCustomPalette();
}
function clearCustomColors(){
  if(confirm('Clear all favorite colors?')){
    localStorage.removeItem(LS_CUSTOM);
    loadCustomPalette();
  }
}

// --- Setup random image and reset paint area
async function setupRandomImage(){
  try {
    const list = await loadManifest();
    const idx = Math.floor(Math.random() * list.length);
    const url = list[idx];
    currentSVGUrl = url;
    // clear paint (logical coords)
    paintCtx.clearRect(0,0,LOGICAL_W,LOGICAL_H);
    await renderSVGToOutline(url);
  } catch(err){
    console.error('setupRandomImage error', err);
  }
}

// --- UI wiring (same behavior)
function setToolFromUI(){
  document.querySelectorAll('input[name="tool"]').forEach(r=>{
    r.addEventListener('change', e => tool = e.target.value);
  });

  colorPicker.addEventListener('input', e => {
    currentColor = e.target.value;
    pickerBottom.value = currentColor;
  });
  pickerBottom.addEventListener('input', e => {
    currentColor = e.target.value;
    colorPicker.value = currentColor;
  });

  sizeRange.addEventListener('input', e => size = +e.target.value);

  document.getElementById('backBtn').addEventListener('click', ()=> location.href = 'index.html');
  document.getElementById('clearBtn').addEventListener('click', ()=> paintCtx.clearRect(0,0,LOGICAL_W,LOGICAL_H));
  document.getElementById('saveBtn').addEventListener('click', saveAsPNG);
  document.getElementById('newBtn').addEventListener('click', async ()=> { await setupRandomImage(); });

  addColorBtn.addEventListener('click', ()=> addCustomColor(pickerBottom.value));
  clearCustomBtn.addEventListener('click', clearCustomColors);
}

// --- Pointer handling: map events to logical coords
function startDrawing(ev){
  ev.preventDefault();
  drawing = true;
  last = getLogicalPosFromEvent(ev);
  if(tool === 'fill'){
    floodFillLogical(last.x, last.y, hexToRgba(currentColor), 30);
  } else if(tool === 'eraser') {
    drawStrokeLogical(last, last, true);
  } else {
    drawStrokeLogical(last, last, false);
  }
}
function moveDrawing(ev){
  if(!drawing) return;
  ev.preventDefault();
  const pos = getLogicalPosFromEvent(ev);
  drawStrokeLogical(last, pos, tool === 'eraser');
  last = pos;
}
function stopDrawing(ev){
  drawing = false;
}

// --- Bind pointers
function bindPointerEvents(){
  paintCanvas.addEventListener('pointerdown', startDrawing, {passive:false});
  paintCanvas.addEventListener('pointermove', moveDrawing, {passive:false});
  window.addEventListener('pointerup', stopDrawing);

  paintCanvas.addEventListener('touchstart', startDrawing, {passive:false});
  paintCanvas.addEventListener('touchmove', moveDrawing, {passive:false});
  paintCanvas.addEventListener('touchend', stopDrawing);
  paintCanvas.addEventListener('contextmenu', e => e.preventDefault());
}

// --- Init
let initialized = false;
async function init(){
  if(initialized) return;
  initialized = true;

  // initialize backing buffers
  initCanvases();

  // initial display size
  resizeDisplay();

  // resize handler: only update CSS/display (do NOT change backing buffer)
  let resizeTimer = null;
  window.addEventListener('resize', ()=> {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(()=> resizeDisplay(), 80);
  });

  // palettes/UI
  loadDefaultPalette();
  loadCustomPalette();
  setToolFromUI();
  bindPointerEvents();

  currentColor = colorPicker.value;
  pickerBottom.value = currentColor;
  size = +sizeRange.value;

  await setupRandomImage();
}

window.addEventListener('load', init);

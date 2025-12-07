/* script.js
   Random Coloring — paint under SVG outlines.
   - paintCanvas: user drawings (brush/eraser/fill)
   - outlineCanvas: SVG contours, always on top (pointer-events: none)
   - images/manifest.json is used to choose random SVGs.
   - Palette: 21 default colors + custom favorites stored in localStorage
*/

// ----- DOM elements -----
const paintCanvas = document.getElementById('paintCanvas');
const outlineCanvas = document.getElementById('outlineCanvas');
const canvasWrap = document.getElementById('canvasWrap');

const paintCtx = paintCanvas.getContext('2d');
const outlineCtx = outlineCanvas.getContext('2d');

const colorPicker = document.getElementById('colorPicker');    // top picker in toolbar
const pickerBottom = document.getElementById('pickerBottom');  // bottom picker near palette
const sizeRange = document.getElementById('sizeRange');

const defaultPaletteEl = document.getElementById('defaultPalette');
const customPaletteEl = document.getElementById('customPalette');
const addColorBtn = document.getElementById('addColorBtn');
const clearCustomBtn = document.getElementById('clearCustomBtn');

// ----- State -----
let tool = 'brush';
let currentColor = '#FF6B6B';
let size = 12;
let drawing = false;
let last = {x:0,y:0};
let currentSVGUrl = null;

// ----- Default colors (21) -----
const defaultColors = [
  "#000000","#474747","#7f7f7f","#bfbfbf","#ffffff",
  "#ff4d4d","#e63946","#b00020",
  "#ffb703","#fb8500","#ffd166",
  "#ffd54f","#c5a300","#9a7d00",
  "#4caf50","#2e8b57","#0b8a3e",
  "#06b6d4","#0891b2","#05668d",
  "#3b82f6"
];

// localStorage key for custom colors
const LS_CUSTOM = 'rc_custom_colors_v1';

// ----- fallback files if manifest not found -----
const fallbackFiles = [
  "images/sample1.svg",
  "images/sample2.svg",
  "images/sample3.svg"
];

// ----- Helpers: resize canvases and support HiDPI -----
function resizeCanvases(preservePaint = true) {
  const rect = canvasWrap.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(rect.width));
  const cssH = Math.max(1, Math.round(rect.height));
  const dpr = window.devicePixelRatio || 1;

  // backup paint canvas content (CSS pixel space)
  let tempImage = null;
  if (preservePaint && paintCanvas.width && paintCanvas.height) {
    tempImage = document.createElement('canvas');
    tempImage.width = paintCanvas.width;
    tempImage.height = paintCanvas.height;
    tempImage.getContext('2d').drawImage(paintCanvas, 0, 0);
  }

  // set CSS size and backing pixel size
  [paintCanvas, outlineCanvas].forEach(c => {
    c.style.width = cssW + 'px';
    c.style.height = cssH + 'px';
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
  });

  // set transforms so we draw in CSS pixel coords
  paintCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  outlineCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // restore paint content
  if (tempImage) {
    paintCtx.clearRect(0,0,cssW,cssH);
    paintCtx.drawImage(tempImage, 0, 0, cssW, cssH);
  } else {
    paintCtx.clearRect(0,0,cssW,cssH);
  }

  // re-render outline if present
  if (currentSVGUrl) {
    renderSVGToOutline(currentSVGUrl).catch(err => console.error(err));
  } else {
    outlineCtx.clearRect(0,0,cssW,cssH);
  }
}

// ----- Manifest loader -----
async function loadManifest(){
  try {
    const res = await fetch('images/manifest.json', {cache: "no-store"});
    if(!res.ok) throw new Error('no manifest');
    const list = await res.json();
    if(!Array.isArray(list) || list.length === 0) throw new Error('manifest empty');
    return list.map(name => name.startsWith('images/') ? name : `images/${name}`);
  } catch (e) {
    return fallbackFiles;
  }
}

// ----- Render SVG into outline canvas (fit + center) -----
async function renderSVGToOutline(url){
  try {
    const res = await fetch(url);
    if(!res.ok) throw new Error('Fetch SVG failed: ' + url);
    const svgText = await res.text();
    const svg64 = btoa(unescape(encodeURIComponent(svgText)));
    const dataUrl = 'data:image/svg+xml;base64,' + svg64;
    const img = new Image();
    img.src = dataUrl;
    await img.decode();

    const rect = canvasWrap.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));
    const margin = 0.06;
    const iw = img.width || 800;
    const ih = img.height || 600;
    const availableW = cssW * (1 - 2 * margin);
    const availableH = cssH * (1 - 2 * margin);
    const scale = Math.min(availableW / iw, availableH / ih);
    const iwScaled = iw * scale;
    const ihScaled = ih * scale;
    const dx = (cssW - iwScaled) / 2;
    const dy = (cssH - ihScaled) / 2;

    outlineCtx.clearRect(0,0,cssW,cssH);
    outlineCtx.drawImage(img, dx, dy, iwScaled, ihScaled);
  } catch(err){
    console.error('renderSVGToOutline error', err);
  }
}

// ----- Drawing helpers -----
function getPos(ev){
  const rect = canvasWrap.getBoundingClientRect();
  const clientX = ev.clientX ?? (ev.touches && ev.touches[0] && ev.touches[0].clientX);
  const clientY = ev.clientY ?? (ev.touches && ev.touches[0] && ev.touches[0].clientY);
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function drawStroke(p0, p1, eraser=false){
  paintCtx.lineCap = 'round';
  paintCtx.lineJoin = 'round';
  paintCtx.lineWidth = size;
  if(eraser){
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

function startDrawing(ev){
  ev.preventDefault();
  drawing = true;
  last = getPos(ev);
  if(tool === 'fill'){
    floodFill(Math.round(last.x), Math.round(last.y), hexToRgba(currentColor), 30);
  } else if(tool === 'eraser'){
    drawStroke(last, last, true);
  } else {
    drawStroke(last, last, false);
  }
}
function moveDrawing(ev){
  if(!drawing) return;
  ev.preventDefault();
  const pos = getPos(ev);
  drawStroke(last, pos, tool === 'eraser');
  last = pos;
}
function stopDrawing(ev){
  drawing = false;
}

// ----- Flood fill (respects outline alpha) -----
function hexToRgba(hex){
  const h = hex.replace('#','');
  const bigint = parseInt(h.length===3 ? h.split('').map(c=>c+c).join('') : h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return {r,g,b,a:255};
}
function colorMatch(data, idx, color, tol=0){
  return Math.abs(data[idx] - color.r) <= tol &&
         Math.abs(data[idx+1] - color.g) <= tol &&
         Math.abs(data[idx+2] - color.b) <= tol &&
         Math.abs(data[idx+3] - color.a) <= tol;
}
function floodFill(startX, startY, fillColor, tolerance=30){
  const rect = canvasWrap.getBoundingClientRect();
  const w = Math.round(rect.width), h = Math.round(rect.height);
  if(startX < 0 || startY < 0 || startX >= w || startY >= h) return;
  const pImg = paintCtx.getImageData(0,0,w,h);
  const oImg = outlineCtx.getImageData(0,0,w,h);
  const data = pImg.data;
  const odata = oImg.data;

  const stack = [];
  const startIdx = (startY * w + startX) * 4;
  const target = { r: data[startIdx], g: data[startIdx+1], b: data[startIdx+2], a: data[startIdx+3] };

  // Don't fill on outline pixel
  if(odata[startIdx + 3] > 10) return;

  if(Math.abs(target.r - fillColor.r) <= tolerance &&
     Math.abs(target.g - fillColor.g) <= tolerance &&
     Math.abs(target.b - fillColor.b) <= tolerance &&
     target.a === 255) return;

  stack.push([startX, startY]);
  const visited = new Uint8Array(w * h);

  while(stack.length){
    const [x,y] = stack.pop();
    const idx = (y * w + x);
    const id = idx * 4;
    if(visited[idx]) continue;
    visited[idx] = 1;

    if(odata[id + 3] > 10) continue;

    if(!colorMatch(data, id, target, tolerance) && !(data[id+3] === 0 && target.a === 0)) continue;

    data[id] = fillColor.r;
    data[id+1] = fillColor.g;
    data[id+2] = fillColor.b;
    data[id+3] = fillColor.a;

    if(x+1 < w) stack.push([x+1,y]);
    if(x-1 >= 0) stack.push([x-1,y]);
    if(y+1 < h) stack.push([x,y+1]);
    if(y-1 >= 0) stack.push([x,y-1]);
  }

  paintCtx.putImageData(pImg, 0, 0);
}

// ----- Save combined image (paint under outline) -----
function saveAsPNG(){
  const rect = canvasWrap.getBoundingClientRect();
  const cssW = Math.round(rect.width), cssH = Math.round(rect.height);
  const combo = document.createElement('canvas');
  combo.width = cssW;
  combo.height = cssH;
  const ctx = combo.getContext('2d');

  ctx.drawImage(paintCanvas, 0, 0, combo.width, combo.height);
  ctx.drawImage(outlineCanvas, 0, 0, combo.width, combo.height);

  const dataUrl = combo.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = 'coloring.png';
  a.click();
}

// ----- Palette UI -----
function createColorBox(color, targetEl, persist=false){
  const box = document.createElement('button');
  box.className = 'color-box';
  box.style.backgroundColor = color;
  box.setAttribute('aria-label', `Color ${color}`);
  box.title = color;
  box.type = 'button';
  box.addEventListener('click', () => {
    currentColor = color;
    // sync both pickers
    colorPicker.value = color;
    pickerBottom.value = color;
  });

  // right-click to remove from custom palette (if persist)
  if(persist){
    box.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if(confirm('Remove this color from favorites?')){
        removeCustomColor(color);
      }
    });
  }

  targetEl.appendChild(box);
}

function loadDefaultPalette(){
  defaultPaletteEl.innerHTML = '';
  defaultColors.forEach(c => createColorBox(c, defaultPaletteEl, false));
}

function loadCustomPalette(){
  customPaletteEl.innerHTML = '';
  const arr = getCustomColors();
  arr.forEach(c => createColorBox(c, customPaletteEl, true));
}

function getCustomColors(){
  try {
    const raw = localStorage.getItem(LS_CUSTOM);
    if(!raw) return [];
    const arr = JSON.parse(raw);
    if(Array.isArray(arr)) return arr;
    return [];
  } catch(e) { return []; }
}
function setCustomColors(arr){
  localStorage.setItem(LS_CUSTOM, JSON.stringify(arr));
}
function addCustomColor(color){
  const arr = getCustomColors();
  if(arr.includes(color)) return;
  arr.unshift(color);
  // keep at most 48 custom colors to avoid huge UI
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
  if(confirm('Clear all favorite colors?')) {
    localStorage.removeItem(LS_CUSTOM);
    loadCustomPalette();
  }
}

// ----- Choose and load random SVG -----
async function setupRandomImage(){
  try {
    const list = await loadManifest();
    const idx = Math.floor(Math.random() * list.length);
    const url = list[idx];
    currentSVGUrl = url;
    // clear paint
    const rect = canvasWrap.getBoundingClientRect();
    paintCtx.clearRect(0,0,rect.width,rect.height);
    await renderSVGToOutline(url);
  } catch(err){
    console.error('setupRandomImage error', err);
  }
}

// ----- UI wiring -----
function setToolFromUI(){
  document.querySelectorAll('input[name="tool"]').forEach(r=>{
    r.addEventListener('change', e => tool = e.target.value);
  });
  // top color picker
  colorPicker.addEventListener('input', e => {
    currentColor = e.target.value;
    pickerBottom.value = currentColor;
  });
  // bottom picker
  pickerBottom.addEventListener('input', e => {
    currentColor = e.target.value;
    colorPicker.value = currentColor;
  });

  sizeRange.addEventListener('input', e => size = +e.target.value);

  document.getElementById('backBtn').addEventListener('click', ()=> location.href = 'index.html');
  document.getElementById('clearBtn').addEventListener('click', ()=> {
    const rect = canvasWrap.getBoundingClientRect();
    paintCtx.clearRect(0,0,rect.width,rect.height);
  });
  document.getElementById('saveBtn').addEventListener('click', saveAsPNG);
  document.getElementById('newBtn').addEventListener('click', async ()=> {
    await setupRandomImage();
  });

  addColorBtn.addEventListener('click', ()=> {
    // use bottom picker value as source of "favorite"
    const newColor = pickerBottom.value;
    addCustomColor(newColor);
  });

  clearCustomBtn.addEventListener('click', clearCustomColors);
}

// ----- Pointer binding -----
function bindPointerEvents(){
  paintCanvas.addEventListener('pointerdown', startDrawing, {passive:false});
  paintCanvas.addEventListener('pointermove', moveDrawing, {passive:false});
  window.addEventListener('pointerup', stopDrawing);

  // touch fallback
  paintCanvas.addEventListener('touchstart', startDrawing, {passive:false});
  paintCanvas.addEventListener('touchmove', moveDrawing, {passive:false});
  paintCanvas.addEventListener('touchend', stopDrawing);
  paintCanvas.addEventListener('contextmenu', e => e.preventDefault());
}

// ----- Init -----
let initialized = false;
async function init(){
  if(initialized) return;
  initialized = true;

  // initial size and listeners
  resizeCanvases(false);
  let resizeTimer = null;
  window.addEventListener('resize', ()=> {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(()=> resizeCanvases(true), 120);
  });

  // load palettes
  loadDefaultPalette();
  loadCustomPalette();

  setToolFromUI();
  bindPointerEvents();

  // set initial color and size
  currentColor = colorPicker.value;
  pickerBottom.value = currentColor;
  size = +sizeRange.value;

  await setupRandomImage();
}

window.addEventListener('load', init);

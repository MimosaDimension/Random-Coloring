/* script.js — исправленная версия
   Главный фикс: floodFill и работа с ImageData теперь используют pixel coordinates (умножаем CSS coords на DPR)
   и всегда читают/записывают данные с размерами canvas.width / canvas.height (в пикселях).
*/

/* ----- DOM ----- */
const paintCanvas = document.getElementById('paintCanvas');
const outlineCanvas = document.getElementById('outlineCanvas');
const canvasWrap = document.getElementById('canvasWrap');

const paintCtx = paintCanvas.getContext('2d');
const outlineCtx = outlineCanvas.getContext('2d');

const colorPicker = document.getElementById('colorPicker');    // top picker
const pickerBottom = document.getElementById('pickerBottom');  // bottom picker
const sizeRange = document.getElementById('sizeRange');

const defaultPaletteEl = document.getElementById('defaultPalette');
const customPaletteEl = document.getElementById('customPalette');
const addColorBtn = document.getElementById('addColorBtn');
const clearCustomBtn = document.getElementById('clearCustomBtn');

/* ----- State ----- */
let tool = 'brush';
let currentColor = '#FF6B6B';
let size = 12;
let drawing = false;
let last = {x:0,y:0};
let currentSVGUrl = null;

/* ----- palettes ----- */
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

/* ----- fallback files ----- */
const fallbackFiles = [
  "images/sample1.svg",
  "images/sample2.svg",
  "images/sample3.svg"
];

/* ----- Helpers: resize canvases (HiDPI aware) ----- */
function resizeCanvases(preservePaint = true) {
  const rect = canvasWrap.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(rect.width));
  const cssH = Math.max(1, Math.round(rect.height));
  const dpr = window.devicePixelRatio || 1;

  // backup paint content (pixel buffer)
  let temp = null;
  if (preservePaint && paintCanvas.width && paintCanvas.height) {
    temp = document.createElement('canvas');
    temp.width = paintCanvas.width;
    temp.height = paintCanvas.height;
    temp.getContext('2d').drawImage(paintCanvas, 0, 0);
  }

  // set CSS sizes and pixel backing sizes
  [paintCanvas, outlineCanvas].forEach(c => {
    c.style.width = cssW + 'px';
    c.style.height = cssH + 'px';
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
  });

  // set transform so we can draw using CSS pixels (user space)
  paintCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  outlineCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // restore paint content scaled to new CSS size
  if (temp) {
    paintCtx.clearRect(0,0,cssW,cssH);
    paintCtx.drawImage(temp, 0, 0, cssW, cssH);
  } else {
    paintCtx.clearRect(0,0,cssW,cssH);
  }

  if (currentSVGUrl) {
    renderSVGToOutline(currentSVGUrl).catch(err => console.error(err));
  } else {
    outlineCtx.clearRect(0,0,cssW,cssH);
  }
}

/* ----- Manifest loader ----- */
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

/* ----- Render SVG into outline canvas ----- */
async function renderSVGToOutline(url){
  try {
    const res = await fetch(url);
    if(!res.ok) throw new Error('Fetch failed: ' + url);
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

    // Note: because we set transform(dpr,0,0,dpr,0,0),
    // we supply coordinates in CSS pixels (dx,dy,iwScaled,ihScaled).
    outlineCtx.clearRect(0,0,cssW,cssH);
    outlineCtx.drawImage(img, dx, dy, iwScaled, ihScaled);
  } catch(err){
    console.error('renderSVGToOutline error', err);
  }
}

/* ----- Drawing helpers ----- */
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
    // convert CSS coords to pixel coords for flood fill
    const dpr = window.devicePixelRatio || 1;
    const sx = Math.round(last.x * dpr);
    const sy = Math.round(last.y * dpr);
    floodFill(sx, sy, hexToRgba(currentColor), 30);
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

/* ----- Flood fill (pixel-accurate) ----- */
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

function floodFill(startXpx, startYpx, fillColor, tolerance=30){
  // now startXpx/startYpx are in pixel coordinates (not CSS)
  const pixelW = paintCanvas.width;   // real pixel width
  const pixelH = paintCanvas.height;  // real pixel height
  if(startXpx < 0 || startYpx < 0 || startXpx >= pixelW || startYpx >= pixelH) return;

  // Get image data for full pixel buffer
  const pImg = paintCtx.getImageData(0,0,pixelW,pixelH);
  const oImg = outlineCtx.getImageData(0,0,pixelW,pixelH);
  const data = pImg.data;
  const odata = oImg.data;

  const stack = [];
  const startIdx = (startYpx * pixelW + startXpx) * 4;
  const target = { r: data[startIdx], g: data[startIdx+1], b: data[startIdx+2], a: data[startIdx+3] };

  // if clicked on outline (alpha > threshold) -> don't fill
  if(odata[startIdx + 3] > 10) return;

  // if target already equals fillColor (within tol) and opaque, skip
  if(Math.abs(target.r - fillColor.r) <= tolerance &&
     Math.abs(target.g - fillColor.g) <= tolerance &&
     Math.abs(target.b - fillColor.b) <= tolerance &&
     target.a === 255) return;

  stack.push([startXpx, startYpx]);
  const visited = new Uint8Array(pixelW * pixelH);

  while(stack.length){
    const [x,y] = stack.pop();
    const idx = (y * pixelW + x);
    const id = idx * 4;
    if(visited[idx]) continue;
    visited[idx] = 1;

    // stop if outline at this pixel
    if(odata[id + 3] > 10) continue;

    // check if pixel matches target color (within tolerance)
    if(!colorMatch(data, id, target, tolerance) && !(data[id+3] === 0 && target.a === 0)) continue;

    // paint pixel
    data[id] = fillColor.r;
    data[id+1] = fillColor.g;
    data[id+2] = fillColor.b;
    data[id+3] = fillColor.a;

    if(x+1 < pixelW) stack.push([x+1,y]);
    if(x-1 >= 0) stack.push([x-1,y]);
    if(y+1 < pixelH) stack.push([x,y+1]);
    if(y-1 >= 0) stack.push([x,y-1]);
  }

  // write back full image data
  paintCtx.putImageData(pImg, 0, 0);
}

/* ----- save combined PNG ----- */
function saveAsPNG(){
  const rect = canvasWrap.getBoundingClientRect();
  const cssW = Math.round(rect.width), cssH = Math.round(rect.height);
  const combo = document.createElement('canvas');
  combo.width = cssW;
  combo.height = cssH;
  const ctx = combo.getContext('2d');

  // draw paint first, then outline on top
  ctx.drawImage(paintCanvas, 0, 0, combo.width, combo.height);
  ctx.drawImage(outlineCanvas, 0, 0, combo.width, combo.height);

  const dataUrl = combo.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = 'coloring.png';
  a.click();
}

/* ----- Palette UI ----- */
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

/* ----- load random SVG ----- */
async function setupRandomImage(){
  try {
    const list = await loadManifest();
    const idx = Math.floor(Math.random() * list.length);
    const url = list[idx];
    currentSVGUrl = url;
    // clear paint (CSS coords)
    const rect = canvasWrap.getBoundingClientRect();
    paintCtx.clearRect(0,0,rect.width,rect.height);
    await renderSVGToOutline(url);
  } catch(err){
    console.error('setupRandomImage error', err);
  }
}

/* ----- UI wiring ----- */
function setToolFromUI(){
  document.querySelectorAll('input[name="tool"]').forEach(r=>{
    r.addEventListener('change', e => tool = e.target.value);
  });

  // link both pickers
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
  document.getElementById('clearBtn').addEventListener('click', ()=> {
    const rect = canvasWrap.getBoundingClientRect();
    paintCtx.clearRect(0,0,rect.width,rect.height);
  });
  document.getElementById('saveBtn').addEventListener('click', saveAsPNG);
  document.getElementById('newBtn').addEventListener('click', async ()=> { await setupRandomImage(); });

  addColorBtn.addEventListener('click', ()=> addCustomColor(pickerBottom.value));
  clearCustomBtn.addEventListener('click', clearCustomColors);
}

/* ----- pointer events ----- */
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

/* ----- init ----- */
let initialized = false;
async function init(){
  if(initialized) return;
  initialized = true;

  resizeCanvases(false);
  let resizeTimer = null;
  window.addEventListener('resize', ()=> {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(()=> resizeCanvases(true), 120);
  });

  // palette
  loadDefaultPalette();
  loadCustomPalette();

  setToolFromUI();
  bindPointerEvents();

  // initial UI values
  currentColor = colorPicker.value;
  pickerBottom.value = currentColor;
  size = +sizeRange.value;

  await setupRandomImage();
}

window.addEventListener('load', init);

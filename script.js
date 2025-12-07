/* script.js
   Random Coloring — paint under SVG outlines.
   - paintCanvas: user drawings (brush/eraser/fill)
   - outlineCanvas: SVG contours, always on top (pointer-events: none)
   - images/manifest.json is used to choose random SVGs.
*/

// DOM
const paintCanvas = document.getElementById('paintCanvas');
const outlineCanvas = document.getElementById('outlineCanvas');
const canvasWrap = document.getElementById('canvasWrap');

const paintCtx = paintCanvas.getContext('2d');
const outlineCtx = outlineCanvas.getContext('2d');

// UI
const colorPicker = document.getElementById('colorPicker');
const sizeRange = document.getElementById('sizeRange');

let tool = 'brush';
let color = '#FF6B6B';
let size = 12;
let drawing = false;
let last = {x:0,y:0};
let currentSVGUrl = null;

// Fallback list in case manifest not available
const fallbackFiles = [
  "images/sample1.svg",
  "images/sample2.svg",
  "images/sample3.svg"
];

// --- Utility: resize canvases to wrapper size (handles HiDPI)
function resizeCanvases(preservePaint = true) {
  const rect = canvasWrap.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(rect.width));
  const cssH = Math.max(1, Math.round(rect.height));
  const dpr = window.devicePixelRatio || 1;

  // Save existing paint content
  let tempImage = null;
  if (preservePaint && paintCanvas.width && paintCanvas.height) {
    tempImage = document.createElement('canvas');
    tempImage.width = paintCanvas.width;
    tempImage.height = paintCanvas.height;
    const tctx = tempImage.getContext('2d');
    tctx.drawImage(paintCanvas, 0, 0);
  }

  // Set CSS size and pixel size with DPR
  [paintCanvas, outlineCanvas].forEach(c => {
    c.style.width = cssW + 'px';
    c.style.height = cssH + 'px';
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
  });

  // Reset transforms so we can draw using CSS px coordinates
  paintCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  outlineCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Restore paint content scaled to new size
  if (tempImage) {
    // tempImage is in previous pixel size; draw it scaled to new css size
    paintCtx.clearRect(0,0,cssW,cssH);
    paintCtx.drawImage(tempImage, 0, 0, cssW, cssH);
  } else {
    paintCtx.clearRect(0,0,cssW,cssH);
  }

  // Re-render outline (SVG) if one is loaded
  if (currentSVGUrl) {
    // re-draw svg into outline canvas
    renderSVGToOutline(currentSVGUrl).catch(err => console.error(err));
  } else {
    outlineCtx.clearRect(0,0,cssW,cssH);
  }
}

// --- Load manifest.json (list of images)
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

// --- Render SVG file (URL) into the outlineCanvas, centered & fit
async function renderSVGToOutline(url){
  try {
    const res = await fetch(url);
    if(!res.ok) throw new Error('Failed to fetch SVG: ' + url);
    const svgText = await res.text();
    // create data URL (encode)
    const svg64 = btoa(unescape(encodeURIComponent(svgText)));
    const dataUrl = 'data:image/svg+xml;base64,' + svg64;
    const img = new Image();
    // allow cross-origin drawing; data URL is fine
    img.src = dataUrl;
    await img.decode();

    // draw into outline canvas fitting with margin and preserving aspect ratio
    const rect = canvasWrap.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));
    const margin = 0.06; // small margin on sides
    const iw = img.width || 800;
    const ih = img.height || 600;
    const availableW = cssW * (1 - 2 * margin);
    const availableH = cssH * (1 - 2 * margin);
    const scale = Math.min(availableW / iw, availableH / ih);
    const iwScaled = iw * scale;
    const ihScaled = ih * scale;
    const dx = (cssW - iwScaled) / 2;
    const dy = (cssH - ihScaled) / 2;

    // Clear outline and draw
    outlineCtx.clearRect(0, 0, cssW, cssH);
    outlineCtx.drawImage(img, dx, dy, iwScaled, ihScaled);
  } catch(err){
    console.error('renderSVGToOutline error', err);
  }
}

// --- Drawing helpers

function setToolFromUI(){
  document.querySelectorAll('input[name="tool"]').forEach(r=>{
    r.addEventListener('change', e => tool = e.target.value);
  });
  colorPicker.addEventListener('input', e => color = e.target.value);
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
}

// pointer position relative to canvas CSS coords
function getPos(ev){
  const rect = canvasWrap.getBoundingClientRect();
  const clientX = ev.clientX ?? (ev.touches && ev.touches[0] && ev.touches[0].clientX);
  const clientY = ev.clientY ?? (ev.touches && ev.touches[0] && ev.touches[0].clientY);
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function startDrawing(ev){
  ev.preventDefault();
  drawing = true;
  last = getPos(ev);
  if(tool === 'fill'){
    floodFill(Math.round(last.x), Math.round(last.y), hexToRgba(color), 30);
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

// draws a stroke on paintCtx
function drawStroke(p0, p1, eraser=false){
  paintCtx.lineCap = 'round';
  paintCtx.lineJoin = 'round';
  paintCtx.lineWidth = size;
  if(eraser){
    paintCtx.globalCompositeOperation = 'destination-out';
    paintCtx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    paintCtx.globalCompositeOperation = 'source-over';
    paintCtx.strokeStyle = color;
  }
  paintCtx.beginPath();
  paintCtx.moveTo(p0.x, p0.y);
  paintCtx.lineTo(p1.x, p1.y);
  paintCtx.stroke();
  paintCtx.closePath();
  paintCtx.globalCompositeOperation = 'source-over';
}

// --- Flood fill (paints only into regions not blocked by outline)
// Outline is read from outlineCtx imageData alpha channel.
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

  // if clicked directly on outline (alpha>10), do nothing
  if(odata[startIdx + 3] > 10) return;

  // if target already equals fillColor (within tol) and opaque, skip
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

    // stop if outline at this pixel
    if(odata[id + 3] > 10) continue;

    // check target color match
    if(!colorMatch(data, id, target, tolerance) && !(data[id+3] === 0 && target.a === 0)) continue;

    // paint pixel
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

// --- Save combined image (paint under outline) as PNG
function saveAsPNG(){
  const rect = canvasWrap.getBoundingClientRect();
  const cssW = Math.round(rect.width), cssH = Math.round(rect.height);
  // create combination canvas at CSS pixels (not DPR) for convenient saving at screen resolution
  const combo = document.createElement('canvas');
  combo.width = cssW;
  combo.height = cssH;
  const ctx = combo.getContext('2d');

  // draw paint first (under), then outline on top
  // drawImage will scale from canvas pixel buffer to combo size if necessary
  ctx.drawImage(paintCanvas, 0, 0, combo.width, combo.height);
  ctx.drawImage(outlineCanvas, 0, 0, combo.width, combo.height);

  const dataUrl = combo.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = 'coloring.png';
  a.click();
}

// --- Choose and load a random SVG from manifest
async function setupRandomImage(){
  try {
    const list = await loadManifest();
    const idx = Math.floor(Math.random() * list.length);
    const url = list[idx];
    currentSVGUrl = url;
    // clear paint canvas
    const rect = canvasWrap.getBoundingClientRect();
    paintCtx.clearRect(0,0,rect.width,rect.height);
    await renderSVGToOutline(url);
  } catch(err){
    console.error('setupRandomImage error', err);
  }
}

// --- Init and event wiring
function bindPointerEvents(){
  // pointer events are used (works on touch and mouse)
  paintCanvas.addEventListener('pointerdown', startDrawing, {passive:false});
  paintCanvas.addEventListener('pointermove', moveDrawing, {passive:false});
  window.addEventListener('pointerup', stopDrawing);

  // also support touch-specific events as fallback (some older browsers)
  paintCanvas.addEventListener('touchstart', startDrawing, {passive:false});
  paintCanvas.addEventListener('touchmove', moveDrawing, {passive:false});
  paintCanvas.addEventListener('touchend', stopDrawing);
  paintCanvas.addEventListener('contextmenu', e => e.preventDefault());
}

let initialized = false;
async function init(){
  if(initialized) return;
  initialized = true;

  // initial resize
  resizeCanvases(false);

  // re-resize when window changes (preserve painting)
  let resizeTimer = null;
  window.addEventListener('resize', ()=> {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(()=> resizeCanvases(true), 120);
  });

  setToolFromUI();
  bindPointerEvents();

  // load first random image
  await setupRandomImage();
}

window.addEventListener('load', init);

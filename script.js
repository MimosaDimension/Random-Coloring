// script.js — Random Coloring with images folder + manifest.json
// Behavior:
// 1) try fetch('/images/manifest.json')
// 2) if success: use that array of filenames
// 3) else: fallback to embedded list (so site still works)
// This allows you to add new images by uploading files to /images and updating manifest.json only.

const outlineCanvas = document.getElementById('outlineCanvas');
const paintCanvas = document.getElementById('paintCanvas');

let tool = 'brush';
let color = '#FF6B6B';
let size = 12;
let drawing = false;
let last = {x:0,y:0};

const fallbackFiles = [
  "images/sample1.svg",
  "images/sample2.svg",
  "images/sample3.svg"
];

// --- UTIL: resize canvases to CSS pixel size
function resizeCanvasesToCSS() {
  const wrap = outlineCanvas.parentElement;
  const rect = wrap.getBoundingClientRect();
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  [outlineCanvas, paintCanvas].forEach(c=>{
    // preserve existing content when resizing (for paintCanvas)
    if(c === paintCanvas && c.width && c.height){
      const temp = document.createElement('canvas');
      temp.width = c.width; temp.height = c.height;
      temp.getContext('2d').drawImage(c, 0,0);
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(temp, 0,0, w, h);
    } else {
      c.width = w; c.height = h;
    }
  });
}

// --- load manifest.json (list of images)
async function loadManifest(){
  try {
    const res = await fetch('images/manifest.json', {cache: "no-store"});
    if(!res.ok) throw new Error('no manifest');
    const list = await res.json();
    if(!Array.isArray(list) || list.length === 0) throw new Error('manifest empty');
    // normalize paths: if names don't include folder, add prefix
    return list.map(name => name.startsWith('images/') ? name : `images/${name}`);
  } catch (e){
    // fallback
    return fallbackFiles;
  }
}

// --- render svg file (from /images/*.svg) to outline canvas
async function renderSVGFileToOutline(url){
  try {
    const res = await fetch(url);
    if(!res.ok) throw new Error('failed fetch svg');
    const svgText = await res.text();
    // create data URL
    const svg64 = btoa(unescape(encodeURIComponent(svgText)));
    const dataUrl = 'data:image/svg+xml;base64,' + svg64;
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const ctx = outlineCanvas.getContext('2d');
    ctx.clearRect(0,0,outlineCanvas.width,outlineCanvas.height);
    // fit image preserving aspect ratio
    const margin = 0.08;
    const cw = outlineCanvas.width, ch = outlineCanvas.height;
    const iw = img.width || 800, ih = img.height || 600;
    const scale = Math.min((1-2*margin)*cw/iw, (1-2*margin)*ch/ih);
    const iwScaled = iw * scale, ihScaled = ih * scale;
    const dx = (cw - iwScaled)/2, dy = (ch - ihScaled)/2;
    ctx.drawImage(img, dx, dy, iwScaled, ihScaled);
  } catch(err){
    console.error('render error', err);
  }
}

// --- drawing and UI
function setToolStateFromUI(){
  document.querySelectorAll('input[name="tool"]').forEach(r=>{
    r.addEventListener('change', e=>{
      tool = e.target.value;
    });
  });
  document.getElementById('colorPicker').addEventListener('input', e=> color = e.target.value);
  document.getElementById('sizeRange').addEventListener('input', e=> size = +e.target.value);
  document.getElementById('backBtn').addEventListener('click', ()=> location.href='index.html');
  document.getElementById('clearBtn').addEventListener('click', ()=> {
    paintCanvas.getContext('2d').clearRect(0,0,paintCanvas.width,paintCanvas.height);
  });
  document.getElementById('saveBtn').addEventListener('click', saveAsPNG);
  document.getElementById('newBtn').addEventListener('click', async ()=> {
    await setupRandomImage();
  });
}

function getPos(ev, canvas){
  const rect = canvas.getBoundingClientRect();
  const x = (ev.clientX ?? ev.touches?.[0]?.clientX) - rect.left;
  const y = (ev.clientY ?? ev.touches?.[0]?.clientY) - rect.top;
  return {x, y};
}

function startDrawing(ev){
  ev.preventDefault();
  drawing = true;
  last = getPos(ev, paintCanvas);
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
  const pos = getPos(ev, paintCanvas);
  drawStroke(last, pos, tool === 'eraser');
  last = pos;
}
function stopDrawing(ev){
  drawing = false;
}

function drawStroke(p0, p1, eraser=false){
  const ctx = paintCanvas.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size;
  if(eraser){
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = color;
  }
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();
  ctx.closePath();
  ctx.globalCompositeOperation = 'source-over';
}

function hexToRgba(hex){
  const h = hex.replace('#','');
  const bigint = parseInt(h.length===3 ? h.split('').map(c=>c+c).join('') : h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return {r,g,b,a:255};
}

function colorMatch(data, idx, color, tol=0){
  return Math.abs(data[idx]-color.r) <= tol &&
         Math.abs(data[idx+1]-color.g) <= tol &&
         Math.abs(data[idx+2]-color.b) <= tol &&
         Math.abs(data[idx+3]-color.a) <= tol;
}

function floodFill(startX, startY, fillColor, tolerance=30){
  const w = paintCanvas.width, h = paintCanvas.height;
  if(startX < 0 || startY < 0 || startX >= w || startY >= h) return;
  const pCtx = paintCanvas.getContext('2d');
  const oCtx = outlineCanvas.getContext('2d');
  const paintImg = pCtx.getImageData(0,0,w,h);
  const outlineImg = oCtx.getImageData(0,0,w,h);

  const data = paintImg.data;
  const odata = outlineImg.data;
  const stack = [];
  const startIdx = (startY * w + startX) * 4;
  const target = {r: data[startIdx], g: data[startIdx+1], b: data[startIdx+2], a: data[startIdx+3]};

  // If clicked on an outline pixel, do nothing
  const outlineAlpha = odata[startIdx+3];
  if(outlineAlpha > 10) return;

  if(Math.abs(target.r - fillColor.r) <= tolerance &&
     Math.abs(target.g - fillColor.g) <= tolerance &&
     Math.abs(target.b - fillColor.b) <= tolerance){
    if(target.a === 255) return;
  }

  stack.push([startX, startY]);
  const visited = new Uint8Array(w * h);

  while(stack.length){
    const [x,y] = stack.pop();
    const idx = (y * w + x);
    const id = idx * 4;
    if(visited[idx]) continue;
    visited[idx] = 1;

    if(odata[id+3] > 10) continue;

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

  pCtx.putImageData(paintImg, 0, 0);
}

async function setupRandomImage(){
  const list = await loadManifest();
  const idx = Math.floor(Math.random() * list.length);
  const url = list[idx];
  // clear paint canvas
  paintCanvas.getContext('2d').clearRect(0,0,paintCanvas.width,paintCanvas.height);
  await renderSVGFileToOutline(url);
}

function saveAsPNG(){
  // combine outline + paint into one canvas and download
  const w = paintCanvas.width, h = paintCanvas.height;
  const combo = document.createElement('canvas');
  combo.width = w; combo.height = h;
  const ctx = combo.getContext('2d');
  // draw outline (as top-level black strokes) but we want outlines visible; draw outline first, then paints
  ctx.drawImage(outlineCanvas, 0,0);
  ctx.drawImage(paintCanvas, 0,0);
  const dataUrl = combo.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = 'coloring.png';
  a.click();
}

// --- init
let initialized = false;
async function init(){
  if(initialized) return;
  initialized = true;
  resizeCanvasesToCSS();
  window.addEventListener('resize', ()=> {
    // preserve painting on resize handled in resizeCanvasesToCSS
    resizeCanvasesToCSS();
  });

  setToolStateFromUI();

  // pointer & touch events
  ['pointerdown','touchstart','mousedown'].forEach(ev => paintCanvas.addEventListener(ev, startDrawing, {passive:false}));
  ['pointermove','touchmove','mousemove'].forEach(ev => paintCanvas.addEventListener(ev, moveDrawing, {passive:false}));
  ['pointerup','touchend','mouseup','mouseleave','touchcancel'].forEach(ev => paintCanvas.addEventListener(ev, stopDrawing));

  paintCanvas.addEventListener('contextmenu', e => e.preventDefault());

  await setupRandomImage();
}

window.addEventListener('load', init);

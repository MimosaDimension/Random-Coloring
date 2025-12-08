const canvas = document.getElementById("paintCanvas");
const ctx = canvas.getContext("2d");
const svgImage = document.getElementById("svgImage");

// ALWAYS FIXED NATIVE SIZE
const SVG_WIDTH = 800;
const SVG_HEIGHT = 600;

let isDrawing = false;
let lastX = 0;
let lastY = 0;

let currentColor = "#000000";
let brushSize = 5;

// Load images randomly
const images = ["images/im1.svg", "images/im2.svg", "images/im3.svg", "images/im4.svg", "images/im5.svg"];

function loadRandomImage() {
    const random = images[Math.floor(Math.random() * images.length)];
    svgImage.src = random;
}
loadRandomImage();

// Resize canvas to match *displayed* size
function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;

    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    redraw();
}

let strokes = [];

function startDrawing(e) {
    isDrawing = true;
    const pos = getPos(e);
    lastX = pos.x;
    lastY = pos.y;
}

function draw(e) {
    if (!isDrawing) return;

    const pos = getPos(e);

    strokes.push({
        x1: lastX,
        y1: lastY,
        x2: pos.x,
        y2: pos.y,
        color: currentColor,
        size: brushSize
    });

    ctx.strokeStyle = currentColor;
    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();

    lastX = pos.x;
    lastY = pos.y;
}

function stopDrawing() {
    isDrawing = false;
}

function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left),
        y: (e.clientY - rect.top)
    };
}

function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / SVG_WIDTH;
    const scaleY = rect.height / SVG_HEIGHT;

    strokes.forEach(s => {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.size;
        ctx.beginPath();
        ctx.moveTo(s.x1 * scaleX, s.y1 * scaleY);
        ctx.lineTo(s.x2 * scaleX, s.y2 * scaleY);
        ctx.stroke();
    });
}

canvas.addEventListener("mousedown", startDrawing);
canvas.addEventListener("mousemove", draw);
canvas.addEventListener("mouseup", stopDrawing);
canvas.addEventListener("mouseleave", stopDrawing);

window.addEventListener("resize", resizeCanvas);
window.addEventListener("load", resizeCanvas);

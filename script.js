// --------------------- RANDOM IMAGE ---------------------

const images = ["im1.svg", "im2.svg", "im3.svg", "im4.svg", "im5.svg"];

const img = document.getElementById("lineArt");
if (img) {
    const random = images[Math.floor(Math.random() * images.length)];
    img.src = "images/" + random;
}

// --------------------- CANVAS SETUP ---------------------

const canvas = document.getElementById("paintCanvas");
const ctx = canvas.getContext("2d");

canvas.width = 800;
canvas.height = 800;

let drawing = false;
let currentColor = "#000000";

// --------------------- UI ELEMENTS ---------------------

const colorPicker = document.getElementById("colorPicker");
const brushSize = document.getElementById("brushSize");
const eraserBtn = document.getElementById("eraserBtn");
const clearBtn = document.getElementById("clearBtn");

// --------------------- EVENTS ---------------------

colorPicker.addEventListener("input", () => {
    currentColor = colorPicker.value;
});

eraserBtn.addEventListener("click", () => {
    currentColor = "#ffffff";
});

clearBtn.addEventListener("click", () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

// --------------------- DRAWING ---------------------

canvas.addEventListener("mousedown", e => {
    drawing = true;
    ctx.beginPath();
    ctx.moveTo(e.offsetX, e.offsetY);
});

canvas.addEventListener("mousemove", e => {
    if (!drawing) return;
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = brushSize.value;
    ctx.lineCap = "round";
    ctx.lineTo(e.offsetX, e.offsetY);
    ctx.stroke();
});

canvas.addEventListener("mouseup", () => drawing = false);
canvas.addEventListener("mouseleave", () => drawing = false);

// --------------------- 100-COLOR PALETTE ---------------------

const bigPalette = document.getElementById("bigPalette");

const palette100 = [
    "#000000","#1a1a1a","#333333","#4d4d4d","#666666",
    "#808080","#999999","#b3b3b3","#cccccc","#e6e6e6",
    "#ffffff","#ff0000","#ff3333","#ff6666","#ff9999",
    "#ffcccc","#cc0000","#990000","#660000","#330000",
    "#ff7f00","#ff9933","#ffb366","#ffcc99","#ffe6cc",

    "#ffff00","#ffff33","#ffff66","#ffff99","#ffffcc",
    "#ccff00","#99ff00","#66ff00","#33ff00","#00ff00",
    "#00ff33","#00ff66","#00ff99","#00ffcc","#00ffff",
    "#00ccff","#0099ff","#0066ff","#0033ff","#0000ff",

    "#3300ff","#6600ff","#9900ff","#cc00ff","#ff00ff",
    "#ff33ff","#ff66ff","#ff99ff","#ffccff","#ff0066",
    "#cc0055","#990044","#660033","#330022","#ff0044",

    "#e60073","#cc0099","#b300b3","#9900cc","#8000e6",
    "#6600ff","#4d00ff","#3300ff","#1a00ff","#0000e6",
    "#0000cc","#0000b3","#000099","#000080","#000066",

    "#004d00","#006600","#008000","#009900","#00b300",
    "#00cc00","#00e600","#00ff00","#33ff33","#66ff66",
    "#99ff99","#ccffcc","#003300","#004d33","#00664d"
];

palette100.forEach(color => {
    const box = document.createElement("div");
    box.className = "big-color-box";
    box.style.backgroundColor = color;
    box.addEventListener("click", () => {
        currentColor = color;
        colorPicker.value = color;
    });
    bigPalette.appendChild(box);
});

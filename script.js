/* ============================================================
   Box reactivo SOLO al desplazamiento (no a la rotación)
   + Panel con RGB y valores del sensor siempre visible
   ============================================================ */

const box      = document.getElementById('box');
const overlay  = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const rgbEl    = document.getElementById('rgb');
const giroEl   = document.getElementById('giro');

/* ---------------- CONFIG ---------------- */
const BASE_COLOR = [80, 80, 80];
const MAX_CM     = 30;

const COLOR_RIGHT   = [120, 120, 255];
const COLOR_LEFT    = [255, 100, 100];
const COLOR_FORWARD = [100, 255, 100];
const COLOR_BACK    = [  0,   0,   0];
const COLOR_UP      = [255, 255, 255];
const COLOR_DOWN    = [  0,   0,   0];

const delta = (c) => [c[0]-BASE_COLOR[0], c[1]-BASE_COLOR[1], c[2]-BASE_COLOR[2]];
const D_RIGHT   = delta(COLOR_RIGHT);
const D_LEFT    = delta(COLOR_LEFT);
const D_FORWARD = delta(COLOR_FORWARD);
const D_BACK    = delta(COLOR_BACK);
const D_UP      = delta(COLOR_UP);
const D_DOWN    = delta(COLOR_DOWN);

const ACCEL_SMOOTH  = 0.60;
const VELOCITY_DAMP = 1.8;
const BIAS_ALPHA    = 0.0005;
const NOISE_GATE    = 0.15;
const MAX_ACCEL     = 15;
const COLOR_SMOOTH  = 0.35;

const ROT_SOFT = 60;
const ROT_HARD = 200;

/* ---------------- ESTADO ---------------- */
const smoothAccel  = { x: 0, y: 0, z: 0 };
const bias         = { x: 0, y: 0, z: 0 };
const velocity     = { x: 0, y: 0, z: 0 };
const position     = { x: 0, y: 0, z: 0 };

// Variables explícitas que verás en el panel
let red   = BASE_COLOR[0];
let green = BASE_COLOR[1];
let blue  = BASE_COLOR[2];

// Valores crudos de sensores
const rawAccel       = { x: 0, y: 0, z: 0 };
const rawRotation    = { a: 0, b: 0, g: 0 };
const rawOrientation = { a: 0, b: 0, g: 0 };
let   lastGateFactor = 1;

let lastTime      = performance.now();
let active        = false;
let sensorWorking = false;
let sensorTimeout = null;
let warnedNoLinear = false;

/* ---------------- UTILS ---------------- */
const clamp = (v, mn, mx) => (v < mn ? mn : v > mx ? mx : v);
const tri   = (x) => { const t = ((x % 2) + 2) % 2; return t < 1 ? t : 2 - t; };

/* ---------------- PANEL (siempre visible) ---------------- */
function updatePanel() {
  // El panel se escribe con innerText y variables explícitas (red, green, blue)
  rgbEl.innerText = `RGB: (${red}, ${green}, ${blue})`;

  giroEl.innerText =
    `Giro °/s   α:${rawRotation.a.toFixed(1)}  β:${rawRotation.b.toFixed(1)}  γ:${rawRotation.g.toFixed(1)}\n` +
    `Accel m/s² x:${rawAccel.x.toFixed(2)}  y:${rawAccel.y.toFixed(2)}  z:${rawAccel.z.toFixed(2)}\n` +
    `Orient °   α:${rawOrientation.a.toFixed(0)}  β:${rawOrientation.b.toFixed(0)}  γ:${rawOrientation.g.toFixed(0)}\n` +
    `Pos cm     x:${position.x.toFixed(1)}  y:${position.y.toFixed(1)}  z:${position.z.toFixed(1)}\n` +
    `Gate: ${lastGateFactor.toFixed(2)}  ·  ${active ? 'activo' : 'inactivo'}`;
}

/* ---------------- SENSOR ---------------- */
function onMotion(event) {
  const a = event.acceleration;
  const hasLinear = a && a.x !== null && a.x !== undefined && !isNaN(a.x);

  if (!hasLinear) {
    if (!warnedNoLinear) {
      warnedNoLinear = true;
      alert(
        'Este navegador no entrega aceleración lineal (sin gravedad).\n\n' +
        'Sin ella, girar el teléfono también movería el color.\n\n' +
        'Prueba con Chrome en Android.'
      );
    }
    return;
  }

  rawAccel.x = a.x; rawAccel.y = a.y; rawAccel.z = a.z;

  // Compuerta de rotación
  const rot = event.rotationRate;
  let gate = 1;
  if (rot && rot.alpha !== null && rot.alpha !== undefined) {
    rawRotation.a = rot.alpha || 0;
    rawRotation.b = rot.beta  || 0;
    rawRotation.g = rot.gamma || 0;

    const rotMag = Math.hypot(rawRotation.a, rawRotation.b, rawRotation.g);
    if (rotMag > ROT_SOFT) {
      gate = Math.max(0, 1 - (rotMag - ROT_SOFT) / (ROT_HARD - ROT_SOFT));
    }
  }
  lastGateFactor = gate;

  if (!sensorWorking) {
    sensorWorking = true;
    if (sensorTimeout) { clearTimeout(sensorTimeout); sensorTimeout = null; }
  }

  const gx = a.x * gate;
  const gy = a.y * gate;
  const gz = a.z * gate;

  smoothAccel.x += (gx - smoothAccel.x) * ACCEL_SMOOTH;
  smoothAccel.y += (gy - smoothAccel.y) * ACCEL_SMOOTH;
  smoothAccel.z += (gz - smoothAccel.z) * ACCEL_SMOOTH;

  bias.x += (gx - bias.x) * BIAS_ALPHA;
  bias.y += (gy - bias.y) * BIAS_ALPHA;
  bias.z += (gz - bias.z) * BIAS_ALPHA;

  // Refresca el panel al menos con cada evento (por si el loop no corre).
  updatePanel();
}

function onOrientation(event) {
  rawOrientation.a = event.alpha ?? 0;
  rawOrientation.b = event.beta  ?? 0;
  rawOrientation.g = event.gamma ?? 0;
  updatePanel();
}

/* ---------------- FÍSICA ---------------- */
function integrate(dt) {
  let ax = smoothAccel.x - bias.x;
  let ay = smoothAccel.y - bias.y;
  let az = smoothAccel.z - bias.z;

  if (Math.abs(ax) < NOISE_GATE) ax = 0;
  if (Math.abs(ay) < NOISE_GATE) ay = 0;
  if (Math.abs(az) < NOISE_GATE) az = 0;

  ax = clamp(ax, -MAX_ACCEL, MAX_ACCEL) * 100;
  ay = clamp(ay, -MAX_ACCEL, MAX_ACCEL) * 100;
  az = clamp(az, -MAX_ACCEL, MAX_ACCEL) * 100;

  velocity.x += ax * dt;
  velocity.y += ay * dt;
  velocity.z += az * dt;

  const damp = Math.exp(-dt * VELOCITY_DAMP);
  velocity.x *= damp;
  velocity.y *= damp;
  velocity.z *= damp;

  position.x += velocity.x * dt;
  position.y += velocity.y * dt;
  position.z += velocity.z * dt;
}

/* ---------------- POSICIÓN → COLOR ---------------- */
function updateColor() {
  const px = position.x, py = position.y, pz = position.z;

  const mx = tri(px / MAX_CM);
  const my = tri(py / MAX_CM);
  const mz = tri(pz / MAX_CM);

  const dX = (px >= 0) ? D_RIGHT   : D_LEFT;
  const dY = (py >= 0) ? D_FORWARD : D_BACK;
  const dZ = (pz >= 0) ? D_UP      : D_DOWN;

  let r = BASE_COLOR[0] + dX[0]*mx + dY[0]*my + dZ[0]*mz;
  let g = BASE_COLOR[1] + dX[1]*mx + dY[1]*my + dZ[1]*mz;
  let b = BASE_COLOR[2] + dX[2]*mx + dY[2]*my + dZ[2]*mz;

  r = clamp(r, 0, 255);
  g = clamp(g, 0, 255);
  b = clamp(b, 0, 255);

  // Suavizado y asignación a las variables explícitas
  red   += (r - red)   * COLOR_SMOOTH;
  green += (g - green) * COLOR_SMOOTH;
  blue  += (b - blue)  * COLOR_SMOOTH;

  box.style.backgroundColor = `rgb(${red|0},${green|0},${blue|0})`;
}

/* ---------------- LOOP ---------------- */
function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  if (active) {
    integrate(dt);
    updateColor();
  }

  // El panel se actualiza SIEMPRE, aunque no esté activo.
  updatePanel();

  requestAnimationFrame(loop);
}

/* ---------------- ARRANQUE ---------------- */
async function start() {
  if (!('DeviceMotionEvent' in window)) {
    alert('ERROR: este navegador no soporta DeviceMotionEvent.\nNecesitas Chrome/Safari actualizado y HTTPS.');
    return;
  }

  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const state = await DeviceMotionEvent.requestPermission();
      if (state !== 'granted') {
        alert('Permiso DENEGADO.\niOS: Ajustes → Safari → Movimiento y orientación');
        return;
      }
    } catch (err) {
      alert('Error pidiendo permiso:\n' + (err?.message ?? err));
      return;
    }
  }

  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try { await DeviceOrientationEvent.requestPermission(); } catch (_) {}
  }

  window.addEventListener('devicemotion', onMotion, { passive: true });
  window.addEventListener('deviceorientation', onOrientation, { passive: true });

  sensorTimeout = setTimeout(() => {
    if (!sensorWorking) {
      alert('No llegan datos del sensor.\n\n• ¿HTTPS o localhost?\n• ¿Permisos bloqueados?\n• ¿Dispositivo sin acelerómetro?');
    }
  }, 2000);

  overlay.classList.add('hidden');
  active = true;
  lastTime = performance.now();
}

startBtn.addEventListener('click', start);

/* ---------------- ALERTS GLOBALES ---------------- */
window.addEventListener('error', (e) => alert('Error JS: ' + (e.message || 'desconocido')));
window.addEventListener('unhandledrejection', (e) => alert('Promesa rechazada: ' + (e.reason?.message ?? e.reason)));

/* ---------------- ARRANQUE INMEDIATO DEL PANEL ---------------- */
// Pinta el panel desde el primer instante, ANTES de pulsar el botón.
updatePanel();
requestAnimationFrame(loop);
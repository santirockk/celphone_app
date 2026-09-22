/* ============================================================
   Box reactivo al movimiento del teléfono
   ------------------------------------------------------------
   Supuestos:
   • El teléfono está plano sobre la mesa, pantalla hacia arriba.
   • Ejes del dispositivo:
       +x  derecha del usuario     → AZUL
       -x  izquierda del usuario   → ROJO
       +y  adelante (alejándose)   → VERDE
       -y  atrás (hacia el user)   → NEGRO
       +z  arriba (levantándolo)   → BLANCO
       -z  abajo                   → NEGRO

   Comportamiento:
   • Se integra 2× la aceleración (con bias quitado) → cm reales.
   • El color = onda triangular sobre el desplazamiento:
       0 cm  = base
       30 cm = color completo
       60 cm = base
       90 cm = color completo... y sigue ciclando.
   • Sin retorno automático: si te pasas del color, sigue moviendo
     en la misma dirección y la onda te devuelve al gris.
   ============================================================ */

const box      = document.getElementById('box');
const overlay  = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');

/* ---------------- CONFIGURACIÓN ---------------- */

const BASE_COLOR = [80, 80, 80];      // debe coincidir con el CSS
const MAX_CM     = 30;                // 30 cm → color completo

const COLOR_RIGHT   = [120, 120, 255]; // +x → azul
const COLOR_LEFT    = [255, 100, 100]; // -x → rojo
const COLOR_FORWARD = [100, 255, 100]; // +y → verde
const COLOR_BACK    = [  0,   0,   0]; // -y → negro
const COLOR_UP      = [255, 255, 255]; // +z → blanco
const COLOR_DOWN    = [  0,   0,   0]; // -z → negro

// Deltas respecto al gris (para mezcla aditiva limpia)
const delta = (c) => [c[0]-BASE_COLOR[0], c[1]-BASE_COLOR[1], c[2]-BASE_COLOR[2]];
const D_RIGHT   = delta(COLOR_RIGHT);
const D_LEFT    = delta(COLOR_LEFT);
const D_FORWARD = delta(COLOR_FORWARD);
const D_BACK    = delta(COLOR_BACK);
const D_UP      = delta(COLOR_UP);
const D_DOWN    = delta(COLOR_DOWN);

// --- Física / respuesta (ajusta si quieres otro feel) ---
const ACCEL_SMOOTH  = 0.55;   // 0..1  mayor = responde más rápido (pero más ruidoso)
const VELOCITY_DAMP = 2.0;    // mayor = frena antes (no retorna posición)
const BIAS_ALPHA    = 0.001;  // filtro muy lento que elimina la deriva del sensor
const NOISE_GATE    = 0.10;   // m/s²  ignora micro-vibraciones
const MAX_ACCEL     = 20;     // m/s²  recorte anti-picos absurdos
const COLOR_SMOOTH  = 0.35;   // suavizado visual del color final

/* ---------------- ESTADO ---------------- */
const smoothAccel  = { x: 0, y: 0, z: 0 };
const bias         = { x: 0, y: 0, z: 0 };
const velocity     = { x: 0, y: 0, z: 0 };
const position     = { x: 0, y: 0, z: 0 };
const currentColor = [...BASE_COLOR];

let lastTime      = performance.now();
let active        = false;
let sensorWorking = false;
let sensorTimeout = null;

/* ---------------- UTILS ---------------- */
const clamp = (v, mn, mx) => (v < mn ? mn : v > mx ? mx : v);

// Onda triangular con periodo 2, acepta x negativos.
// tri(0)=0  tri(1)=1  tri(2)=0  tri(3)=1 ...
function tri(x) {
  const t = ((x % 2) + 2) % 2;
  return t < 1 ? t : 2 - t;
}

/* ---------------- SENSOR ---------------- */
function onMotion(event) {
  let ax = null, ay = null, az = null;

  const a = event.acceleration;
  if (a && a.x !== null && a.x !== undefined && !isNaN(a.x)) {
    // iOS y muchos Android: aceleración SIN gravedad, ideal.
    ax = a.x; ay = a.y; az = a.z;
  } else {
    const g = event.accelerationIncludingGravity;
    if (g && g.x !== null && g.x !== undefined && !isNaN(g.x)) {
      // Fallback Android: quitamos gravedad con un paso-bajo rápido.
      smoothAccel.x = smoothAccel.x * 0.9 + g.x * 0.1;
      smoothAccel.y = smoothAccel.y * 0.9 + g.y * 0.1;
      smoothAccel.z = smoothAccel.z * 0.9 + g.z * 0.1;
      ax = g.x - smoothAccel.x;
      ay = g.y - smoothAccel.y;
      az = g.z - smoothAccel.z;
    }
  }

  if (ax === null) return;

  // Primer dato válido → apagamos el chequeo de timeout.
  if (!sensorWorking) {
    sensorWorking = true;
    if (sensorTimeout) { clearTimeout(sensorTimeout); sensorTimeout = null; }
  }

  // Suavizado ligero (respuesta rápida).
  smoothAccel.x += (ax - smoothAccel.x) * ACCEL_SMOOTH;
  smoothAccel.y += (ay - smoothAccel.y) * ACCEL_SMOOTH;
  smoothAccel.z += (az - smoothAccel.z) * ACCEL_SMOOTH;

  // Bias muy lento: quita la componente DC (deriva del sensor en reposo).
  bias.x += (ax - bias.x) * BIAS_ALPHA;
  bias.y += (ay - bias.y) * BIAS_ALPHA;
  bias.z += (az - bias.z) * BIAS_ALPHA;
}

/* ---------------- FÍSICA ---------------- */
function integrate(dt) {
  // Aceleración neta (sin bias).
  let ax = smoothAccel.x - bias.x;
  let ay = smoothAccel.y - bias.y;
  let az = smoothAccel.z - bias.z;

  // Noise gate → evita que el ruido de reposo mueva la posición.
  if (Math.abs(ax) < NOISE_GATE) ax = 0;
  if (Math.abs(ay) < NOISE_GATE) ay = 0;
  if (Math.abs(az) < NOISE_GATE) az = 0;

  // Recorte anti-picos.
  ax = clamp(ax, -MAX_ACCEL, MAX_ACCEL);
  ay = clamp(ay, -MAX_ACCEL, MAX_ACCEL);
  az = clamp(az, -MAX_ACCEL, MAX_ACCEL);

  // m/s² → cm/s²
  ax *= 100; ay *= 100; az *= 100;

  // v += a·dt
  velocity.x += ax * dt;
  velocity.y += ay * dt;
  velocity.z += az * dt;

  // Amortiguación (solo sobre velocidad, NO retorna posición).
  const damp = Math.exp(-dt * VELOCITY_DAMP);
  velocity.x *= damp;
  velocity.y *= damp;
  velocity.z *= damp;

  // p += v·dt
  position.x += velocity.x * dt;
  position.y += velocity.y * dt;
  position.z += velocity.z * dt;
}

/* ---------------- POSICIÓN → COLOR ---------------- */
function updateColor() {
  const px = position.x;
  const py = position.y;
  const pz = position.z;

  // Magnitud (0..1) según la onda triangular: base→full→base→full...
  const mx = tri(px / MAX_CM);
  const my = tri(py / MAX_CM);
  const mz = tri(pz / MAX_CM);

  // Signo → elegir el color del par positivo/negativo.
  const dX = (px >= 0) ? D_RIGHT   : D_LEFT;
  const dY = (py >= 0) ? D_FORWARD : D_BACK;
  const dZ = (pz >= 0) ? D_UP      : D_DOWN;

  // Mezcla aditiva (las diagonales se combinan solas).
  let r = BASE_COLOR[0] + dX[0]*mx + dY[0]*my + dZ[0]*mz;
  let g = BASE_COLOR[1] + dX[1]*mx + dY[1]*my + dZ[1]*mz;
  let b = BASE_COLOR[2] + dX[2]*mx + dY[2]*my + dZ[2]*mz;

  r = clamp(r, 0, 255);
  g = clamp(g, 0, 255);
  b = clamp(b, 0, 255);

  // Suavizado final (transición agradable).
  currentColor[0] += (r - currentColor[0]) * COLOR_SMOOTH;
  currentColor[1] += (g - currentColor[1]) * COLOR_SMOOTH;
  currentColor[2] += (b - currentColor[2]) * COLOR_SMOOTH;

  box.style.backgroundColor =
    `rgb(${currentColor[0]|0},${currentColor[1]|0},${currentColor[2]|0})`;
}

/* ---------------- LOOP ---------------- */
function loop(now) {
  if (!active) return;
  const dt = Math.min((now - lastTime) / 1000, 0.05); // cap 50 ms
  lastTime = now;

  integrate(dt);
  updateColor();

  requestAnimationFrame(loop);
}

/* ---------------- ARRANQUE Y PERMISOS ---------------- */
async function start() {
  if (!('DeviceMotionEvent' in window)) {
    alert(
      'ERROR: este navegador no soporta DeviceMotionEvent.\n\n' +
      'Necesitas Chrome/Safari actualizado y HTTPS.'
    );
    return;
  }

  // iOS 13+ y algunos Chrome requieren permiso explícito por gesto del usuario.
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const state = await DeviceMotionEvent.requestPermission();
      if (state !== 'granted') {
        alert(
          'Permiso del sensor DENEGADO.\n\n' +
          'Actívalo en:\n' +
          'iOS: Ajustes → Safari → Movimiento y orientación\n' +
          '     (o vuelve a pulsar el botón y elige "Permitir").'
        );
        return;
      }
    } catch (err) {
      alert('Error pidiendo permiso del sensor:\n' + (err && err.message ? err.message : err));
      return;
    }
  }

  window.addEventListener('devicemotion', onMotion, { passive: true });

  // Si en 2 s no llega ningún dato → alerta informativa.
  sensorTimeout = setTimeout(() => {
    if (!sensorWorking) {
      alert(
        'No llegan datos del sensor.\n\n' +
        'Posibles causas:\n' +
        '• La página no está en HTTPS ni en localhost.\n' +
        '• El navegador está bloqueando el sensor (Privacidad).\n' +
        '• El dispositivo no tiene acelerómetro.'
      );
    }
  }, 2000);

  overlay.classList.add('hidden');

  setTimeout(() => {
    active = true;
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }, 100);
}

startBtn.addEventListener('click', start);

/* ---------------- ALERTS GLOBALES ---------------- */
// En el móvil no hay consola → mostramos los errores como alert.
window.addEventListener('error', (e) => {
  alert('Error JS: ' + (e.message || (e.error && e.error.message) || 'desconocido'));
});
window.addEventListener('unhandledrejection', (e) => {
  alert('Promesa rechazada: ' +
        (e.reason && e.reason.message ? e.reason.message : e.reason));
});
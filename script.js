/* ============================================================
   Box reactivo al movimiento del teléfono
   ------------------------------------------------------------
   • Aceleración lineal (sin gravedad) → doble integración → cm
   • 30 cm de desplazamiento = color completo en esa dirección
   • Mezcla aditiva de deltas respecto al color base
   • Muelle suave para evitar la deriva del acelerómetro
   ============================================================ */

const box      = document.getElementById('box');
const overlay  = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');

/* ------------------------------------------------------------
   1) CONFIGURACIÓN  (ajusta aquí si quieres otro comportamiento)
   ------------------------------------------------------------ */

const BASE_COLOR       = [120, 120, 120];  // color en reposo
const MAX_DISTANCE_CM  = 30;               // 30 cm → color completo
const MAX_ACCEL        = 25;               // m/s², límite anti-picos

// Colores objetivo en cada dirección
const COLOR_RIGHT   = [120, 120, 255]; // → derecha   : azul
const COLOR_LEFT    = [255, 100, 100]; // → izquierda : rojo
const COLOR_FORWARD = [100, 255, 100]; // → adelante  : verde
const COLOR_BACK    = [  0,   0,   0]; // → atrás     : negro
const COLOR_UP      = [255, 255, 255]; // → arriba    : blanco
const COLOR_DOWN    = [ 40,  40,  40]; // → abajo     : oscuro (no especificado)

// Deltas respecto al color base (así la mezcla es aditiva y limpia)
const delta = (c) => [c[0] - BASE_COLOR[0], c[1] - BASE_COLOR[1], c[2] - BASE_COLOR[2]];

const D_RIGHT   = delta(COLOR_RIGHT);
const D_LEFT    = delta(COLOR_LEFT);
const D_FORWARD = delta(COLOR_FORWARD);
const D_BACK    = delta(COLOR_BACK);
const D_UP      = delta(COLOR_UP);
const D_DOWN    = delta(COLOR_DOWN);

// --- Constantes de la simulación (tuneables) ---
const FRICTION       = 1.6;   // amortiguación de la velocidad (mayor = más frenado)
const SPRING         = 0.55;  // retorno al centro (mayor = vuelve antes al color base)
const ACCEL_SMOOTH   = 0.5;   // suavizado de la aceleración (0..1)
const COLOR_SMOOTH   = 0.20;  // suavizado del color final (0..1, menor = más lento)

/* ------------------------------------------------------------
   2) ESTADO
   ------------------------------------------------------------ */

const accel    = { x: 0, y: 0, z: 0 };  // m/s² (suavizado)
const velocity = { x: 0, y: 0, z: 0 };  // cm/s
const position = { x: 0, y: 0, z: 0 };  // cm

const currentColor = [...BASE_COLOR];

let lastTime   = performance.now();
let active     = false;
let gravity    = { x: 0, y: 0, z: 0 };
let gravitySet = false;

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

/* ------------------------------------------------------------
   3) LECTURA DEL SENSOR
   ------------------------------------------------------------ */

function onMotion(event) {
  let ax, ay, az;

  // Caso ideal: aceleración lineal sin gravedad
  if (event.acceleration &&
      event.acceleration.x !== null &&
      event.acceleration.x !== undefined) {
    ax = event.acceleration.x;
    ay = event.acceleration.y;
    az = event.acceleration.z;
  }
  // Fallback: restamos la gravedad estimada con un paso-bajo
  else if (event.accelerationIncludingGravity &&
           event.accelerationIncludingGravity.x !== null) {
    const g = event.accelerationIncludingGravity;

    if (!gravitySet) {
      gravity = { x: g.x, y: g.y, z: g.z };
      gravitySet = true;
    }
    const k = 0.92;
    gravity.x = gravity.x * k + g.x * (1 - k);
    gravity.y = gravity.y * k + g.y * (1 - k);
    gravity.z = gravity.z * k + g.z * (1 - k);

    ax = g.x - gravity.x;
    ay = g.y - gravity.y;
    az = g.z - gravity.z;
  } else {
    return;
  }

  // Limitamos picos y suavizamos
  const tx = clamp(ax, -MAX_ACCEL, MAX_ACCEL);
  const ty = clamp(ay, -MAX_ACCEL, MAX_ACCEL);
  const tz = clamp(az, -MAX_ACCEL, MAX_ACCEL);

  accel.x += (tx - accel.x) * ACCEL_SMOOTH;
  accel.y += (ty - accel.y) * ACCEL_SMOOTH;
  accel.z += (tz - accel.z) * ACCEL_SMOOTH;
}

/* ------------------------------------------------------------
   4) FÍSICA: aceleración → velocidad → posición
   ------------------------------------------------------------ */

function integrate(dt) {
  // m/s² → cm/s²
  const ax = accel.x * 100;
  const ay = accel.y * 100;
  const az = accel.z * 100;

  // v += a·dt
  velocity.x += ax * dt;
  velocity.y += ay * dt;
  velocity.z += az * dt;

  // Fricción
  const fr = Math.exp(-dt * FRICTION);
  velocity.x *= fr;
  velocity.y *= fr;
  velocity.z *= fr;

  // p += v·dt
  position.x += velocity.x * dt;
  position.y += velocity.y * dt;
  position.z += velocity.z * dt;

  // Muelle suave hacia el centro (corrige la deriva del sensor)
  const sp = Math.exp(-dt * SPRING);
  position.x *= sp;
  position.y *= sp;
  position.z *= sp;
}

/* ------------------------------------------------------------
   5) POSICIÓN → COLOR
   ------------------------------------------------------------ */

function updateColor() {
  // Normalizamos cada eje a [-1, 1] con 30 cm = 1
  //
  // NOTA sobre ejes del dispositivo (asumiendo teléfono en vertical,
  // pantalla hacia ti):
  //   device +x  →  derecha del mundo     → azul
  //   device +y  →  arriba del mundo      → blanco
  //   device -z  →  adelante (alejándote) → verde
  let tx =  position.x / MAX_DISTANCE_CM;
  let ty =  position.y / MAX_DISTANCE_CM;
  let tz = -position.z / MAX_DISTANCE_CM;

  // Si el vector supera la magnitud de 30 cm, lo normalizamos
  // (así las diagonales no saturan el color)
  const mag = Math.hypot(tx, ty, tz);
  if (mag > 1) {
    tx /= mag;
    ty /= mag;
    tz /= mag;
  }

  // Mezcla aditiva: partimos del color base y sumamos los deltas
  let r = BASE_COLOR[0];
  let g = BASE_COLOR[1];
  let b = BASE_COLOR[2];

  const axes = [
    [tx, D_RIGHT,   D_LEFT   ],  // eje X
    [ty, D_UP,      D_DOWN   ],  // eje Y
    [tz, D_FORWARD, D_BACK   ],  // eje Z
  ];

  for (const [t, dPos, dNeg] of axes) {
    const d = t >= 0 ? dPos : dNeg;
    const w = Math.abs(t);
    r += d[0] * w;
    g += d[1] * w;
    b += d[2] * w;
  }

  r = clamp(r, 0, 255);
  g = clamp(g, 0, 255);
  b = clamp(b, 0, 255);

  // Suavizado final → transiciones agradables
  currentColor[0] += (r - currentColor[0]) * COLOR_SMOOTH;
  currentColor[1] += (g - currentColor[1]) * COLOR_SMOOTH;
  currentColor[2] += (b - currentColor[2]) * COLOR_SMOOTH;

  box.style.backgroundColor =
    `rgb(${currentColor[0] | 0}, ${currentColor[1] | 0}, ${currentColor[2] | 0})`;
}

/* ------------------------------------------------------------
   6) BUCLE PRINCIPAL
   ------------------------------------------------------------ */

function loop(now) {
  if (!active) return;

  const dt = Math.min((now - lastTime) / 1000, 0.05); // máx 50 ms
  lastTime = now;

  integrate(dt);
  updateColor();

  requestAnimationFrame(loop);
}

/* ------------------------------------------------------------
   7) ACTIVACIÓN + PERMISOS
   ------------------------------------------------------------ */

async function start() {
  // ¿El navegador soporta devicemotion?
  if (!('DeviceMotionEvent' in window)) {
    alert('Este navegador no soporta el acelerómetro.');
    return;
  }

  // iOS 13+ (y algunos Android) requieren permiso explícito
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const state = await DeviceMotionEvent.requestPermission();
      if (state !== 'granted') {
        alert('Permiso denegado. No se puede acceder al acelerómetro.');
        return;
      }
    } catch (err) {
      console.error('Error solicitando permiso:', err);
      alert('No se pudo solicitar el permiso del sensor.');
      return;
    }
  }

  window.addEventListener('devicemotion', onMotion, { passive: true });

  overlay.classList.add('hidden');

  // Pequeño delay para que la transición del overlay no compita
  setTimeout(() => {
    active = true;
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }, 100);
}

startBtn.addEventListener('click', start);

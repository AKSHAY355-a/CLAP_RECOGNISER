const counterEl = document.getElementById("counter");
const initialCount = 10;
let count = initialCount;
const threshold = 0.25; // sensitivity (clap threshold)
let lastClap = 0;

function updateCounterDisplay() {
  counterEl.textContent = String(count);
}

function triggerCounterPop() {
  counterEl.classList.remove('pop');
  void counterEl.offsetWidth; // reflow to restart animation
  counterEl.classList.add('pop');
}

updateCounterDisplay();

// Unified audio pipeline shared by countdown and Hamming ball
let audioContext, analyser, timeDomain;
let latestRms = 0;
let rmsSmoothed = 0; // exponential moving average for stability
let visualLevel = 0; // normalized 0..1 for visuals

// Ambient calibration to reduce oversensitivity in quiet rooms
let calibrating = true;
let noiseFloor = 0;
let noiseFloorAccum = 0;
let noiseFloorSamples = 0;
const CALIBRATION_TARGET_SAMPLES = 60; // ~1s at 60fps

navigator.mediaDevices.getUserMedia({ audio: true })
.then(stream => {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  timeDomain = new Float32Array(analyser.fftSize);
})
.catch(err => {
  console.error("Mic access denied:", err);
});

function tick() {
  requestAnimationFrame(tick);
  if (!analyser || !timeDomain) return;
  analyser.getFloatTimeDomainData(timeDomain);
  // Calculate volume (RMS)
  let sum = 0;
  for (let i = 0; i < timeDomain.length; i++) {
    const v = timeDomain[i];
    sum += v * v;
  }
  const rms = Math.sqrt(sum / timeDomain.length);
  latestRms = rms;

  // Gather noise floor during initial calibration window
  if (calibrating && noiseFloorSamples < CALIBRATION_TARGET_SAMPLES) {
    noiseFloorAccum += rms;
    noiseFloorSamples += 1;
    if (noiseFloorSamples === CALIBRATION_TARGET_SAMPLES) {
      noiseFloor = noiseFloorAccum / noiseFloorSamples;
      calibrating = false;
    }
  }

  // Smooth RMS to avoid jittery visuals; quicker attack than release
  if (rmsSmoothed === 0) {
    rmsSmoothed = rms;
  } else {
    const alpha = 0.15; // 0..1 (higher = more responsive)
    rmsSmoothed = rmsSmoothed * (1 - alpha) + rms * alpha;
  }

  // Derive a normalized visual level with a deadzone near the ambient floor
  // Start mapping near the midpoint between floor and threshold
  const floorRef = calibrating ? 0 : noiseFloor;
  const visualStart = Math.min(floorRef + 0.35 * (threshold - floorRef), threshold * 0.65);
  const denom = Math.max(threshold - visualStart, 1e-6);
  const levelRaw = (rmsSmoothed - visualStart) / denom;
  visualLevel = Math.max(0, Math.min(levelRaw, 1));
  // Clap detection
  if (rms > threshold) {
    const now = Date.now();
    if (now - lastClap > 500) {
      if (count > 0) {
        count -= 1;
        updateCounterDisplay();
        triggerCounterPop();
      }
      if (count === 0) {
        setTimeout(() => {
          window.location.href = "http://apps.bbhegdecollege.com:5020/home";
        }, 1200);
      }
      lastClap = now;
    }
  }
}
tick();

let scene = new THREE.Scene();
let camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
let renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  powerPreference: "high-performance"
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // High DPI support
document.body.appendChild(renderer.domElement);

// Google News Color Palette
const googleColors = [
  0x174EA6, // Blue
  0xA50E0E, // Red
  0xE37400, // Orange
  0x0D652D, // Green
  0x4285F4, // Medium blue
  0xEA4335, // Medium red
  0xFBBC04, // Yellow
  0x34A853, // Medium green
  0xD2E3FC, // Light blue
  0xFAD2CF, // Light red
  0xFEEFC3, // Light yellow
  0xCEEAD6, // Light green
  0x9AA0A6, // Grey
  0x202124  // Black
];

// Particle system
let geometry = new THREE.BufferGeometry();
let particleCount = 400;
let positions = [];
let colors = [];

// Per-particle appearance
let sizes = [];
let phases = [];

// Per-particle spherical coords and motion
let phis = new Float32Array(particleCount);
let thetas = new Float32Array(particleCount);
let radii = new Float32Array(particleCount);
let dPhi = new Float32Array(particleCount);
let dTheta = new Float32Array(particleCount);
for (let i = 0; i < particleCount; i++) {
  let phi = Math.acos(2 * Math.random() - 1);
  let theta = 2 * Math.PI * Math.random();
  let radius = 1.5 + (Math.random() - 0.5) * 0.1; // slight variation
  let x = radius * Math.sin(phi) * Math.cos(theta);
  let y = radius * Math.sin(phi) * Math.sin(theta);
  let z = radius * Math.cos(phi);
  positions.push(x, y, z);

  // store spherical and small angular velocities
  phis[i] = phi;
  thetas[i] = theta;
  radii[i] = radius;
  dPhi[i] = (Math.random() - 0.5) * 0.006;   // slow drift
  dTheta[i] = (Math.random() - 0.5) * 0.012; // slow drift

  // visual variations
  sizes.push(0.85 + Math.random() * 0.6); // per-particle size multiplier
  phases.push(Math.random() * Math.PI * 2); // twinkle phase

  // Use Google News colors randomly
  let googleColor = new THREE.Color(googleColors[Math.floor(Math.random() * googleColors.length)]);
  colors.push(googleColor.r, googleColor.g, googleColor.b);
}
geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
geometry.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));
geometry.setAttribute("phase", new THREE.Float32BufferAttribute(phases, 1));

// Shader-based crisp circular points (analytic anti-aliased discs)
const BASE_POINT_SIZE = 2.9; // +10% larger than previous size
const material = new THREE.ShaderMaterial({
  vertexColors: true,
  transparent: true,
  depthTest: true,
  blending: THREE.NormalBlending,
  uniforms: {
    uSize: { value: BASE_POINT_SIZE * renderer.getPixelRatio() },
    uTime: { value: 0.0 },
    uAudio: { value: 0.0 }
  },
  vertexShader: `
    varying vec3 vColor;
    varying float vPhase;
    attribute float size;
    attribute float phase;
    uniform float uSize;
    uniform float uTime;
    uniform float uAudio;
    void main() {
      vColor = color;
      vPhase = phase;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      // Constant on-screen size with per-particle size and audio pulse
      float tw = 0.9 + 0.2 * sin(uTime + phase);
      float px = uSize * size * (1.0 + 0.35 * uAudio) * tw;
      gl_PointSize = max(px, 1.0);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec3 vColor;
    varying float vPhase;
    uniform float uTime;
    // Use derivatives for smooth edges
    #ifdef GL_OES_standard_derivatives
    #extension GL_OES_standard_derivatives : enable
    #endif
    void main() {
      // distance from center in [0, ~0.707]
      vec2 p = gl_PointCoord - vec2(0.5);
      float d = length(p);
      // analytic anti-aliased edge using derivative width when available
      float edge = 0.01;
      #ifdef GL_OES_standard_derivatives
        edge = fwidth(d);
      #endif
      float alpha = 1.0 - smoothstep(0.5, 0.5 + edge, d);
      if (alpha <= 0.003) discard;
      // subtle lighting and twinkle
      float shade = 0.9 + 0.1 * (1.0 - smoothstep(0.0, 0.5, d));
      float tw = 0.9 + 0.1 * sin(uTime * 1.5 + vPhase);
      vec3 col = vColor * shade * tw;
      gl_FragColor = vec4(col, alpha);
    }
  `,
  extensions: { derivatives: true }
});
let points = new THREE.Points(geometry, material);
scene.add(points);

camera.position.z = 4;

// Animation loop
function animate() {
  requestAnimationFrame(animate);

  // Update particle positions for smooth motion on sphere
  const pos = geometry.attributes.position.array;
  const t = performance.now() * 0.001;
  material.uniforms.uTime.value = t;
  for (let i = 0, j = 0; i < particleCount; i++, j += 3) {
    // evolve spherical angles
    phis[i] += dPhi[i];
    thetas[i] += dTheta[i];
    // tiny breathing radius
    const r = radii[i] + 0.05 * Math.sin(t * 0.6 + i * 0.37);
    const sp = Math.sin(phis[i]);
    pos[j]     = r * sp * Math.cos(thetas[i]);
    pos[j + 1] = r * sp * Math.sin(thetas[i]);
    pos[j + 2] = r * Math.cos(phis[i]);
  }
  geometry.attributes.position.needsUpdate = true;

  if (analyser) {
    material.uniforms.uAudio.value = visualLevel;
    let scale = 1 + visualLevel * 0.4; // less sensitive scaling
    points.scale.set(scale, scale, scale);

    // Make them gently rotate like Google’s
    points.rotation.y += 0.003;
    points.rotation.x += 0.001;
  }

  renderer.render(scene, camera);
}
animate();

// Handle window resize while maintaining quality
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  if (material && material.uniforms && material.uniforms.uSize) {
    material.uniforms.uSize.value = BASE_POINT_SIZE * renderer.getPixelRatio();
  }
});
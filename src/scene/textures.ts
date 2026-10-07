// Procedural textures and the sky dome: no image assets to load or license.

import * as THREE from "three";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext("2d")! };
}

function finish(c: HTMLCanvasElement, repeat: [number, number], aniso = 4) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = aniso;
  return t;
}

/** Deterministic noise so textures look the same on every load. */
function rand(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, rgb: [number, number, number], spread: number, alpha: number, seed: number, size = 2) {
  const r = rand(seed);
  for (let i = 0; i < n; i++) {
    const k = (r() - 0.5) * spread;
    ctx.fillStyle = `rgba(${rgb[0] + k},${rgb[1] + k},${rgb[2] + k * 0.6},${alpha})`;
    ctx.fillRect(r() * w, r() * h, size, size);
  }
}

/** Mowed grass: a two-tone checkerboard with blade grain. One tile = two stripes each way. */
export function grassTexture(repeat: [number, number]) {
  const { c, ctx } = canvas(512, 512);
  const a = "#4f8f3c";
  const b = "#5d9e47";
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j) % 2 ? a : b;
      ctx.fillRect(i * 256, j * 256, 256, 256);
    }
  grain(ctx, 512, 512, 26000, [78, 140, 60], 40, 0.25, 7, 1.5);
  return finish(c, repeat);
}

export function dirtTexture(repeat: [number, number]) {
  const { c, ctx } = canvas(512, 512);
  ctx.fillStyle = "#b4835a";
  ctx.fillRect(0, 0, 512, 512);
  grain(ctx, 512, 512, 30000, [170, 122, 84], 50, 0.35, 11, 2);
  const r = rand(3);
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(120,82,52,${0.05 + r() * 0.08})`;
    ctx.beginPath();
    ctx.arc(r() * 512, r() * 512, 8 + r() * 30, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(c, repeat);
}

/** Maple planks along x, staggered joints, light grain. */
export function woodTexture(repeat: [number, number]) {
  const { c, ctx } = canvas(512, 512);
  const r = rand(5);
  const rows = 8;
  const h = 512 / rows;
  for (let row = 0; row < rows; row++) {
    let x = -r() * 200;
    while (x < 512) {
      const w = 160 + r() * 220;
      const tone = 196 + r() * 26;
      ctx.fillStyle = `rgb(${tone},${tone * 0.78},${tone * 0.55})`;
      ctx.fillRect(x, row * h, w, h);
      ctx.strokeStyle = "rgba(90,60,35,0.35)";
      ctx.strokeRect(x + 0.5, row * h + 0.5, w, h);
      for (let g = 0; g < 7; g++) {
        ctx.strokeStyle = `rgba(140,95,55,${0.08 + r() * 0.1})`;
        ctx.beginPath();
        const y = row * h + r() * h;
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + w / 3, y + (r() - 0.5) * 6, x + (2 * w) / 3, y + (r() - 0.5) * 6, x + w, y);
        ctx.stroke();
      }
      x += w;
    }
  }
  return finish(c, repeat);
}

/** Court paint: flat color with a faint satin sheen. */
export function paintTexture(color: string, repeat: [number, number], seed = 9) {
  const { c, ctx } = canvas(256, 256);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 256, 256);
  grain(ctx, 256, 256, 5000, [255, 255, 255], 0, 0.035, seed, 2);
  return finish(c, repeat);
}

/** Square-mesh net, white top band drawn separately. */
export function netTexture(repeat: [number, number]) {
  const { c, ctx } = canvas(64, 64);
  ctx.strokeStyle = "rgba(18,18,18,0.92)";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, 61, 61);
  return finish(c, repeat, 4);
}

/** Large inverted sphere with a vertical gradient, so the sky stays put when you orbit. */
export function skyDome(top: number, horizon: number, ground: number, radius = 600) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(top) }, horizon: { value: new THREE.Color(horizon) }, ground: { value: new THREE.Color(ground) } },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vDir;
      void main() { float h = vDir.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(horizon, ground, clamp(-h * 6.0, 0.0, 1.0));
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  m.renderOrder = -1;
  m.frustumCulled = false;
  return m;
}

/** Soft radial sprite (halo / glow), white; tint with the material color. */
export function glowTexture() {
  const { c, ctx } = canvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Vertical gradient for the flow lab's backdrop (a wind-tunnel dusk). */
export function backdropTexture(top: string, bottom: string) {
  const { c, ctx } = canvas(4, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

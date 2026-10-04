const vertexSource = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const fragmentSource = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif
  uniform vec2 u_resolution;
  uniform float u_time;
  varying vec2 v_uv;

  float hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
  }
  float tissue(vec2 p) {
    return noise(p) * 0.57 + noise(p * 2.13 + 4.7) * 0.28
         + noise(p * 4.37 + 9.1) * 0.15;
  }
  vec2 rotate(vec2 p, float angle) {
    float c = cos(angle), s = sin(angle);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }
  float boundary(vec2 q, float seed) {
    // Asymmetric sheet edges; each layer is a separate, bounded surface.
    q.x += q.y * q.y * 0.14 + (noise(q * 2.0 + seed) - 0.5) * 0.07;
    float ellipse = length(q * vec2(1.0, 1.0 + q.x * 0.12));
    return ellipse - 1.0 + (noise(q * 42.0 + seed) - 0.5) * 0.006;
  }
  vec3 sheet(vec3 below, vec2 p, vec2 center, vec2 size, float angle,
             float seed, float depth, float opacity) {
    float t = u_time;
    // Independent small drifts, rather than a wave sweeping across the screen.
    center += vec2(sin(t * 0.075 + seed), cos(t * 0.061 + seed)) * 0.018;
    vec2 q = rotate(p - center, angle + sin(t * 0.047 + seed) * 0.018) / size;
    float focalPlane = sin(t * 0.15 + seed) * 0.22 - 0.1;
    float focus = 1.0 - smoothstep(0.12, 0.95, abs(q.y + q.x * 0.18 - focalPlane));
    float blur = depth + (1.0 - focus) * 0.016;
    float edge = boundary(q, seed);
    float mask = 1.0 - smoothstep(-blur, blur, edge);
    // Soft transmission and a shadow beneath the next sheet create depth.
    float shadowEdge = boundary(q + vec2(-0.025, -0.03), seed);
    float shadow = (1.0 - smoothstep(-blur * 2.0, blur * 3.0, shadowEdge)) * 0.18;
    below = mix(below, below * vec3(0.81, 0.88, 0.97), shadow);
    if (mask < 0.001) return below;
    float fold = q.x + q.y * q.y * 0.24 + (noise(q * 1.4 + seed) - 0.5) * 0.24;
    float transmission = smoothstep(-0.8, 0.55, fold);
    float body = tissue(q * 2.2 + seed);
    float shade = transmission * 0.58 + (body - 0.45) * 0.22 + smoothstep(1.0, 4.0, seed) * 0.12;
    vec3 material = mix(vec3(0.94, 0.97, 1.0), vec3(0.4, 0.61, 0.86), clamp(shade, 0.0, 0.75));
    float light = exp(-pow((fold + 0.28 + sin(t * 0.09 + seed) * 0.035) / 0.48, 2.0));
    material += light * 0.035;

    // Fibers follow the local surface. Their clarity changes locally with focus.
    float screenAspect = u_resolution.x / u_resolution.y;
    float pixels = u_resolution.x / max(screenAspect, 1.3) * size.x;
    float frequency = min(230.0, pixels * 0.35);
    float direction = q.x + q.y * 0.11 + q.y * q.y * 0.045 + fold * 0.1;
    vec2 fiberUV = vec2(direction * frequency, q.y * 42.0);
    float fibers = noise(fiberUV + seed) * 0.62
                 + noise(fiberUV * vec2(2.13, 1.71) + seed * 3.0) * 0.25
                 + noise(fiberUV * vec2(3.83, 3.1) + seed * 7.0) * 0.13;
    float detail = (0.35 + focus * 0.65) * (1.0 - smoothstep(0.02, 0.1, depth));
    float patches = 0.35 + tissue(q * 3.6 + seed) * 0.65;
    material += (fibers - 0.5) * 0.15 * detail * patches;
    float threads = pow(max(fibers - 0.25, 0.0), 3.0) * detail;
    material += threads * 0.055;
    material += (noise(q * 350.0 + seed) - 0.5) * 0.012 * detail;
    return mix(below, clamp(material, 0.0, 1.0), mask * opacity);
  }
  void main() {
    vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
    float aspect = u_resolution.x / u_resolution.y;
    vec2 p = vec2((uv.x - 0.5) * max(aspect, 1.3), uv.y - 0.43);
    float atmosphere = tissue(p * 1.3 + vec2(u_time * 0.008, 3.0));
    vec3 color = mix(vec3(0.3, 0.53, 0.88), vec3(0.58, 0.75, 0.97), atmosphere);
    color = sheet(color, p, vec2(0.48, -0.34), vec2(0.91, 0.8), 0.48, 2.3, 0.065, 0.58);
    color = sheet(color, p, vec2(0.78, 0.35), vec2(0.67, 0.84), -0.38, 5.7, 0.028, 0.9);
    color = sheet(color, p, vec2(-0.6, -0.39), vec2(0.77, 0.46), -0.38, 0.8, 0.006, 0.94);
    // Keep the native foreground legible while retaining material detail at the sides.
    float opening = exp(-pow((uv.x - 0.5) * 4.0, 2.0)) * 0.63;
    float copyWidth = smoothstep(0.04, 0.27, uv.x) * (1.0 - smoothstep(0.73, 0.96, uv.x));
    float copyLight = exp(-pow((uv.y - 0.4) * 10.0, 2.0)) * copyWidth * 0.72;
    opening = max(opening, copyLight);
    float narrow = 1.0 - smoothstep(0.75, 1.35, aspect);
    opening = max(opening, narrow * 0.7 * (1.0 - smoothstep(0.46, 0.64, uv.y)));
    color = mix(color, vec3(0.985, 0.993, 1.0), opening);
    color += (hash(gl_FragCoord.xy) - 0.5) * 0.003;
    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
  }
`;

/** Generate the entire material on the GPU; no image or video texture is used. */
export function renderHeroBackdrop(
  canvas: HTMLCanvasElement,
  reduced: boolean,
  onReady: () => void,
  onFailure: () => void,
): (() => void) | null {
  let gl: WebGLRenderingContext | null;
  try {
    gl = canvas.getContext("webgl", { antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
  } catch {
    return null;
  }
  if (!gl) return null;

  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let frame = 0;
  let elapsed = 0;
  let previous = 0;
  let visible = true;
  let disposed = false;
  let ready = false;

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
  }
  function release() {
    stop();
    shaders.forEach(shader => gl!.deleteShader(shader));
    if (buffer) gl!.deleteBuffer(buffer);
    if (program) gl!.deleteProgram(program);
  }
  function compile(type: number, source: string) {
    const shader = gl!.createShader(type);
    if (!shader) throw new Error("Shader unavailable");
    shaders.push(shader);
    gl!.shaderSource(shader, source);
    gl!.compileShader(shader);
    return shader;
  }

  try {
    program = gl.createProgram();
    buffer = gl.createBuffer();
    if (!program || !buffer) throw new Error("Renderer unavailable");
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Renderer unavailable");
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  } catch {
    release();
    return null;
  }

  const time = gl.getUniformLocation(program, "u_time");
  const resolution = gl.getUniformLocation(program, "u_resolution");

  function draw() {
    gl!.uniform1f(time, elapsed);
    gl!.drawArrays(gl!.TRIANGLES, 0, 6);
    if (!ready) { ready = true; onReady(); }
  }
  function resize() {
    if (disposed) return;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    // Bound the background's GPU cost on high-density and ultra-wide screens.
    const density = Math.min(window.devicePixelRatio || 1, 1.5, 1920 / width, 1440 / height);
    canvas.width = Math.max(1, Math.round(width * density));
    canvas.height = Math.max(1, Math.round(height * density));
    gl!.viewport(0, 0, canvas.width, canvas.height);
    gl!.uniform2f(resolution, canvas.width, canvas.height);
    draw();
  }
  function tick(now: number) {
    frame = 0;
    if (disposed || !visible || document.hidden) return;
    if (!previous || now - previous >= 1000 / 30) {
      // Resume from the paused phase instead of jumping when the tab becomes visible.
      if (previous) elapsed += Math.min(now - previous, 100) / 1000;
      previous = now;
      draw();
    }
    frame = requestAnimationFrame(tick);
  }
  function resume() {
    if (disposed || reduced || !visible || document.hidden) { stop(); return; }
    if (!frame) frame = requestAnimationFrame(tick);
  }
  function contextLost(event: Event) {
    event.preventDefault();
    disposed = true;
    stop();
    onFailure();
  }

  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
  const intersection = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    resume();
  });
  resizeObserver?.observe(canvas);
  intersection?.observe(canvas);
  if (!resizeObserver) window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", resume);
  canvas.addEventListener("webglcontextlost", contextLost);
  resize();
  resume();

  return () => {
    disposed = true;
    resizeObserver?.disconnect();
    intersection?.disconnect();
    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", resume);
    canvas.removeEventListener("webglcontextlost", contextLost);
    release();
  };
}

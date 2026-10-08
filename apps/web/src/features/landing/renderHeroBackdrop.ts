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
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 turn = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p);
      p = turn * p;
      amplitude *= 0.5;
    }
    return value;
  }
  void main() {
    vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
    float aspect = u_resolution.x / u_resolution.y;
    vec2 p = vec2((uv.x - 0.5) * max(aspect, 1.0), uv.y - 0.5);
    float t = u_time;

    // Two passes of domain warping give one continuous, slowly folding light field.
    vec2 q = vec2(fbm(p * 1.1 + vec2(0.0, t * 0.06)), fbm(p * 1.1 + vec2(5.2, 1.3) - vec2(t * 0.05, 0.0)));
    vec2 r = vec2(fbm(p * 0.9 + 2.2 * q + vec2(1.7, 9.2) + t * 0.04), fbm(p * 0.9 + 2.2 * q + vec2(8.3, 2.8) - t * 0.035));
    float field = fbm(p * 0.8 + 2.4 * r);

    vec3 white = vec3(0.985, 0.99, 1.0);
    vec3 ice = vec3(0.82, 0.89, 0.98);
    vec3 blue = vec3(0.46, 0.62, 0.93);
    vec3 lilac = vec3(0.73, 0.67, 0.95);
    vec3 aqua = vec3(0.63, 0.86, 0.93);
    vec3 color = mix(ice, blue, smoothstep(0.32, 0.86, field));
    color = mix(color, lilac, smoothstep(0.32, 0.9, r.x) * 0.6);
    color = mix(color, aqua, smoothstep(0.45, 0.95, q.y) * 0.4);

    // Silk: bands that follow the warped field, with a broad sheen and fine bright edges.
    float flow = p.x * 0.6 + p.y * 1.8 + field * 3.2 + r.y * 1.5;
    float ribbon = 0.5 + 0.5 * sin(flow * 5.0 - t * 0.35);
    float presence = smoothstep(0.28, 0.75, field);
    color = mix(color, white, pow(ribbon, 3.0) * 0.18 * presence);
    color = mix(color, white, pow(ribbon, 14.0) * 0.5 * presence);
    color *= 1.0 - pow(1.0 - ribbon, 5.0) * 0.07 * presence;

    // Keep the brand, headline and buttons on a calm, bright centre.
    float centre = exp(-pow((uv.x - 0.5) * 3.0, 2.0)) * exp(-pow((uv.y - 0.36) * 2.4, 2.0));
    float narrow = 1.0 - smoothstep(0.75, 1.35, aspect);
    color = mix(color, white, max(centre * 0.74, narrow * 0.55 * (1.0 - smoothstep(0.4, 0.62, uv.y))));
    color += (hash(gl_FragCoord.xy) - 0.5) * 0.018;
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

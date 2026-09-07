(() => {
  const field = document.querySelector('[data-nova-field]');
  const nova = field?.closest('.work-nova');
  const image = nova?.querySelector('img');
  const surface = nova?.querySelector('[data-nova-ignite]');
  const pause = document.querySelector('[data-nova-pause]');
  const hint = document.querySelector('[data-nova-hint]');
  if (!field || !image || !surface || !pause) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const forced = matchMedia('(forced-colors: active)');
  const connection = navigator.connection;
  const suppressed = () => reduced.matches || forced.matches || connection?.saveData;
  const staticView = () => {
    field.hidden = true;
    surface.hidden = true;
    pause.hidden = true;
    delete nova.dataset.renderer;
    document.documentElement.dataset.workSupernova = 'static';
    hint.textContent = 'A supernova, at rest.';
  };
  staticView();
  if (suppressed()) return;
  const startRenderer = () => {
  if (suppressed()) return;
  const contextOptions = { alpha: true, antialias: false, depth: false, premultipliedAlpha: false };
  const gl = field.getContext('webgl2', contextOptions) || field.getContext('webgl', contextOptions);
  if (!gl) return;
  const vertex = `attribute vec2 position; varying vec2 uv; void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
  const fragment = `
    precision mediump float;
    varying vec2 uv;
    uniform sampler2D artwork;
    uniform float time;
    uniform float sequence;
    uniform vec2 pointer;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);}
    float cloud(vec2 p){return noise(p)*.57+noise(p*2.03)*.28+noise(p*4.01)*.15;}
    void main(){
      vec2 core=vec2(.501,.504);
      vec2 d=uv-core;
      float r=length(d);
      vec2 direction=d/max(r,.025);
      float envelope=smoothstep(.015,.12,r)*(1.-smoothstep(.45,.7,r));
      float slow=time*.15;
      vec2 flow=vec2(cloud(uv*5.+vec2(slow,-slow*.6)),cloud(uv*5.+vec2(-slow*.7,slow)+7.))-.5;
      float wave=sin(r*29.-time*1.3+cloud(uv*6.)*4.);
      float collapse=clamp(sequence/3.,0.,1.);
      float blast=clamp((sequence-3.)/.7,0.,1.);
      float settle=clamp((sequence-3.7)/2.3,0.,1.);
      float compression=1.-pow(collapse,2.3)*.955;
      float expansion=mix(.045,1.27,1.-pow(1.-blast,4.));
      float size=sequence<3. ? compression : mix(expansion,1.,smoothstep(0.,1.,settle));
      float impact=sequence<3. ? 0. : exp(-(sequence-3.)*2.1);
      float front=exp(-pow((r-blast*.85)*13.,2.))*impact;
      float tension=sequence<3. ? pow(collapse,3.) : 0.;
      vec2 drag=(pointer-core)*exp(-r*3.5)*smoothstep(.025,.15,r)*.06;
      vec2 displaced=uv-flow*.075*envelope-direction*(wave*.012+front*.045)*envelope-drag;
      // Expansion follows irregular cloud density rather than drawing geometric rings.
      displaced=core+(displaced-core)/max(.045,size);
      float twist=tension*(1.-smoothstep(0.,.45,r))*1.6;
      vec2 relative=displaced-core;
      displaced=core+mat2(cos(twist),-sin(twist),sin(twist),cos(twist))*relative;
      vec3 ink=texture2D(artwork,clamp(displaced,0.,1.)).rgb;
      float textureEdge=1.-smoothstep(.43,.64,length(displaced-core));
      ink=mix(vec3(.98,.976,.957),ink,textureEdge);
      float density=clamp(1.-dot(ink,vec3(.299,.587,.114)),0.,1.);
      float filament=cloud(displaced*17.+vec2(time*.12,-time*.1));
      float energy=(.5+.5*sin(time*.85-r*19.+filament*5.))*density;
      ink=mix(ink,ink*vec3(.88,1.025,1.09),energy*.35);
      ink+=vec3(.18,.09,.025)*front*density*.7;
      float glow=exp(-r*r/(.0003+tension*.0012+impact*.012))*(.16+tension*.8+impact*1.2);
      float angle=atan(d.y,d.x);
      float rays=pow(max(0.,sin(angle*47.+cloud(vec2(angle*3.,r*9.-sequence*2.))*5.)),18.);
      float ejecta=rays*exp(-r*7.)*(1.-smoothstep(.3,.62,r))*impact;
      ink=mix(ink,vec3(.84,.69,.44),ejecta*.4);
      ink=mix(ink,vec3(1.,.94,.78),glow);
      float edge=1.-smoothstep(.48,.7,length((uv-.5)*vec2(1.,.94)));
      gl_FragColor=vec4(ink,edge);
    }`;
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };
  const vs = compile(gl.VERTEX_SHADER, vertex);
  const fs = compile(gl.FRAGMENT_SHADER, fragment);
  if (!vs || !fs) return;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniforms = Object.fromEntries(['time','sequence','pointer'].map(name => [name, gl.getUniformLocation(program,name)]));
  let ready = false, visible = false, paused = false, lost = false;
  let frame = 0, previous = 0, elapsed = 0, pulseStart = 0;
  let sampleStart = 0, sampleFrames = 0;
  let targetX = .5, targetY = .5, pointerX = .5, pointerY = .5;
  const entryReady = () => {
    const root = document.documentElement;
    return !['pending','running','revealing'].includes(root.dataset.bigBang) && !root.dataset.universeMotion;
  };
  const canRun = () => ready && visible && !document.hidden && !paused && !suppressed() && !lost && entryReady();
  let pendingFrame = null, resizeFrame = 0;
  const frameComplete = () => {
    // Do not queue more shader work while the previous frame is unfinished.
    // A software GPU can otherwise accumulate seconds of work that navigation
    // must drain. Poll without blocking, keeping input and the clock responsive.
    if (pendingFrame) {
      if (gl.clientWaitSync(pendingFrame, 0, 0) === gl.TIMEOUT_EXPIRED) return false;
      gl.deleteSync(pendingFrame);
      pendingFrame = null;
    }
    return true;
  };
  const render = () => {
    if (!frameComplete()) return false;
    gl.uniform1f(uniforms.time, elapsed);
    const age = Math.min(6, elapsed-pulseStart);
    gl.uniform1f(uniforms.sequence, age);
    const phase = age < 3 ? 'collapsing' : age < 3.7 ? 'exploding' : age < 6 ? 'settling' : 'remnant';
    if (field.dataset.phase !== phase) field.dataset.phase = phase;
    gl.uniform2f(uniforms.pointer, pointerX, pointerY);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (gl.fenceSync) {
      pendingFrame = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
    }
    return true;
  };
  const tick = now => {
    frame = 0;
    if (!canRun()) { previous = 0; return; }
    // Paint each display frame: interval gates can drop 60 Hz callbacks to 30 Hz.
    const activeSeconds = previous ? Math.max(0,(now-previous)/1000) : 0;
    // Keep the sequence on active elapsed time even when rendering is slow.
    elapsed += activeSeconds;
    const dt = Math.min(.1,activeSeconds);
    previous = now;
    const follow = 1-Math.exp(-5*dt);
    pointerX += (targetX-pointerX)*follow;
    pointerY += (targetY-pointerY)*follow;
    // Let a pending resize consume the completed frame before submitting more.
    const painted = resizeFrame ? false : render();
    if (!sampleStart) sampleStart = now;
    else if (painted) sampleFrames += 1;
    if (now-sampleStart >= 1000) {
      field.dataset.observedFps = (sampleFrames*1000/(now-sampleStart)).toFixed(1);
      sampleStart = now;
      sampleFrames = 0;
    }
    frame = requestAnimationFrame(tick);
  };
  const sync = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
    sampleStart = 0;
    sampleFrames = 0;
    field.dataset.animationState = canRun() ? 'flowing' : 'paused';
    if (canRun()) frame = requestAnimationFrame(tick);
  };
  const resize = () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = 0;
    const bounds = field.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(750000 / Math.max(1,bounds.width*bounds.height)));
    const width = Math.max(1,Math.floor(bounds.width*ratio));
    const height = Math.max(1,Math.floor(bounds.height*ratio));
    if (field.width === width && field.height === height) return;
    // Resizing clears the canvas. Wait until we can repaint it, including when
    // motion is paused and the animation loop will not provide another frame.
    if (ready && !lost && !frameComplete()) {
      resizeFrame = requestAnimationFrame(resize);
      return;
    }
    field.width = width; field.height = height;
    gl.viewport(0,0,width,height);
    field.dataset.pixelCount = String(width*height);
    field.dataset.frameRate = '60';
    field.dataset.framePacing = 'display';
    if (ready && !lost) render();
  };
  const initialize = () => {
    if (ready || !image.naturalWidth || lost || suppressed()) return;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
    ready = true;
    field.hidden = false;
    resize(); render();
    surface.hidden = false; pause.hidden = false;
    nova.dataset.renderer = 'active';
    document.documentElement.dataset.workSupernova = 'interactive';
    hint.textContent = 'Move to stir. Press to collapse & ignite.';
    sync();
  };
  surface.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    const rect = field.getBoundingClientRect();
    targetX = (event.clientX-rect.left)/rect.width;
    targetY = 1-(event.clientY-rect.top)/rect.height;
  }, { passive: true });
  surface.addEventListener('pointerleave', () => { targetX=.5; targetY=.5; });
  surface.addEventListener('click', () => {
    if (!ready || lost || suppressed()) return;
    // A pulse is a deliberate resume action; repeated clicks do not create flashing.
    paused=false; pause.textContent='Pause motion';
    if (elapsed-pulseStart < 6) { sync(); return; }
    pulseStart=elapsed;
    field.dataset.pulseCount=String(Number(field.dataset.pulseCount || 0)+1);
    sync();
  });
  pause.addEventListener('click', () => {
    paused=!paused;
    pause.textContent=paused ? 'Resume motion' : 'Pause motion';
    sync();
  });
  const preferenceChanged = () => {
    if (suppressed()) { sync(); staticView(); }
    else if (ready && !lost) {
      field.hidden=false; surface.hidden=false; pause.hidden=false;
      nova.dataset.renderer='active';
      document.documentElement.dataset.workSupernova='interactive';
      hint.textContent='Move to stir. Press to collapse & ignite.';
      sync();
    } else if (!ready && !lost) {
      initialize();
    }
  };
  reduced.addEventListener('change',preferenceChanged);
  forced.addEventListener('change',preferenceChanged);
  connection?.addEventListener?.('change',preferenceChanged);
  document.addEventListener('visibilitychange',sync);
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-big-bang','data-universe-motion'] });
  new IntersectionObserver(([entry]) => { visible=entry.isIntersecting; sync(); }).observe(nova);
  new ResizeObserver(resize).observe(nova);
  field.addEventListener('webglcontextlost', event => {
    event.preventDefault(); lost=true; sync(); staticView();
  });
  if (image.complete) initialize();
  else image.addEventListener('load',initialize,{once:true});
  };
  // Keep GPU setup outside document parsing and the shared page entrance.
  // The artwork remains visible while the browser acquires the destination.
  let setupTimer = 0;
  let rendererStarted = false;
  const entranceSettled = () => document.readyState !== 'loading' && !document.hidden
    && !['pending', 'running', 'revealing'].includes(document.documentElement.dataset.bigBang)
    && !document.documentElement.dataset.universeMotion;
  const scheduleRenderer = () => {
    clearTimeout(setupTimer);
    if (rendererStarted || !entranceSettled()) return;
    setupTimer = setTimeout(() => {
      if (!entranceSettled()) return;
      rendererStarted = true;
      entranceObserver.disconnect();
      startRenderer();
    }, 0);
  };
  const entranceObserver = new MutationObserver(scheduleRenderer);
  entranceObserver.observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-big-bang', 'data-universe-motion']
  });
  document.addEventListener('DOMContentLoaded', scheduleRenderer, { once: true });
  document.addEventListener('visibilitychange', scheduleRenderer);
  window.addEventListener('pagehide', () => clearTimeout(setupTimer));
  window.addEventListener('pageshow', scheduleRenderer);
  scheduleRenderer();
})();

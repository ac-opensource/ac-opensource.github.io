(() => {
  "use strict";
  const canvas = document.querySelector(".article-aurora");
  const ctx = canvas?.getContext("2d", { alpha: true });
  if (!ctx) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const pause = document.querySelector("[data-aurora-pause]");
  let paused = false;
  let width = 0, height = 0, frame = 0, last = 0, time = 0;
  const curtain = document.createElement("canvas");
  const light = curtain.getContext("2d");
  if (!light) return;
  // As in about-butterfly-field.js, combine coarse structure and fine ridges
  // with three octaves of smoothly interpolated, deterministic noise.
  function noise(x) {
    const cell = Math.floor(x);
    const f = x - cell;
    const blend = f * f * (3 - 2 * f);
    const hash = n => { const value = Math.sin(n * 127.1 + 19471) * 43758.5453; return value - Math.floor(value); };
    return hash(cell) * (1 - blend) + hash(cell + 1) * blend;
  }
  function fbm(x) {
    return noise(x) * .56 + noise(x * 2.03 + 9.1) * .29 + noise(x * 4.09 + 17.7) * .15;
  }
  function draw() {
    light.clearRect(0, 0, width, height);
    light.globalCompositeOperation = "lighter";
    // Project a folded sheet into the sky: overlapping folds gather light,
    // while each field-aligned ray fades upward from a narrow green edge.
    for (let layer = 0; layer < 2; layer += 1) {
      const depth = 1 - layer * .22;
      const phase = layer * 2.7;
      const samples = Math.ceil(width / .75);
      for (let i = 0; i <= samples; i += 1) {
        const u = Math.max(0, Math.min(1, (i + (noise(i * 11.7) - .5) * .7) / samples));
        const drift = time * .055;
        const coarse = fbm(u * 7 + phase - drift);
        const fold = u * (12 + layer * 2.7) + phase + drift + (coarse - .5) * 3.2;
        const billow = Math.sin(u * 6 + phase - drift) + (coarse - .5) * .38;
        const x = width * (u + .025 * depth * Math.sin(fold));
        const y = height * (.69 + layer * .13 + .085 * billow + .028 * Math.cos(fold) + .012 * (fbm(u * 28 + phase - drift) - .5));
        const fine = fbm(u * 185 + phase + drift * .6);
        const ridge = 1 - Math.abs(fine * 2 - 1);
        const ray = .22 + .78 * Math.pow(ridge, 5);
        const length = height * depth * (.53 + .22 * fbm(u * 14 + phase - drift * .3) + .12 * fine);
        const envelope = Math.pow(Math.sin(Math.PI * u), .55);
        const density = envelope * depth * (.18 + .36 * ray) * (.3 + .9 * coarse);
        const strength = 1 - Math.exp(-density);
        const lean = width * .026 * Math.sin(u * 5 + phase);
        const fringe = 7 + height * .012 * noise(u * 62 + phase);
        const gradient = light.createLinearGradient(x + lean, y - length, x, y + fringe);
        gradient.addColorStop(0, "rgba(91,48,171,0)");
        gradient.addColorStop(.16, `rgba(124,45,188,${strength * .3})`);
        gradient.addColorStop(.4, `rgba(212,38,152,${strength * .72})`);
        gradient.addColorStop(.68, `rgba(247,64,143,${strength})`);
        gradient.addColorStop(.83, `rgba(235,116,136,${strength * .8})`);
        gradient.addColorStop(.92, `rgba(151,234,113,${strength * .9})`);
        gradient.addColorStop(.965, `rgba(103,237,141,${strength * .72})`);
        gradient.addColorStop(1, "rgba(76,220,132,0)");
        light.strokeStyle = gradient;
        light.lineWidth = Math.max(.7, width / samples * 1.3);
        light.beginPath();
        light.moveTo(x + lean, y - length);
        light.bezierCurveTo(x + lean * .75, y - length * .64, x + lean * .12, y - length * .2, x, y + fringe);
        light.stroke();
      }
    }
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = .85;
    ctx.filter = "blur(24px)";
    ctx.drawImage(curtain, 0, 0);
    ctx.filter = "blur(1.2px)";
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(curtain, 0, 0);
    ctx.filter = "none";
    ctx.globalCompositeOperation = "source-over";
    for (let i = 0; i < 560; i += 1) {
      const x = ((Math.sin(i * 127.1) * 43758.5453) % 1 + 1) % 1;
      const y = ((Math.sin(i * 311.7) * 19431.1949) % 1 + 1) % 1;
      ctx.fillStyle = `rgba(207,239,236,${.13 + (i % 5) * .08})`;
      ctx.fillRect(x * width, y * height, i % 5 === 0 ? 1.4 : .8, .8);
    }
  }
  function tick(now) {
    if (now - last >= 50) { time += Math.min((now - last) / 1000, .1); last = now; draw(); }
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    cancelAnimationFrame(frame);
    draw();
    if (!paused && !reduced.matches && !document.hidden) { last = performance.now(); frame = requestAnimationFrame(tick); }
  }
  function resize() {
    // Bound rendering cost independently of a Retina display's device pixel ratio.
    const scale = Math.min(1, 1440 / innerWidth);
    width = Math.round(innerWidth * scale); height = Math.round(innerHeight * scale);
    canvas.width = curtain.width = width; canvas.height = curtain.height = height;
    sync();
  }
  if (pause) {
    pause.hidden = false;
    pause.addEventListener("click", () => {
      paused = !paused;
      pause.setAttribute("aria-pressed", String(paused));
      pause.textContent = paused ? "Resume aurora" : "Pause aurora";
      sync();
    });
  }
  addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", sync);
  reduced.addEventListener("change", sync);
  resize();
})();

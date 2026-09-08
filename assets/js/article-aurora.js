(() => {
  "use strict";
  const canvas = document.querySelector(".article-aurora");
  const ctx = canvas?.getContext("2d", { alpha: true });
  if (!ctx) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const pause = document.querySelector("[data-aurora-pause]");
  let paused = false;
  let width = 0, height = 0, frame = 0, last = 0, time = 0;
  function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "lighter";
    // Fine vertical rays form folded translucent curtains, rather than blobs.
    for (let layer = 0; layer < 3; layer += 1) {
      const hue = [158, 182, 265][layer];
      for (let x = -4; x < width + 4; x += 3) {
        const u = x / width;
        const fold = Math.sin(u * 9 + time * .16 + layer * 1.8);
        const ripple = Math.sin(u * 23 - time * .11 + layer) * .035;
        const y = height * (.24 + layer * .12 + fold * .12 + ripple);
        const length = height * (.23 + .09 * Math.sin(u * 12 + layer + time * .08));
        const strength = (.09 + .11 * Math.pow(Math.sin(u * 31 + fold * 2 + layer), 2)) * Math.sin(Math.PI * Math.max(0, Math.min(1, u)));
        const gradient = ctx.createLinearGradient(x, y - length, x, y + 18);
        gradient.addColorStop(0, `hsla(${hue}, 85%, 60%, 0)`);
        gradient.addColorStop(.7, `hsla(${hue}, 85%, 60%, ${strength * .45})`);
        gradient.addColorStop(.94, `hsla(${hue}, 85%, 70%, ${strength})`);
        gradient.addColorStop(1, `hsla(${hue}, 85%, 60%, 0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y - length, 4, length + 18);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    for (let i = 0; i < 70; i += 1) {
      const x = ((Math.sin(i * 127.1) * 43758.5453) % 1 + 1) % 1;
      const y = ((Math.sin(i * 311.7) * 19431.1949) % 1 + 1) % 1;
      ctx.fillStyle = `rgba(207,239,236,${.12 + (i % 4) * .06})`;
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
    canvas.width = width; canvas.height = height;
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

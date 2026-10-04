(() => {
  // Light, ejecta, and pressure-wave layer for the Work supernova. The fluid
  // field owns the clock and calls frame(age); this layer paints only while a
  // detonation plays, then hides itself so the remnant costs nothing extra.
  const TAU = Math.PI * 2;
  const DETONATE = 3;
  const END = 7.4;
  const COLORS = {
    white: [255, 252, 244],
    cream: [255, 236, 196],
    gold: [243, 185, 94],
    amber: [233, 139, 39],
    copper: [190, 84, 38],
    cobalt: [40, 100, 199],
    periwinkle: [104, 127, 196],
    teal: [22, 140, 134],
    night: [8, 14, 34],
    indigo: [14, 28, 66],
    deep: [24, 52, 118]
  };
  const FAMILIES = [
    { mid: COLORS.amber, end: COLORS.copper },
    { mid: COLORS.periwinkle, end: COLORS.cobalt },
    { mid: COLORS.periwinkle, end: COLORS.teal }
  ];
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const smooth = (from, to, value) => {
    const t = clamp((value - from) / (to - from));
    return t * t * (3 - 2 * t);
  };
  const mix = (from, to, t) => from + (to - from) * t;
  const blend = (from, to, t) => [mix(from[0], to[0], t), mix(from[1], to[1], t), mix(from[2], to[2], t)];
  const rgba = (color, alpha) => `rgba(${color[0] | 0},${color[1] | 0},${color[2] | 0},${clamp(alpha).toFixed(3)})`;
  const seeded = (seed) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Hot matter reads white-gold, then cools into the artwork's copper or cobalt ink.
  const heatColor = (heat, family) => {
    if (heat > 0.62) return blend(COLORS.gold, COLORS.white, (heat - 0.62) / 0.38);
    if (heat > 0.3) return blend(family.mid, COLORS.gold, (heat - 0.3) / 0.32);
    return blend(family.end, family.mid, heat / 0.3);
  };

  function create({ canvas, nova, hint, idleHint, compact = () => false }) {
    const context = canvas?.getContext("2d", { alpha: true });
    if (!context || !nova) return null;
    const hero = nova.closest(".work-hero");
    let width = 1;
    let height = 1;
    let unit = 1;
    let active = false;
    let detonated = false;
    let pulse = 0;
    let label = "";
    let ejecta = [];
    let knots = [];
    let infall = [];
    let stars = [];
    let embers = [];
    let lastFrame = 0;
    let frameCost = 16;
    let stride = 1;
    const shock = new Set();

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const art = nova.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      unit = Math.max(1, art.width);
      // Sparks are motion-blurred streaks, so a modest backing store stays crisp enough.
      const ratio = Math.min(devicePixelRatio || 1, 1.25, Math.sqrt(1200000 / (width * height)));
      const backingWidth = Math.max(1, Math.round(width * ratio));
      const backingHeight = Math.max(1, Math.round(height * ratio));
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth;
        canvas.height = backingHeight;
      }
      context.setTransform(backingWidth / width, 0, 0, backingHeight / height, 0, 0);
      context.lineCap = "round";
      canvas.dataset.pixelCount = String(backingWidth * backingHeight);
    };

    const build = () => {
      const random = seeded(20260907 + pulse * 7919);
      const density = compact() ? 0.42 : 1;
      const fingers = Array.from({ length: 34 }, () => random() * TAU);
      ejecta = Array.from({ length: Math.round(620 * density) }, (_, index) => {
        const clumped = random() < 0.72;
        const angle = clumped ? fingers[index % fingers.length] + (random() - 0.5) * 0.12 : random() * TAU;
        // Most matter stays close; a heavy tail of fast fragments carries the long streaks.
        return {
          angle,
          spin: (random() - 0.5) * 0.32,
          start: 0.02 + random() * 0.04,
          reach: 0.08 + Math.pow(random(), 1.55) * 1.02,
          drag: 2.6 + random() * 2.2,
          delay: random() * 0.06,
          life: 0.8 + random() * 1.3,
          width: 0.4 + random() * 1.05,
          heat: 0.7 + random() * 0.3,
          alpha: 0.5 + random() * 0.5,
          family: FAMILIES[random() < 0.55 ? 0 : random() < 0.75 ? 1 : 2]
        };
      });
      knots = Array.from({ length: compact() ? 6 : 11 }, () => ({
        angle: fingers[Math.floor(random() * fingers.length)] + (random() - 0.5) * 0.08,
        spin: (random() - 0.5) * 0.2,
        reach: 0.4 + random() * 0.42,
        drag: 2 + random() * 0.8,
        life: 1.7 + random() * 0.7,
        size: 1.6 + random() * 1.4,
        family: FAMILIES[random() < 0.7 ? 0 : 1]
      }));
      // Infall follows four spiral arms so the collapse reads as one accretion flow.
      const arms = random() * TAU;
      infall = Array.from({ length: Math.round(190 * density) }, (_, index) => {
        const spawn = 0.12 + random() * 2.3;
        return {
          spawn,
          duration: Math.max(0.32, Math.min(0.6 + random() * 0.85, 2.94 - spawn)),
          radius: 0.36 + random() * 0.66,
          angle: arms + (index % 4) * TAU / 4 + (random() - 0.5) * 0.7,
          spin: 2 + random() * 1.1,
          width: 0.45 + random() * 0.8,
          color: [COLORS.cobalt, COLORS.teal, COLORS.periwinkle, COLORS.amber][Math.floor(random() * 4)]
        };
      });
      stars = Array.from({ length: Math.round(80 * density) }, () => ({
        radius: Math.sqrt(random()) * 0.82,
        angle: random() * TAU,
        size: 0.6 + random() * 1.1,
        rate: 2 + random() * 5,
        phase: random() * TAU,
        alpha: 0.35 + random() * 0.65
      }));
      embers = Array.from({ length: Math.round(54 * density) }, () => {
        const angle = random() * TAU;
        const radius = 0.16 + Math.sqrt(random()) * 0.62;
        return {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius * 0.94,
          vx: Math.cos(angle) * 0.028,
          vy: Math.sin(angle) * 0.022 - 0.018,
          birth: 0.35 + random() * 1.4,
          life: 1.8 + random() * 2,
          size: 0.8 + random() * 1.5,
          sway: 1 + random() * 2,
          phase: random() * TAU,
          alpha: 0.35 + random() * 0.5,
          color: [COLORS.gold, COLORS.amber, COLORS.copper][Math.floor(random() * 3)]
        };
      });
    };

    const play = (element, keyframes, options) => {
      try {
        const animation = element.animate(keyframes, options);
        shock.add(animation);
        animation.finished.catch(() => {}).finally(() => shock.delete(animation));
      } catch {
        // A browser without additive composition skips the pressure-wave accent.
      }
    };

    // The pressure wave keeps travelling after the visible ring fades and
    // nudges the surrounding copy outward, then springs it back into place.
    const strike = () => {
      const art = nova.getBoundingClientRect();
      const core = { x: art.left + art.width * 0.501, y: art.top + art.height * 0.496 };
      const random = seeded(4099 + pulse * 131);
      const shake = Array.from({ length: 13 }, (_, index) => {
        const amplitude = 9 * Math.pow(1 - index / 12, 2);
        const x = index === 0 || index === 12 ? 0 : (random() - 0.5) * 2 * amplitude;
        const y = index === 0 || index === 12 ? 0 : (random() - 0.5) * 2 * amplitude;
        return { transform: `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)` };
      });
      play(nova, shake, { duration: 560, easing: "linear", composite: "add" });
      if (!hero) return;
      hero.querySelectorAll(".work-hero__copy .work-eyebrow, .work-hero__title > span, .work-hero__intro, .work-hero__actions, .work-hero__brief-signal, .work-signals > div, .work-nova__footer").forEach((element) => {
        const bounds = element.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        let dx = clamp(core.x, bounds.left, bounds.right) - core.x;
        let dy = clamp(core.y, bounds.top, bounds.bottom) - core.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 1) {
          dx = bounds.left + bounds.width / 2 - core.x;
          dy = bounds.top + bounds.height / 2 - core.y;
          distance = Math.hypot(dx, dy) || 1;
        }
        const amplitude = 2.5 + 11 * (1 - smooth(0, 1150, distance));
        const delay = 50 + distance / 1.5;
        const offset = (scale) => `translate(${(dx / distance * amplitude * scale).toFixed(2)}px, ${(dy / distance * amplitude * scale).toFixed(2)}px)`;
        const spring = "cubic-bezier(.3,0,.3,1)";
        play(element, [
          { transform: offset(0), easing: "cubic-bezier(.1,.7,.3,1)" },
          { transform: offset(1), offset: 0.14, easing: spring },
          { transform: offset(-0.38), offset: 0.38, easing: spring },
          { transform: offset(0.14), offset: 0.62, easing: spring },
          { transform: offset(-0.04), offset: 0.84, easing: spring },
          { transform: offset(0) }
        ], { duration: 1000, delay, composite: "add" });
        if (element.matches(".work-hero__title > span:last-child")) {
          const color = getComputedStyle(element).color;
          play(element, [
            { color, textShadow: "0 0 0 rgba(243,185,94,0)" },
            { color: "#c26d17", textShadow: "0 0 1.4rem rgba(243,185,94,.55)", offset: 0.16 },
            { color, textShadow: "0 0 0 rgba(243,185,94,0)" }
          ], { duration: 1300, delay, easing: "ease-out" });
        }
        if (element.matches(".work-signals > div")) {
          play(element, [
            { boxShadow: "inset 0 2px 0 rgba(233,139,39,0)" },
            { boxShadow: "inset 0 2px 0 rgba(233,139,39,.95)", offset: 0.12 },
            { boxShadow: "inset 0 2px 0 rgba(233,139,39,0)" }
          ], { duration: 1400, delay, easing: "ease-out" });
        }
      });
    };

    const updateHint = (age) => {
      if (!hint) return;
      const t = age - DETONATE;
      let next = idleHint;
      if (age < 6) {
        const stage = age < DETONATE - 0.45 ? "core collapse" : age < DETONATE ? "critical mass" : age < DETONATE + 0.7 ? "detonation" : "shock front";
        next = `T${t < 0 ? "−" : "+"}${Math.abs(t).toFixed(1)} s · ${stage}`;
      }
      if (next !== label) {
        label = next;
        hint.textContent = next;
      }
    };

    const glow = (x, y, radius, stops) => {
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      stops.forEach(([offset, color, alpha]) => gradient.addColorStop(offset, rgba(color, alpha)));
      context.fillStyle = gradient;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    };

    const ring = (x, y, radius, thickness, stops) => {
      if (radius <= thickness) return;
      const gradient = context.createRadialGradient(x, y, radius - thickness / 2, x, y, radius + thickness / 2);
      stops.forEach(([offset, color, alpha]) => gradient.addColorStop(offset, rgba(color, alpha)));
      context.strokeStyle = gradient;
      context.lineWidth = thickness;
      context.beginPath();
      context.arc(x, y, radius, 0, TAU);
      context.stroke();
    };

    // A shock front is never a perfect circle: three slow harmonics keep it organic.
    const front = (x, y, radius, wobble, seed, passes) => {
      if (radius < 2) return;
      context.beginPath();
      for (let index = 0; index <= 120; index += 1) {
        const angle = index / 120 * TAU;
        const swell = 1 + wobble * (Math.sin(angle * 3 + seed) * 0.5 + Math.sin(angle * 7 - seed * 1.7) * 0.3 + Math.sin(angle * 13 + seed * 2.3) * 0.2);
        const px = x + Math.cos(angle) * radius * swell;
        const py = y + Math.sin(angle) * radius * swell;
        if (index) context.lineTo(px, py);
        else context.moveTo(px, py);
      }
      passes.forEach(([lineWidth, color, alpha]) => {
        context.strokeStyle = rgba(color, alpha);
        context.lineWidth = lineWidth;
        context.stroke();
      });
    };

    const spike = (x, y, angle, length, thickness, alpha) => {
      context.save();
      context.translate(x, y);
      context.rotate(angle);
      const gradient = context.createLinearGradient(0, 0, length, 0);
      gradient.addColorStop(0, rgba(COLORS.white, alpha));
      gradient.addColorStop(0.18, rgba(COLORS.gold, alpha * 0.75));
      gradient.addColorStop(0.55, rgba(COLORS.amber, alpha * 0.3));
      gradient.addColorStop(1, rgba(COLORS.amber, 0));
      context.fillStyle = gradient;
      context.beginPath();
      context.moveTo(0, -thickness);
      context.lineTo(length, 0);
      context.lineTo(0, thickness);
      context.closePath();
      context.fill();
      context.restore();
    };

    const drawCollapse = (age, x, y) => {
      // As the core swallows light, a window into deep space opens around it.
      const depth = age < DETONATE
        ? Math.pow(smooth(0.15, 2.85, age), 1.2)
        : Math.exp(-(age - DETONATE) / 0.07);
      const veil = 0.8 * depth;
      if (veil > 0.004) {
        // Stacked mobile layouts keep the window clear of the copy above the art.
        const radius = unit * (compact() ? 0.8 : 1) * (age < DETONATE ? 0.38 + 0.66 * smooth(0.1, 2.7, age) : 1.04);
        glow(x, y, radius, [[0, COLORS.night, veil], [0.3, COLORS.indigo, veil * 0.88], [0.56, COLORS.deep, veil * 0.46], [0.8, COLORS.cobalt, veil * 0.12], [1, COLORS.cobalt, 0]]);
        for (let index = 0; index < stars.length; index += stride) {
          const star = stars[index];
          if (star.radius * unit > radius * 0.8) continue;
          const twinkle = 0.5 + 0.5 * Math.sin(age * star.rate + star.phase);
          const alpha = depth * star.alpha * twinkle * (1 - star.radius * unit / radius);
          if (alpha < 0.02) continue;
          context.fillStyle = rgba(COLORS.white, alpha);
          context.fillRect(x + Math.cos(star.angle) * star.radius * unit, y + Math.sin(star.angle) * star.radius * unit, star.size, star.size);
        }
      }
      if (age >= DETONATE) return;

      // Matter spirals into the core along curved, accelerating streaks.
      for (let index = 0; index < infall.length; index += stride) {
        const particle = infall[index];
        const progress = (age - particle.spawn) / particle.duration;
        if (progress <= 0 || progress >= 1) continue;
        const point = (value) => {
          const eased = Math.pow(value, 2.2);
          const radius = particle.radius * (1 - eased) * unit;
          const angle = particle.angle + particle.spin * eased;
          return [x + Math.cos(angle) * radius, y + Math.sin(angle) * radius * 0.94];
        };
        const tail = Math.max(0, progress - 0.1 - progress * 0.08);
        const alpha = smooth(0, 0.18, progress) * (1 - smooth(0.86, 1, progress)) * 0.85;
        context.strokeStyle = rgba(blend(particle.color, COLORS.gold, smooth(0.4, 1, progress)), alpha);
        context.lineWidth = particle.width * (0.7 + progress * 1.3);
        context.beginPath();
        for (let step = 0; step <= 4; step += 1) {
          const [px, py] = point(tail + (progress - tail) * step / 4);
          if (step) context.lineTo(px, py);
          else context.moveTo(px, py);
        }
        context.stroke();
      }

      // A contracting ring is the last breath before ignition.
      if (age > 2.45) {
        const progress = smooth(2.45, 2.99, age);
        const alpha = 0.75 * Math.pow(Math.sin(progress * Math.PI), 0.8);
        const radius = unit * (0.3 * (1 - progress) + 0.012);
        ring(x, y, radius, 2.4, [[0, COLORS.gold, 0], [0.5, blend(COLORS.cobalt, COLORS.gold, progress), alpha], [1, COLORS.cobalt, 0]]);
      }

      // The core heartbeat accelerates toward collapse, then pinches to a point.
      const tension = clamp(age / DETONATE);
      const phase = 0.9 * age + 5.16 * Math.pow(tension, 3.2);
      const beat = Math.exp(-(phase % 1) * 7);
      const pinch = 1 - 0.82 * smooth(2.72, 2.99, age);
      const radius = (7 + 18 * Math.pow(tension, 1.4) + beat * 10 * tension) * pinch;
      const intensity = clamp(0.35 + 0.6 * tension + beat * 0.25);
      glow(x, y, radius * 4.2, [[0, COLORS.white, intensity], [0.16, COLORS.cream, intensity * 0.9], [0.4, COLORS.gold, intensity * 0.45], [1, COLORS.amber, 0]]);
    };

    const drawDetonation = (age, x, y, reach) => {
      const t = age - DETONATE;
      if (t < 0) return;
      const flash = t < 0.04 ? t / 0.04 : Math.exp(-(t - 0.04) / 0.17);

      if (flash > 0.01) {
        glow(x, y, reach * 1.02, [[0, COLORS.cream, 0.5 * flash], [0.45, COLORS.cream, 0.22 * flash], [1, COLORS.cream, 0]]);
      }

      // A slower, thinner light echo trails the main shock.
      if (t > 0.16) {
        const echo = t - 0.16;
        const radius = reach * 0.96 * (1 - Math.exp(-echo / 0.75));
        const alpha = 0.4 * Math.exp(-echo / 1.3) * (1 - smooth(reach * 0.7, reach * 0.97, radius));
        if (alpha > 0.005) front(x, y, radius, 0.012, 5.1 + echo * 0.4, [[6 + 8 * (1 - Math.exp(-echo / 0.5)), COLORS.periwinkle, alpha * 0.28], [1.1, COLORS.teal, alpha * 0.8]]);
      }
      const shockRadius = reach * 1.02 * (1 - Math.exp(-t / 0.38));
      const shockAlpha = 0.9 * Math.exp(-t / 0.95) * (1 - smooth(reach * 0.72, reach * 0.98, shockRadius));
      if (shockAlpha > 0.005) {
        const thickness = 4 + 26 * (1 - Math.exp(-t / 0.25));
        ring(x, y, shockRadius * 0.97, thickness, [[0, COLORS.amber, 0], [0.55, COLORS.amber, shockAlpha * 0.42], [1, COLORS.amber, 0]]);
        front(x, y, shockRadius, 0.018, 1.3 + t * 0.7, [[thickness * 0.45, COLORS.cobalt, shockAlpha * 0.22], [1.6, COLORS.cobalt, shockAlpha * 0.78]]);
      }

      // Ejecta: motion-blurred from their real trajectory a shutter-length ago.
      const shutter = 0.034;
      for (let index = 0; index < ejecta.length; index += stride) {
        const particle = ejecta[index];
        const life = t - particle.delay;
        if (life <= 0 || life > particle.life) continue;
        const at = (value) => {
          const radius = (particle.start + particle.reach * (1 - Math.exp(-particle.drag * value))) * unit;
          const angle = particle.angle + particle.spin * (1 - Math.exp(-1.4 * value));
          return [x + Math.cos(angle) * radius, y + Math.sin(angle) * radius * 0.96];
        };
        const [x0, y0] = at(Math.max(0, life - shutter));
        const [x1, y1] = at(life);
        const heat = particle.heat * Math.exp(-life / 0.3);
        // Fragments fade as they lose speed, so nothing lingers as static confetti.
        const speed = Math.exp(-particle.drag * life);
        const alpha = smooth(0, 0.035, life) * smooth(0.04, 0.32, speed) * (1 - smooth(particle.life * 0.5, particle.life, life)) * particle.alpha;
        if (alpha < 0.01) continue;
        context.strokeStyle = rgba(heatColor(heat, particle.family), alpha);
        context.lineWidth = particle.width * (1 + heat * 0.8);
        context.beginPath();
        context.moveTo(x0, y0);
        context.lineTo(x1, y1);
        context.stroke();
      }

      // Dense knots drag tapered smoke trails, like the clumps in real remnants.
      for (const knot of knots) {
        if (t > knot.life) continue;
        const fade = smooth(0, 0.05, t) * (1 - smooth(knot.life * 0.5, knot.life, t));
        const head = heatColor(Math.exp(-t / 0.45), knot.family);
        const at = (value) => {
          const radius = (0.03 + knot.reach * (1 - Math.exp(-knot.drag * Math.max(0, value)))) * unit;
          const angle = knot.angle + knot.spin * (1 - Math.exp(-Math.max(0, value)));
          return [x + Math.cos(angle) * radius, y + Math.sin(angle) * radius * 0.96];
        };
        let [px, py] = at(t);
        for (let step = 1; step <= 8; step += 1) {
          const [qx, qy] = at(t - step * 0.045);
          context.strokeStyle = rgba(blend(head, knot.family.end, step / 8), fade * (1 - step / 9) * 0.7);
          context.lineWidth = knot.size * 2 * (1 - step / 10);
          context.beginPath();
          context.moveTo(px, py);
          context.lineTo(qx, qy);
          context.stroke();
          px = qx;
          py = qy;
        }
      }

      if (flash > 0.01) {
        const radius = unit * (0.1 + 0.62 * (1 - Math.exp(-t / 0.08)));
        glow(x, y, radius, [[0, COLORS.white, flash], [0.1, COLORS.cream, 0.95 * flash], [0.32, COLORS.gold, 0.55 * flash], [0.62, COLORS.amber, 0.16 * flash], [1, COLORS.amber, 0]]);
      }

      // Six telescope diffraction spikes plus a faint horizontal pair.
      const spikes = Math.exp(-t / 0.55);
      if (spikes > 0.01) {
        const grow = 1 - Math.exp(-t / 0.07);
        for (let index = 0; index < 6; index += 1) {
          spike(x, y, Math.PI / 2 + index * Math.PI / 3, unit * (0.22 + 0.95 * grow), 1.6 + 2.6 * spikes, 0.85 * spikes);
        }
        spike(x, y, 0, unit * (0.12 + 0.42 * grow), 1 + spikes, 0.5 * spikes);
        spike(x, y, Math.PI, unit * (0.12 + 0.42 * grow), 1 + spikes, 0.5 * spikes);
      }

      // Anamorphic lens streak: a wide horizontal flare with a cool coating line.
      const streak = Math.exp(-t / 0.42);
      if (streak > 0.01) {
        const length = unit * (0.6 + 1.55 * (1 - Math.exp(-t / 0.06)));
        const band = (thickness, alpha, color, offset = 0) => {
          const gradient = context.createLinearGradient(x - length, 0, x + length, 0);
          gradient.addColorStop(0, rgba(color, 0));
          gradient.addColorStop(0.36, rgba(color, alpha * 0.45));
          gradient.addColorStop(0.5, rgba(COLORS.white, alpha));
          gradient.addColorStop(0.64, rgba(color, alpha * 0.45));
          gradient.addColorStop(1, rgba(color, 0));
          context.fillStyle = gradient;
          context.fillRect(x - length, y + offset - thickness / 2, length * 2, thickness);
        };
        band(14, 0.22 * streak, COLORS.gold);
        band(2.4, 0.95 * streak, COLORS.gold);
        band(1, 0.35 * streak, COLORS.cobalt, 6);
      }
    };

    const drawEmbers = (age, x, y) => {
      const t = age - DETONATE;
      for (let index = 0; index < embers.length; index += stride) {
        const ember = embers[index];
        const life = t - ember.birth;
        if (life <= 0 || life > ember.life) continue;
        const alpha = Math.pow(Math.sin(Math.PI * life / ember.life), 1.4) * ember.alpha * (0.65 + 0.35 * Math.sin(life * 6 + ember.phase));
        const px = x + (ember.x + ember.vx * life + Math.sin(life * ember.sway + ember.phase) * 0.01) * unit;
        const py = y + (ember.y + ember.vy * life) * unit;
        context.fillStyle = rgba(ember.color, alpha);
        context.beginPath();
        context.arc(px, py, ember.size, 0, TAU);
        context.fill();
      }
    };

    const clear = () => context.clearRect(0, 0, width, height);

    const stop = () => {
      active = false;
      clear();
      canvas.hidden = true;
      canvas.dataset.state = "idle";
      if (hint && label && label !== idleHint) hint.textContent = idleHint;
      label = idleHint;
    };

    return {
      resize,
      reset(index) {
        pulse = index;
        detonated = false;
        active = true;
        lastFrame = 0;
        canvas.hidden = false;
        canvas.dataset.state = "armed";
        resize();
        build();
      },
      frame(age) {
        if (!active) return;
        if (age >= END) {
          stop();
          return;
        }
        // Shed particle detail when frames run long, rather than slowing the scene.
        const now = performance.now();
        if (lastFrame && now - lastFrame < 250) frameCost += (now - lastFrame - frameCost) * 0.2;
        lastFrame = now;
        stride = frameCost > 45 ? 3 : frameCost > 26 ? 2 : 1;
        canvas.dataset.detail = String(stride);
        if (!detonated && age >= DETONATE) {
          detonated = true;
          canvas.dataset.state = "detonated";
          strike();
        }
        clear();
        const x = width * 0.501;
        const y = height * 0.496;
        const reach = Math.min(width, height) / 2;
        drawCollapse(age, x, y);
        drawDetonation(age, x, y, reach);
        drawEmbers(age, x, y);
        updateHint(age);
      },
      // Suppression (reduced motion, context loss) cancels the in-flight accents too.
      hide() {
        shock.forEach((animation) => animation.cancel());
        shock.clear();
        stop();
      }
    };
  }

  window.WorkSupernovaFx = Object.freeze({ create, detonation: DETONATE, duration: END });
})();

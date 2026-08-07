(() => {
  document.documentElement.classList.remove("no-js");
  document.documentElement.classList.add("js");

  const canvas = document.querySelector("[data-supernova-canvas]");
  const hero = canvas?.closest(".work-hero");
  const art = hero?.querySelector(".work-hero__art");
  const geometryLayer = document.querySelector("[data-nova-geometry]");
  if (!canvas || !hero || !art) return;

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return;

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const palette = [
    [40, 100, 199],
    [104, 127, 196],
    [22, 140, 134],
    [233, 139, 39],
    [223, 100, 44]
  ];
  const particles = [];
  const cloudLobes = [];
  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let centerX = 0;
  let centerY = 0;
  let radius = 1;
  let frame = 0;
  let visible = true;
  let seed = 20260807;

  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const buildGeometry = () => {
    if (!geometryLayer || geometryLayer.childElementCount) return;
    let fieldSeed = 6700417;
    const fieldRandom = () => {
      fieldSeed = (fieldSeed * 1103515245 + 12345) & 0x7fffffff;
      return fieldSeed / 0x80000000;
    };
    const types = ["ring", "square", "diamond", "triangle", "line", "cross"];
    for (let index = 0; index < 34; index += 1) {
      const shape = document.createElement("span");
      shape.className = `work-supernova-geometry__shape work-supernova-geometry__shape--${types[Math.floor(fieldRandom() * types.length)]}`;
      shape.style.setProperty("--gx", `${Math.round(fieldRandom() * 100)}%`);
      shape.style.setProperty("--gy", `${Math.round(fieldRandom() * 100)}%`);
      shape.style.setProperty("--gs", `${8 + Math.round(fieldRandom() * 34)}px`);
      shape.style.setProperty("--gr", `${Math.round(fieldRandom() * 180)}deg`);
      shape.style.setProperty("--gd", `${(fieldRandom() * -12).toFixed(2)}s`);
      geometryLayer.append(shape);
    }
  };

  const buildField = () => {
    particles.length = 0;
    cloudLobes.length = 0;
    seed = 20260807;

    const count = Math.max(140, Math.min(260, Math.round((width * height) / 3900)));
    for (let index = 0; index < count; index += 1) {
      const spoke = Math.floor(random() * 23);
      const baseAngle = (spoke / 23) * Math.PI * 2;
      particles.push({
        angle: baseAngle + (random() - 0.5) * (0.1 + random() * 0.3),
        reach: 0.3 + Math.pow(random(), 0.55) * 0.95,
        size: 0.45 + random() * 1.7,
        alpha: 0.14 + random() * 0.58,
        speed: 0.35 + random() * 0.8,
        phase: random(),
        trail: 0.02 + Math.pow(random(), 1.7) * 0.105,
        verticalScale: 0.66 + random() * 0.22,
        color: palette[Math.floor(random() * palette.length)]
      });
    }

    for (let index = 0; index < 13; index += 1) {
      cloudLobes.push({
        angle: random() * Math.PI * 2,
        distance: 0.08 + random() * 0.34,
        size: 0.16 + random() * 0.24,
        squash: 0.46 + random() * 0.42,
        alpha: 0.035 + random() * 0.07,
        color: palette[Math.floor(random() * palette.length)]
      });
    }
  };

  const resize = () => {
    const heroRect = hero.getBoundingClientRect();
    const artRect = art.getBoundingClientRect();
    const horizontalBleed = Math.min(420, Math.max(88, Math.round(heroRect.width * 0.26)));
    const verticalBleed = Math.min(280, Math.max(96, Math.round(heroRect.height * 0.24)));
    width = Math.max(1, Math.round(heroRect.width + horizontalBleed * 2));
    height = Math.max(1, Math.round(heroRect.height + verticalBleed * 2));
    centerX = artRect.left - heroRect.left + artRect.width * 0.51 + horizontalBleed;
    centerY = artRect.top - heroRect.top + artRect.height * 0.51 + verticalBleed;
    radius = Math.max(150, Math.min(artRect.width, artRect.height) * 0.78);
    pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    canvas.style.left = `${-horizontalBleed}px`;
    canvas.style.top = `${-verticalBleed}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    buildField();
    draw(performance.now(), false);
  };

  const drawCloud = (lobe, pulse) => {
    const distance = radius * lobe.distance * (0.9 + pulse * 0.12);
    const x = centerX + Math.cos(lobe.angle) * distance * 1.25;
    const y = centerY + Math.sin(lobe.angle) * distance * 0.76;
    const size = radius * lobe.size * (0.92 + pulse * 0.16);
    const [red, green, blue] = lobe.color;

    context.save();
    context.translate(x, y);
    context.rotate(lobe.angle);
    context.scale(1, lobe.squash);
    const cloud = context.createRadialGradient(0, 0, 0, 0, 0, size);
    cloud.addColorStop(0, `rgba(${red},${green},${blue},${lobe.alpha})`);
    cloud.addColorStop(0.45, `rgba(${red},${green},${blue},${lobe.alpha * 0.58})`);
    cloud.addColorStop(1, `rgba(${red},${green},${blue},0)`);
    context.fillStyle = cloud;
    context.fillRect(-size, -size, size * 2, size * 2);
    context.restore();
  };

  const draw = (time, schedule = true) => {
    context.clearRect(0, 0, width, height);
    const clock = reduceMotion.matches ? 2800 : time;
    const pulse = 0.5 + Math.sin(clock * 0.00125) * 0.5;

    cloudLobes.forEach((lobe) => drawCloud(lobe, pulse));

    const halo = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius * 0.86);
    halo.addColorStop(0, "rgba(255,255,255,0.92)");
    halo.addColorStop(0.055, "rgba(244,180,85,0.36)");
    halo.addColorStop(0.2, "rgba(40,100,199,0.12)");
    halo.addColorStop(0.56, "rgba(40,100,199,0.035)");
    halo.addColorStop(1, "rgba(250,249,244,0)");
    context.fillStyle = halo;
    context.fillRect(0, 0, width, height);

    context.save();
    context.globalCompositeOperation = "multiply";
    [0, 0.33, 0.66].forEach((offset, index) => {
      const wave = reduceMotion.matches ? 0.48 + index * 0.16 : (clock * 0.00013 + offset) % 1;
      const waveRadius = radius * (0.1 + wave * 1.46);
      const opacity = Math.sin(Math.PI * wave) * (0.24 - index * 0.035);
      context.beginPath();
      context.ellipse(centerX, centerY, waveRadius * 1.28, waveRadius * 0.74, -0.08 + index * 0.035, 0, Math.PI * 2);
      context.strokeStyle = index === 1
        ? `rgba(233,139,39,${Math.max(0, opacity)})`
        : `rgba(40,100,199,${Math.max(0, opacity)})`;
      context.lineWidth = 1.15 + (1 - wave) * 1.5;
      context.stroke();
    });
    context.restore();

    context.save();
    context.globalCompositeOperation = "lighter";
    particles.forEach((particle) => {
      const expansion = reduceMotion.matches
        ? particle.phase
        : (particle.phase + clock * (0.000075 + particle.speed * 0.000038)) % 1;
      const travel = 1 - Math.pow(1 - expansion, 2.1);
      const distance = radius * particle.reach * (0.025 + travel * 1.18);
      const x = centerX + Math.cos(particle.angle) * distance * 1.28;
      const y = centerY + Math.sin(particle.angle) * distance * particle.verticalScale;
      const fadeIn = Math.min(1, expansion / 0.07);
      const fadeOut = 1 - Math.max(0, expansion - 0.68) / 0.32;
      const fade = fadeIn * Math.max(0, fadeOut);
      const trail = radius * particle.trail * (0.38 + travel);
      const [red, green, blue] = particle.color;

      context.beginPath();
      context.moveTo(
        x - Math.cos(particle.angle) * trail * 1.28,
        y - Math.sin(particle.angle) * trail * particle.verticalScale
      );
      context.lineTo(x, y);
      context.strokeStyle = `rgba(${red},${green},${blue},${particle.alpha * 0.52 * fade})`;
      context.lineWidth = Math.max(0.5, particle.size * 0.66);
      context.stroke();

      context.beginPath();
      context.arc(x, y, particle.size, 0, Math.PI * 2);
      context.fillStyle = `rgba(${red},${green},${blue},${particle.alpha * fade})`;
      context.fill();
    });

    const flashRadius = radius * (0.075 + pulse * 0.026);
    const flash = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, flashRadius);
    flash.addColorStop(0, "rgba(255,255,255,1)");
    flash.addColorStop(0.17, "rgba(255,248,218,0.98)");
    flash.addColorStop(0.48, "rgba(242,150,47,0.6)");
    flash.addColorStop(1, "rgba(223,100,44,0)");
    context.fillStyle = flash;
    context.beginPath();
    context.arc(centerX, centerY, flashRadius, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = `rgba(40,100,199,${0.18 + pulse * 0.18})`;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(centerX - radius * 0.45, centerY + radius * 0.04);
    context.lineTo(centerX + radius * 0.45, centerY - radius * 0.04);
    context.moveTo(centerX - radius * 0.025, centerY - radius * 0.34);
    context.lineTo(centerX + radius * 0.025, centerY + radius * 0.34);
    context.stroke();
    context.restore();

    if (schedule && !reduceMotion.matches && visible && !document.hidden) {
      frame = requestAnimationFrame((nextTime) => draw(nextTime));
    }
  };

  const start = () => {
    cancelAnimationFrame(frame);
    if (reduceMotion.matches || document.hidden || !visible) {
      draw(performance.now(), false);
      return;
    }
    frame = requestAnimationFrame((time) => draw(time));
  };

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    start();
  }, { rootMargin: "120px" });

  new ResizeObserver(resize).observe(hero);
  observer.observe(hero);
  document.addEventListener("visibilitychange", start);
  reduceMotion.addEventListener("change", start);
  buildGeometry();
  resize();
  start();
})();

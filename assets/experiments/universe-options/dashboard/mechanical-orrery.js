(() => {
  document.documentElement.classList.remove("no-js");
  document.documentElement.classList.add("js");

  const root = document.querySelector("[data-orrery]");
  if (!root) return;

  const stage = root.querySelector(".orrery-stage");
  const nodes = [...root.querySelectorAll("[data-node]")];
  const arms = new Map([...root.querySelectorAll("[data-arm]")].map((arm) => [arm.dataset.arm, arm]));
  const motionToggle = root.querySelector("[data-motion-toggle]");
  const soundToggle = root.querySelector("[data-sound-toggle]");
  const release = root.querySelector("[data-release]");
  const readout = root.querySelector("[data-readout]");
  const readoutClose = root.querySelector("[data-readout-close]");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  const content = {
    about: { code:"[OBJECT 01 / WHOLE-PERSON SPHERE]", title:"Professional + personal.", copy:"AI-native software engineer with 10+ years in production. Husband, dad, explorer, photographer, amateur astronomer, reader, and builder.", href:"/about.html", signals:["platform depth","family + place","curiosity"] },
    profile: { code:"[OBJECT 02 / CAPABILITY LATTICE]", title:"Skills + interests.", copy:"Mobile is home turf. The work extends into backend systems, architecture, reliability, agent-first delivery, cameras, astronomy, philosophy, fitness, and small ventures.", href:"/about.html#profile-map", signals:["engineering","evidence","interests"] },
    work: { code:"[OBJECT 03 / PRODUCTION GYROSCOPE]", title:"A production record.", copy:"I build the parts people notice when they fail—across mobile, backend, architecture, reliability, leadership, and release.", href:"/work.html", signals:["10+ years","lead + build","verified delivery"] },
    projects: { code:"[OBJECT 04 / SYSTEM FRAME]", title:"Selected systems, up close.", copy:"Bitcoin.com Wallet, ITVX, OCBC Business, and public builds—real products with different constraints and inspectable evidence boundaries.", href:"/work.html#production-work", signals:["Bitcoin.com","streaming","banking"] },
    threads: { code:"[OBJECT 05 / THOUGHT LOOM]", title:"Questions I keep returning to.", copy:"Agent systems that leave receipts, useful location tools without surveillance, and the discipline to look before moving on.", href:"/blog/", signals:["agents","privacy","observation"] },
    contact: { code:"[OBJECT 06 / CONNECTION PRISM]", title:"Let’s build something durable.", copy:"A direct route into engineering leadership, mobile and backend systems, reliability work, or thoughtful agent-assisted delivery.", href:"/contact.html", signals:["clear context","real constraints","durable outcomes"] }
  };

  const state = { paused:reduced.matches, active:null, started:performance.now(), last:performance.now() };
  let soundEnabled = false;
  let audioContext = null;

  const syncMotionControl = () => {
    motionToggle.setAttribute("aria-pressed", String(state.paused));
    motionToggle.textContent = state.paused ? "[resume mechanism]" : "[pause mechanism]";
  };
  syncMotionControl();

  const playCue = (frequency, duration = .08) => {
    if (!soundEnabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      soundEnabled = false;
      soundToggle.textContent = "[sound: unavailable]";
      soundToggle.disabled = true;
      return;
    }
    audioContext ||= new AudioContext();
    const sound = () => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
      gain.gain.setValueAtTime(.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(.035, audioContext.currentTime + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + duration);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration + .01);
    };
    if (audioContext.state === "suspended") audioContext.resume().then(sound).catch(() => {});
    else sound();
  };
  const base = nodes.map((node, index) => ({ node, index, key:node.dataset.node, radius:Number(node.dataset.radius), angle:Number(node.dataset.angle), speed:Number(node.dataset.speed), theta:Number(node.dataset.angle) }));

  const radiusScale = () => Math.min(1, Math.max(.48, stage.clientWidth / 1050));
  const position = (entry, now) => {
    if (!state.paused && state.active !== entry.key) {
      entry.theta = entry.angle + Math.sin(now * .00032 * Math.abs(entry.speed) + entry.index * 1.4) * 6 * Math.sign(entry.speed);
    }
    if (state.active === entry.key) {
      const delta = ((335 - entry.theta + 540) % 360) - 180;
      entry.theta += delta * .045;
    }
    const scale = radiusScale();
    const radius = entry.radius * scale * (state.active === entry.key ? .78 : 1);
    const radians = entry.theta * Math.PI / 180;
    const cx = stage.clientWidth * (innerWidth <= 640 ? .5 : .48);
    const cy = stage.clientHeight * .5;
    const x = cx + Math.cos(radians) * radius;
    const y = cy + Math.sin(radians) * radius * .72;
    entry.node.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    const arm = arms.get(entry.key);
    if (arm) {
      arm.style.width = `${radius}px`;
      arm.style.left = `${cx}px`;
      arm.style.top = `${cy}px`;
      arm.style.transform = `rotate(${Math.atan2((y - cy), (x - cx)) * 180 / Math.PI}deg)`;
    }
  };
  const frame = (now) => { base.forEach((entry) => position(entry, now)); state.last = now; requestAnimationFrame(frame); };

  const show = (key, historyMode = "push") => {
    const item = content[key];
    if (!item) return;
    state.active = key;
    root.dataset.active = key;
    nodes.forEach((node) => node.setAttribute("aria-current", String(node.dataset.node === key)));
    release.disabled = false;
    readout.hidden = false;
    readout.querySelector("[data-readout-code]").textContent = item.code;
    readout.querySelector("[data-readout-title]").textContent = item.title;
    readout.querySelector("[data-readout-copy]").textContent = item.copy;
    readout.querySelector("[data-readout-signals]").replaceChildren(...item.signals.map((signal) => { const span=document.createElement("span"); span.textContent=signal; return span; }));
    const link = readout.querySelector("[data-readout-link]");
    link.href = item.href;
    if (historyMode !== "replace") playCue(520 + nodes.findIndex((node) => node.dataset.node === key) * 36, .1);
    if (historyMode !== "none") history[historyMode === "replace" ? "replaceState" : "pushState"]({ object:key }, "", `#${key}`);
  };
  const clear = (historyMode = "push") => {
    state.active = null;
    delete root.dataset.active;
    nodes.forEach((node) => node.removeAttribute("aria-current"));
    release.disabled = true;
    readout.hidden = true;
    if (historyMode !== "replace") playCue(330, .07);
    if (historyMode !== "none") history[historyMode === "replace" ? "replaceState" : "pushState"]({}, "", location.pathname + location.search);
  };

  nodes.forEach((node) => node.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    show(node.dataset.node);
  }));
  motionToggle.addEventListener("click", () => { state.paused = !state.paused; if (!state.paused) state.started = performance.now(); syncMotionControl(); playCue(state.paused ? 280 : 440); });
  soundToggle.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    soundToggle.setAttribute("aria-pressed", String(soundEnabled));
    soundToggle.textContent = soundEnabled ? "[sound: on]" : "[sound: off]";
    if (soundEnabled) playCue(610, .11);
  });
  release.addEventListener("click", () => clear());
  readoutClose.addEventListener("click", () => clear());
  addEventListener("keydown", (event) => { if (event.key === "Escape" && state.active) clear(); });
  addEventListener("popstate", () => location.hash ? show(location.hash.slice(1), "none") : clear("none"));
  reduced.addEventListener("change", (event) => { state.paused = event.matches; syncMotionControl(); });
  location.hash ? show(location.hash.slice(1), "replace") : clear("replace");
  requestAnimationFrame(frame);
})();

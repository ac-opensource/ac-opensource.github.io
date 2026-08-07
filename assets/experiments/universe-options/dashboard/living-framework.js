(() => {
  document.documentElement.classList.remove("no-js");
  document.documentElement.classList.add("js");

  const root = document.querySelector("[data-framework]");
  if (!root) return;
  const field = root.querySelector(".framework-field");
  const joints = [...root.querySelectorAll("[data-joint]")];
  const edges = [...root.querySelectorAll("[data-edge]")];
  const focus = root.querySelector("[data-focus]");
  const motion = root.querySelector("[data-motion]");
  const sound = root.querySelector("[data-sound]");
  const status = root.querySelector("[data-status]");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");

  const content = {
    about:{index:"01",code:"[OBJECT 01 / WHOLE-PERSON SPHERE]",title:"Professional + personal.",copy:"AI-native software engineer with 10+ years in production. Husband, dad, explorer, photographer, amateur astronomer, reader, and builder.",href:"/about.html",satellites:["platform depth","family + place","curiosity"]},
    profile:{index:"02",code:"[OBJECT 02 / CAPABILITY LATTICE]",title:"Skills + interests.",copy:"Mobile is home turf. The work extends into backend systems, architecture, reliability, agent-first delivery, cameras, astronomy, philosophy, fitness, and small ventures.",href:"/about.html#profile-map",satellites:["engineering","evidence","interests"]},
    work:{index:"03",code:"[OBJECT 03 / PRODUCTION GYROSCOPE]",title:"A production record.",copy:"I build the parts people notice when they fail—across mobile, backend, architecture, reliability, leadership, and release.",href:"/work.html",satellites:["10+ years","lead + build","verified delivery"]},
    projects:{index:"04",code:"[OBJECT 04 / SYSTEM FRAME]",title:"Selected systems, up close.",copy:"Bitcoin.com Wallet, ITVX, OCBC Business, and public builds—real products with different constraints and inspectable evidence boundaries.",href:"/work.html#production-work",satellites:["Bitcoin.com","streaming","banking"]},
    threads:{index:"05",code:"[OBJECT 05 / THOUGHT LOOM]",title:"Questions I keep returning to.",copy:"Agent systems that leave receipts, useful location tools without surveillance, and the discipline to look before moving on.",href:"/blog/",satellites:["agents","privacy","observation"]},
    contact:{index:"06",code:"[OBJECT 06 / CONNECTION PRISM]",title:"Let’s build something durable.",copy:"A direct route into engineering leadership, mobile and backend systems, reliability work, or thoughtful agent-assisted delivery.",href:"/contact.html",satellites:["clear context","real constraints","durable outcomes"]}
  };

  const points = new Map(joints.map((joint, index) => [joint.dataset.joint,{joint,index,baseX:Number(joint.dataset.x),baseY:Number(joint.dataset.y),x:Number(joint.dataset.x),y:Number(joint.dataset.y)}]));
  const state = {active:null,paused:reduced.matches,start:performance.now()};
  let soundEnabled = false;
  let audioContext = null;

  const syncMotionControl = () => {
    motion.setAttribute("aria-pressed",String(state.paused));
    motion.textContent=state.paused?"[resume structure]":"[pause structure]";
  };
  syncMotionControl();

  const playCue = (frequency, duration=.08) => {
    if (!soundEnabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      soundEnabled=false;
      sound.textContent="[sound: unavailable]";
      sound.disabled=true;
      return;
    }
    audioContext ||= new AudioContext();
    const render = () => {
      const oscillator=audioContext.createOscillator();
      const gain=audioContext.createGain();
      oscillator.type="triangle";
      oscillator.frequency.setValueAtTime(frequency,audioContext.currentTime);
      gain.gain.setValueAtTime(.0001,audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(.028,audioContext.currentTime+.012);
      gain.gain.exponentialRampToValueAtTime(.0001,audioContext.currentTime+duration);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime+duration+.01);
    };
    if(audioContext.state==="suspended")audioContext.resume().then(render).catch(()=>{});else render();
  };

  const targetFor = (point) => {
    if (!state.active) return [point.baseX,point.baseY];
    if (point.joint.dataset.joint === state.active) return [54,42];
    const ordered = joints.filter((joint) => joint.dataset.joint !== state.active);
    const position = ordered.indexOf(point.joint);
    const perimeter = [[72,12],[78,36],[74,73],[52,86],[22,70]];
    return perimeter[position] || [point.baseX,point.baseY];
  };
  const draw = (now) => {
    points.forEach((point) => {
      const [tx,ty] = targetFor(point);
      point.x += (tx - point.x) * .045;
      point.y += (ty - point.y) * .045;
      const breathe = state.paused || state.active ? 0 : 1;
      const phase = now * .00022 + point.index * 1.7;
      const x = point.x + Math.sin(phase) * (1.15 + point.index * .08) * breathe;
      const y = point.y + Math.cos(phase * 1.23) * (.8 + point.index * .06) * breathe;
      point.renderX = x;
      point.renderY = y;
      point.joint.style.transform = `translate(${field.clientWidth * x / 100}px, ${field.clientHeight * y / 100}px) translate(-50%, -50%)`;
    });
    edges.forEach((edge) => {
      const [fromKey,toKey] = edge.dataset.edge.split(":");
      const from=points.get(fromKey),to=points.get(toKey);
      edge.setAttribute("x1",String(from.renderX * 10)); edge.setAttribute("y1",String(from.renderY * 7.2)); edge.setAttribute("x2",String(to.renderX * 10)); edge.setAttribute("y2",String(to.renderY * 7.2));
    });
    requestAnimationFrame(draw);
  };

  const show = (key,historyMode="push") => {
    const item=content[key]; if(!item)return;
    state.active=key; root.dataset.active=key; status.textContent=`FRAME / ${key.toUpperCase()} LOAD`;
    joints.forEach((joint)=>joint.setAttribute("aria-current",String(joint.dataset.joint===key)));
    focus.hidden=false; focus.querySelector("[data-focus-index]").textContent=item.index; focus.querySelector("[data-focus-code]").textContent=item.code; focus.querySelector("[data-focus-title]").textContent=item.title; focus.querySelector("[data-focus-copy]").textContent=item.copy;
    focus.querySelector("[data-focus-satellites]").replaceChildren(...item.satellites.map((value)=>{const span=document.createElement("span");span.textContent=value;return span;}));
    focus.querySelector("[data-focus-link]").href=item.href;
    if(historyMode!=="replace")playCue(480+Number(item.index)*38,.1);
    if(historyMode!=="none")history[historyMode==="replace"?"replaceState":"pushState"]({object:key},"",`#${key}`);
  };
  const clear = (historyMode="push") => {
    state.active=null; delete root.dataset.active; status.textContent="FRAME / BALANCED"; joints.forEach((joint)=>joint.removeAttribute("aria-current")); focus.hidden=true;
    if(historyMode!=="replace")playCue(300,.07);
    if(historyMode!=="none")history[historyMode==="replace"?"replaceState":"pushState"]({},"",location.pathname+location.search);
  };
  joints.forEach((joint)=>joint.addEventListener("click",(event)=>{if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0)return;event.preventDefault();show(joint.dataset.joint);}));
  focus.querySelector("[data-focus-close]").addEventListener("click",()=>clear());
  motion.addEventListener("click",()=>{state.paused=!state.paused;syncMotionControl();playCue(state.paused?260:420);});
  sound.addEventListener("click",()=>{soundEnabled=!soundEnabled;sound.setAttribute("aria-pressed",String(soundEnabled));sound.textContent=soundEnabled?"[sound: on]":"[sound: off]";if(soundEnabled)playCue(590,.11);});
  addEventListener("keydown",(event)=>{if(event.key==="Escape"&&state.active)clear();});
  addEventListener("popstate",()=>location.hash?show(location.hash.slice(1),"none"):clear("none"));
  reduced.addEventListener("change",(event)=>{state.paused=event.matches;syncMotionControl();});
  location.hash?show(location.hash.slice(1),"replace"):clear("replace");
  requestAnimationFrame(draw);
})();

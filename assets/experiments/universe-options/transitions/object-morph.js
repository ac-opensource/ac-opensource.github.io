(() => {
  document.documentElement.classList.remove("no-js"); document.documentElement.classList.add("js");
  const page=document.body.dataset.morphPage; const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
  const destinations={
    work:{code:"[ROUTE 03 / PORTFOLIO RECEIVED]",title:"Work resolves as trajectory control.",copy:"The production object is now an inspection origin for problem, architecture, platform work, reliability, and verified release.",href:"/work.html",shape:"gyro"},
    logs:{code:"[ROUTE 05 / LOGS RECEIVED]",title:"Logs resolves as a receiver aperture.",copy:"The thought object becomes an instrument for aiming search and category signals at the real archive of published transmissions.",href:"/blog/",shape:"loom"},
    contact:{code:"[ROUTE 06 / CONTACT RECEIVED]",title:"Contact resolves as a launch structure.",copy:"The connection object becomes the frame that assembles a truthful message payload and launches only after a confirmed transport.",href:"/contact.html",shape:"prism"},
    about:{code:"[ROUTE 01 / ABOUT RECEIVED]",title:"About resolves as an observatory plate.",copy:"The whole-person object becomes an evidence instrument that connects engineering practice, interests, roles, writing, and public receipts.",href:"/about.html",shape:"sphere"}
  };
  if(page==="source"){
    const root=document.querySelector(".morph-source"),status=document.querySelector("[data-morph-status]");
    document.querySelectorAll("[data-morph-link]").forEach((link)=>link.addEventListener("click",(event)=>{
      if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||reduced)return;
      event.preventDefault(); const object=link.querySelector(".morph-object"),rect=object.getBoundingClientRect();
      const proxy=object.cloneNode(true); proxy.classList.add("morph-proxy"); Object.assign(proxy.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`}); document.body.append(proxy);
      root.dataset.departing=link.dataset.region; link.dataset.departing="true"; status.textContent=`[route ${link.dataset.region} / geometry in handoff]`;
      sessionStorage.setItem("universe-object-morph",JSON.stringify({region:link.dataset.region,at:Date.now(),rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height},viewport:{width:innerWidth,height:innerHeight}}));
      requestAnimationFrame(()=>requestAnimationFrame(()=>Object.assign(proxy.style,{left:"calc(72vw - 5rem)",top:"calc(50vh - 5rem)",width:"10rem",height:"10rem",transform:"rotate(135deg)"})));
      setTimeout(()=>location.href=link.href,620);
    }));
    return;
  }
  if(page==="arrival"){
    const key=new URL(location.href).searchParams.get("region")||"work",item=destinations[key]||destinations.work,root=document.querySelector("[data-arrival]"),object=root.querySelector("[data-arrival-object]"); root.dataset.region=key; object.classList.add(`morph-object--${item.shape}`);
    root.querySelector("[data-arrival-code]").textContent=item.code; root.querySelector("[data-arrival-title]").textContent=item.title; root.querySelector("[data-arrival-copy]").textContent=item.copy; root.querySelector("[data-arrival-link]").href=item.href;
    let receipt=null; try{receipt=JSON.parse(sessionStorage.getItem("universe-object-morph")||"null");sessionStorage.removeItem("universe-object-morph");}catch{}
    const valid=receipt&&receipt.region===key&&Date.now()-receipt.at<5000;
    root.querySelector("[data-arrival-receipt]").textContent=valid?"[internal morph / destination resolved]":"[direct arrival / no source transition]";
    if(valid&&!reduced){const target=object.getBoundingClientRect(),proxy=object.cloneNode(true);proxy.classList.add("morph-proxy");const sx=innerWidth/receipt.viewport.width,sy=innerHeight/receipt.viewport.height;Object.assign(proxy.style,{left:`${receipt.rect.left*sx}px`,top:`${receipt.rect.top*sy}px`,width:`${receipt.rect.width}px`,height:`${receipt.rect.height}px`,opacity:".18"});document.body.append(proxy);object.style.opacity="0";requestAnimationFrame(()=>requestAnimationFrame(()=>Object.assign(proxy.style,{left:`${target.left}px`,top:`${target.top}px`,width:`${target.width}px`,height:`${target.height}px`,transform:"rotate(0deg)",opacity:"1"})));setTimeout(()=>{object.style.opacity="1";proxy.remove();},620);}
  }
})();

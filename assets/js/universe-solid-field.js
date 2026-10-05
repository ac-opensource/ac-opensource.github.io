(() => {
  "use strict";

  const MATERIALS = { metal: 0, foil: 1, solar: 2, ceramic: 3, dark: 4, rock: 5, gas: 6, star: 7 };
  const STRIDE = 18;
  const finitePoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
  const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const normalized = p => {
    const length = Math.hypot(p.x, p.y, p.z);
    return length > 1e-8 ? { x: p.x / length, y: p.y / length, z: p.z / length } : { x: 0, y: 0, z: 1 };
  };
  const rgb = color => [0, 1, 2].map(i => clamp((Number.isFinite(color?.[i]) ? color[i] : 180) / 255));

  window.createUniverseSolidField = canvas => {
    const gl = canvas.getContext("webgl", {
      alpha: true, antialias: true, depth: true, stencil: false, premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) return null;
    let lost = false, disposed = false;
    const onLost = event => { event.preventDefault(); lost = true; };
    canvas.addEventListener("webglcontextlost", onLost);
    const derivatives = Boolean(gl.getExtension("OES_standard_derivatives"));
    const buffers = new Set();
    const cache = new WeakMap();
    let program = null, noiseTexture = null;

    const dispose = () => {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener("webglcontextlost", onLost);
      buffers.forEach(buffer => gl.deleteBuffer(buffer));
      if (noiseTexture) gl.deleteTexture(noiseTexture);
      if (program) gl.deleteProgram(program);
    };
    const sources = [
      `precision highp float;
      attribute vec3 position,normal,color,surface;
      attribute vec2 uv;
      attribute vec4 tangent;
      uniform vec3 eye,right,down,forward,landmark,bodyCenter,bodyColor;
      uniform float radius,nearPlane,isBody,bodyRadius,bodyMaterial,bodyEmission;
      uniform vec4 projection;
      varying vec3 vNormal,vColor,vSurface,vView,vPoint;
      varying vec2 vUV;
      varying vec4 vTangent;
      void main(){
        vec3 local=mix(position,bodyCenter+position*bodyRadius,isBody);
        vec3 world=landmark+local*radius;
        vec3 relative=world-eye;
        vec3 camera=vec3(dot(relative,right),dot(relative,down),dot(relative,forward));
        // The infinite far plane preserves the navigation camera's exact near clip.
        gl_Position=vec4(camera.x*projection.x+camera.z*projection.z,
          camera.y*projection.y+camera.z*projection.w,camera.z-2.*nearPlane,camera.z);
        vNormal=normal;vColor=mix(color,bodyColor,isBody);
        vSurface=mix(surface,vec3(bodyMaterial,bodyEmission,1.),isBody);
        vView=eye-world;vPoint=position;vUV=uv;vTangent=tangent;
      }`,
      `${derivatives ? "#extension GL_OES_standard_derivatives : enable" : ""}
      precision highp float;
      uniform sampler2D grain;
      uniform float night,isBody;
      uniform vec3 bodyCenter;
      varying vec3 vNormal,vColor,vSurface,vView,vPoint;
      varying vec2 vUV;
      varying vec4 vTangent;
      const float PI=3.14159265359;
      float noise(vec3 p){
        vec3 cell=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        vec2 st=(cell.xy+cell.z*vec2(37.,17.)+f.xy+.5)/256.;
        return mix(texture2D(grain,st).r,texture2D(grain,st+vec2(37.,17.)/256.).r,f.z);
      }
      float fbm(vec3 p){return noise(p)*.56+noise(p*2.03+9.1)*.29+noise(p*4.09+17.7)*.15;}
      float line(float p,float width){
        float distance=min(fract(p),1.-fract(p));
        float aa=${derivatives ? "max(fwidth(p)*.65,.0005)" : ".012"};
        return 1.-smoothstep(width-aa,width+aa,distance);
      }
      float foilHeight(vec2 p){
        float broad=noise(vec3(p*26.,4.7));
        float ridge=abs(noise(vec3(p*72.,13.2))-.5);
        return (broad-.5)*.023+ridge*.016+abs(sin(p.x*127.+p.y*57.+broad*9.))*.0018;
      }
      vec3 foilNormal(vec3 n,vec3 t,vec3 b,vec2 p){
        float h=foilHeight(p),epsilon=.0025;
        vec2 gradient=vec2(foilHeight(p+vec2(epsilon,0.))-h,foilHeight(p+vec2(0.,epsilon))-h)/epsilon;
        return normalize(n-t*gradient.x*.62-b*gradient.y*.62);
      }
      vec3 reflectedSky(vec3 r,float roughness){
        vec3 sun=normalize(vec3(-.45,-.62,.64));
        vec3 fill=normalize(vec3(.8,.2,.35));
        float soft=pow(max(dot(r,sun),0.),mix(26.,3.5,roughness));
        float rim=pow(max(dot(r,fill),0.),mix(35.,5.,roughness));
        float horizon=pow(max(0.,1.-abs(r.y+.15)),8.);
        return vec3(.012,.02,.033)+vec3(.55,.63,.74)*soft
          +vec3(.075,.14,.23)*rim+vec3(.02,.035,.055)*horizon;
      }
      vec3 toneMap(vec3 value){
        value=max(value,vec3(0.));
        value=(value*(2.51*value+.03))/(value*(2.43*value+.59)+.14);
        return pow(clamp(value,0.,1.),vec3(1./2.2));
      }
      float crater(vec3 p,vec3 at,float radius){
        float d=length(p-normalize(at))/radius;
        return exp(-pow((d-1.)*7.,2.))*.11-(1.-smoothstep(.15,.94,d))*.095;
      }
      void main(){
        float material=vSurface.x,emission=vSurface.y,opacity=vSurface.z;
        if(material>7.5){
          gl_FragColor=vec4(vColor*mix(.48,.94,night)*opacity,opacity);return;
        }
        vec3 n=normalize(vNormal),view=normalize(vView);
        if(!gl_FrontFacing)n=-n;
        vec3 tangent=normalize(vTangent.xyz-n*dot(n,vTangent.xyz));
        vec3 bitangent=normalize(cross(n,tangent))*vTangent.w;
        vec3 albedo=pow(vColor,vec3(2.2));
        float roughness=.32,metallic=.82;
        vec3 seed=bodyCenter*vec3(17.3,9.7,13.1)*isBody;
        vec3 p=vPoint+seed;
        float micro=noise(p*190.+3.1);
        if(material<.5){
          float brushed=noise(vec3(vUV*vec2(780.,9.),2.8));
          albedo*=.82+brushed*.26;
          roughness=.25+brushed*.12;
          n=normalize(n+tangent*(brushed-.5)*.035+bitangent*(micro-.5)*.018);
        }else if(material<1.5){
          n=foilNormal(n,tangent,bitangent,vUV);
          float creases=noise(vec3(vUV*37.,7.4));
          albedo=mix(albedo,vec3(.58,.31,.065),.55)*(.70+creases*.55);
          roughness=.19+noise(vec3(vUV*83.,12.))* .26;metallic=.98;
        }else if(material<2.5){
          vec2 cell=vUV*vec2(12.,6.);
          float variation=noise(vec3(floor(cell)*3.7,8.));
          float border=max(line(cell.x,.028),line(cell.y,.028));
          vec2 corner=abs(fract(cell)-.5);
          border=max(border,smoothstep(.90,.95,corner.x+corner.y));
          float fingers=line(cell.y*18.,.025)*.18;
          float bars=line(cell.x*3.,.026)*.55;
          vec3 silicon=mix(vec3(.012,.028,.080),vec3(.012,.062,.104),variation);
          silicon=mix(silicon,vec3(.055,.032,.091),noise(vec3(floor(cell),19.))*.32);
          albedo=mix(silicon,vec3(.008,.012,.017),border);
          albedo=mix(albedo,vec3(.31,.34,.36),max(fingers,bars)*(1.-border));
          roughness=mix(.16,.32,border);metallic=.46+bars*.35;
          // A thin glass coating changes hue at grazing angles without flooding the cells.
          float coating=pow(1.-max(dot(n,view),0.),3.);
          albedo+=vec3(.009,.017,.024)*coating;
        }else if(material<3.5){
          albedo*=.90+micro*.13;roughness=.56;metallic=.025;
        }else if(material<4.5){
          float weave=sin(vUV.x*730.)*sin(vUV.y*730.);
          albedo=mix(albedo,vec3(.012,.016,.020),.7)*(.88+weave*.1);
          roughness=.41+micro*.15;metallic=.22;
        }else if(material<5.5){
          float terrain=fbm(p*6.3),detail=fbm(p*38.);
          float impacts=crater(vPoint,vec3(.8,-.1,.55),.23)
            +crater(vPoint,vec3(-.3,-.8,.5),.13)+crater(vPoint,vec3(.22,.6,.76),.10)
            +crater(vPoint,vec3(-.7,.25,-.5),.18)+crater(vPoint,vec3(.2,-.45,-.8),.11);
          albedo*=.48+terrain*.66+detail*.2+impacts*1.6;
          albedo=mix(albedo,albedo*vec3(1.09,1.01,.92),smoothstep(.45,.7,terrain));
          n=normalize(n+tangent*(noise(p*47.+2.)-.5)*.065+bitangent*(detail-.5)*.1);
          roughness=.83;metallic=.015;
        }else if(material<6.5){
          float turbulence=fbm(p*8.);
          float bands=.5+.5*sin(vPoint.y*43.+turbulence*5.7);
          float wisps=fbm(p*vec3(24.,52.,24.));
          albedo*=.53+bands*.52+wisps*.19;
          albedo=mix(albedo,albedo*vec3(1.18,1.03,.80),bands*.34);
          roughness=.67;metallic=0.;
        }else{
          float granules=fbm(p*37.),fine=noise(p*154.);
          float limb=.38+.62*sqrt(max(dot(n,view),0.));
          vec3 stellar=albedo*(.86+granules*.78+fine*.13);
          stellar=mix(stellar,vec3(1.18,1.11,.97),.3)*limb;
          gl_FragColor=vec4(toneMap(stellar*(1.35+emission)),1.);return;
        }
        vec3 light=normalize(vec3(-.45,-.62,.64));
        vec3 halfVector=normalize(light+view);
        float nl=max(dot(n,light),0.),nv=max(dot(n,view),.001);
        float nh=max(dot(n,halfVector),0.),vh=max(dot(view,halfVector),0.);
        float a=roughness*roughness,a2=a*a;
        float d=a2/(PI*pow(nh*nh*(a2-1.)+1.,2.));
        float k=pow(roughness+1.,2.)/8.;
        float visibility=nl/(nl*(1.-k)+k)*nv/(nv*(1.-k)+k);
        vec3 f0=mix(vec3(.045),albedo,metallic);
        vec3 fresnel=f0+(1.-f0)*pow(1.-vh,5.);
        vec3 specular=d*visibility*fresnel/max(.004,4.*nl*nv);
        vec3 diffuse=(1.-fresnel)*(1.-metallic)*albedo/PI;
        vec3 direct=(diffuse+specular)*nl*vec3(3.0,2.92,2.74);
        vec3 ambient=albedo*(.045+.045*max(n.y*-1.,0.))*(1.-metallic*.7);
        vec3 reflection=reflectedSky(reflect(-view,n),roughness);
        vec3 environment=reflection*(f0+(1.-f0)*pow(1.-nv,5.))*(1.15-roughness*.45);
        float rim=pow(1.-nv,3.)*max(0.,dot(n,normalize(vec3(.75,.1,-.4))));
        float hardware=1.-step(1.5,material);
        vec3 fill=albedo*hardware*(.055+.075*max(0.,dot(n,normalize(vec3(.45,-.2,.75)))));
        vec3 result=direct+ambient+environment*(1.+hardware*.35)+fill+vec3(.065,.105,.17)*rim+albedo*emission*.43;
        gl_FragColor=vec4(toneMap(result),1.);
      }`,
    ];
    const shaders = [];
    for (let i = 0; i < sources.length; i += 1) {
      const shader = gl.createShader(i ? gl.FRAGMENT_SHADER : gl.VERTEX_SHADER);
      if (!shader) { shaders.forEach(value => gl.deleteShader(value)); dispose(); return null; }
      gl.shaderSource(shader, sources[i]);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader); shaders.forEach(value => gl.deleteShader(value)); dispose(); return null;
      }
      shaders.push(shader);
    }
    program = gl.createProgram();
    if (!program) { shaders.forEach(value => gl.deleteShader(value)); dispose(); return null; }
    shaders.forEach(shader => gl.attachShader(program, shader));
    gl.linkProgram(program);
    shaders.forEach(shader => gl.deleteShader(shader));
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { dispose(); return null; }

    const uniforms = Object.fromEntries([
      "eye", "right", "down", "forward", "landmark", "radius", "nearPlane", "projection", "night", "grain",
      "isBody", "bodyCenter", "bodyColor", "bodyRadius", "bodyMaterial", "bodyEmission",
    ].map(name => [name, gl.getUniformLocation(program, name)]));
    const attributes = [
      ["position", 3, 0], ["normal", 3, 3], ["uv", 2, 6], ["color", 3, 8], ["tangent", 4, 11], ["surface", 3, 15],
    ].map(([name, size, offset]) => ({ index: gl.getAttribLocation(program, name), size, offset }));

    noiseTexture = gl.createTexture();
    if (!noiseTexture) { dispose(); return null; }
    const noise = new Uint8Array(256 * 256 * 4);
    let seed = 1987345621;
    for (let i = 0; i < noise.length; i += 4) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      noise[i] = noise[i + 1] = noise[i + 2] = seed & 255; noise[i + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, noise);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    const makeBuffer = (values, target = gl.ARRAY_BUFFER) => {
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error("Unable to allocate navigation geometry");
      buffers.add(buffer);
      gl.bindBuffer(target, buffer);
      gl.bufferData(target, target === gl.ARRAY_BUFFER ? new Float32Array(values) : new Uint16Array(values), gl.STATIC_DRAW);
      return buffer;
    };
    const pushVertex = (values, p, n, uv, color, tangent, surface) => values.push(
      p.x, p.y, p.z, n.x, n.y, n.z, uv.x, uv.y, ...color, tangent.x, tangent.y, tangent.z, tangent.w, ...surface,
    );
    const sphereVertices = [], sphereIndices = [];
    const columns = 64, rows = 40;
    for (let row = 0; row <= rows; row += 1) {
      const latitude = Math.PI * row / rows;
      for (let column = 0; column <= columns; column += 1) {
        const longitude = Math.PI * 2 * column / columns;
        const p = { x: Math.sin(latitude) * Math.cos(longitude), y: Math.cos(latitude), z: Math.sin(latitude) * Math.sin(longitude) };
        pushVertex(sphereVertices, p, p, { x: column / columns, y: row / rows }, [1, 1, 1],
          { x: -Math.sin(longitude), y: 0, z: Math.cos(longitude), w: -1 }, [5, 0, 1]);
        if (row < rows && column < columns) {
          const a = row * (columns + 1) + column, b = a + 1, d = a + columns + 1;
          sphereIndices.push(a, b, d, b, d + 1, d);
        }
      }
    }
    let sphere, sphereIndex;
    try { sphere = makeBuffer(sphereVertices); sphereIndex = makeBuffer(sphereIndices, gl.ELEMENT_ARRAY_BUFFER); }
    catch { dispose(); return null; }

    const compileGeometry = geometry => {
      if (cache.has(geometry)) return cache.get(geometry);
      const front = [], both = [], segments = [];
      for (const face of geometry.faces || []) {
        const points = face.points;
        if (!Array.isArray(points) || points.length < 3 || !points.every(finitePoint)) continue;
        const sum = { x: 0, y: 0, z: 0 };
        points.forEach((p, i) => {
          const q = points[(i + 1) % points.length];
          sum.x += (p.y - q.y) * (p.z + q.z);
          sum.y += (p.z - q.z) * (p.x + q.x);
          sum.z += (p.x - q.x) * (p.y + q.y);
        });
        if (Math.hypot(sum.x, sum.y, sum.z) < 1e-8) continue;
        const normal = normalized(sum);
        let coordinates = face.uv;
        if (!Array.isArray(coordinates) || coordinates.length !== points.length
          || !coordinates.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))) {
          const tangent = normalized(sub(points[1], points[0]));
          const bitangent = normalized(cross(normal, tangent));
          const projected = points.map(p => ({ x: dot(p, tangent), y: dot(p, bitangent) }));
          const minX = Math.min(...projected.map(p => p.x)), maxX = Math.max(...projected.map(p => p.x));
          const minY = Math.min(...projected.map(p => p.y)), maxY = Math.max(...projected.map(p => p.y));
          coordinates = projected.map(p => ({ x: (p.x - minX) / Math.max(1e-6, maxX - minX), y: (p.y - minY) / Math.max(1e-6, maxY - minY) }));
        }
        const normals = face.normals?.length === points.length && face.normals.every(finitePoint)
          ? face.normals.map(normalized) : points.map(() => normal);
        const target = face.doubleSided ? both : front, color = rgb(face.color);
        const surface = [MATERIALS[face.material] ?? MATERIALS.metal, 0, 1];
        for (let i = 1; i < points.length - 1; i += 1) {
          const indices = [0, i, i + 1], [a, b, c] = indices.map(index => points[index]);
          const [uvA, uvB, uvC] = indices.map(index => coordinates[index]);
          const edgeA = sub(b, a), edgeB = sub(c, a);
          const s1 = uvB.x - uvA.x, s2 = uvC.x - uvA.x, t1 = uvB.y - uvA.y, t2 = uvC.y - uvA.y;
          const determinant = s1 * t2 - s2 * t1;
          const reciprocal = Math.abs(determinant) > 1e-8 ? 1 / determinant : 0;
          const tangent = reciprocal ? normalized({ x: (edgeA.x * t2 - edgeB.x * t1) * reciprocal,
            y: (edgeA.y * t2 - edgeB.y * t1) * reciprocal, z: (edgeA.z * t2 - edgeB.z * t1) * reciprocal }) : normalized(edgeA);
          const bitangent = reciprocal ? normalized({ x: (edgeB.x * s1 - edgeA.x * s2) * reciprocal,
            y: (edgeB.y * s1 - edgeA.y * s2) * reciprocal, z: (edgeB.z * s1 - edgeA.z * s2) * reciprocal }) : cross(normal, tangent);
          indices.forEach(index => pushVertex(target, points[index], normals[index], coordinates[index], color,
            { ...tangent, w: dot(cross(normals[index], tangent), bitangent) < 0 ? -1 : 1 }, surface));
        }
      }
      for (const segment of geometry.segments || []) {
        if (!finitePoint(segment.a) || !finitePoint(segment.b)) continue;
        const color = rgb(segment.color), alpha = clamp(Number.isFinite(segment.alpha) ? segment.alpha : .5);
        for (const p of [segment.a, segment.b]) pushVertex(segments, p, { x: 0, y: 0, z: 1 }, { x: 0, y: 0 },
          color, { x: 1, y: 0, z: 0, w: 1 }, [8, 0, alpha]);
      }
      const batches = [front, both, segments].map(values => ({ buffer: values.length ? makeBuffer(values) : null, count: values.length / STRIDE }));
      const bodies = (geometry.bodies || []).filter(body => finitePoint(body.at) && Number.isFinite(body.r) && body.r > 0).map(body => ({
        ...body, color: rgb(body.color), emission: clamp(Number.isFinite(body.emission) ? body.emission : 0, 0, 4),
        material: MATERIALS[body.material] ?? (body.emission > .8 ? MATERIALS.star : MATERIALS.rock),
      }));
      const compiled = { batches, bodies };
      cache.set(geometry, compiled);
      return compiled;
    };
    const bind = buffer => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (const { index, size, offset } of attributes) {
        if (index < 0) continue;
        gl.enableVertexAttribArray(index);
        gl.vertexAttribPointer(index, size, gl.FLOAT, false, STRIDE * 4, offset * 4);
      }
    };
    const vector = (name, p) => gl.uniform3f(uniforms[name], p.x, p.y, p.z);
    const maxExtent = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);

    return {
      draw({ geometry, frame, landmark, viewport, crop, near, night = 1 }) {
        if (disposed || lost || gl.isContextLost() || !geometry || typeof geometry !== "object"
          || !frame || ![frame.eye, frame.right, frame.down, frame.forward, landmark].every(finitePoint)
          || !(landmark.r > 0) || !Number.isFinite(landmark.r) || !Number.isFinite(near) || near <= 0
          || !viewport || ![viewport.w, viewport.h].every(value => Number.isFinite(value) && value > 0)
          || !crop || ![crop.left, crop.top, crop.width, crop.height].every(Number.isFinite) || crop.width <= 0 || crop.height <= 0) return false;
        let compiled;
        try { compiled = compileGeometry(geometry); } catch { dispose(); return false; }
        const ratio = Math.min(1.5, window.devicePixelRatio || 1, Math.sqrt(300000 / (crop.width * crop.height)),
          maxExtent / crop.width, maxExtent / crop.height);
        const width = Math.max(1, Math.floor(crop.width * ratio)), height = Math.max(1, Math.floor(crop.height * ratio));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        gl.viewport(0, 0, width, height);
        gl.disable(gl.SCISSOR_TEST);
        gl.colorMask(true, true, true, true);
        gl.depthMask(true);
        gl.clearColor(0, 0, 0, 0);
        gl.clearDepth(1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
        gl.uniform1i(uniforms.grain, 0);
        for (const name of ["eye", "right", "down", "forward"]) vector(name, frame[name]);
        vector("landmark", landmark);
        gl.uniform1f(uniforms.radius, landmark.r);
        gl.uniform1f(uniforms.nearPlane, near);
        gl.uniform1f(uniforms.night, Number.isFinite(night) ? clamp(night) : 1);
        const base = Math.max(viewport.w, viewport.h);
        gl.uniform4f(uniforms.projection, 2 * base / crop.width, -2 * base / crop.height,
          (viewport.w - 2 * crop.left - crop.width) / crop.width, (2 * crop.top + crop.height - viewport.h) / crop.height);
        gl.uniform1f(uniforms.isBody, 0);
        gl.uniform3f(uniforms.bodyCenter, 0, 0, 0);
        gl.uniform3f(uniforms.bodyColor, 1, 1, 1);
        gl.uniform1f(uniforms.bodyRadius, 1);
        gl.uniform1f(uniforms.bodyMaterial, MATERIALS.rock);
        gl.uniform1f(uniforms.bodyEmission, 0);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.disable(gl.BLEND);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
        gl.frontFace(gl.CW);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1, 1);
        compiled.batches.slice(0, 2).forEach((batch, index) => {
          if (!batch.count) return;
          if (index) gl.disable(gl.CULL_FACE);
          bind(batch.buffer);
          gl.drawArrays(gl.TRIANGLES, 0, batch.count);
        });
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.enable(gl.CULL_FACE);
        if (compiled.bodies.length) {
          bind(sphere);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphereIndex);
          gl.uniform1f(uniforms.isBody, 1);
          for (const body of compiled.bodies) {
            vector("bodyCenter", body.at);
            gl.uniform3fv(uniforms.bodyColor, body.color);
            gl.uniform1f(uniforms.bodyRadius, body.r);
            gl.uniform1f(uniforms.bodyMaterial, body.material);
            gl.uniform1f(uniforms.bodyEmission, body.emission);
            gl.drawElements(gl.TRIANGLES, sphereIndices.length, gl.UNSIGNED_SHORT, 0);
          }
        }
        const lines = compiled.batches[2];
        if (lines.count) {
          gl.uniform1f(uniforms.isBody, 0);
          gl.uniform3f(uniforms.bodyCenter, 0, 0, 0);
          gl.depthMask(false);
          gl.enable(gl.BLEND);
          gl.blendEquation(gl.FUNC_ADD);
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.lineWidth(1);
          bind(lines.buffer);
          gl.drawArrays(gl.LINES, 0, lines.count);
        }
        gl.depthMask(true);
        return !gl.isContextLost();
      },
      dispose,
    };
  };
})();

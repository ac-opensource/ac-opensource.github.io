(() => {
  "use strict";
  window.createAboutButterflyField = canvas => {
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false, depth: false, premultipliedAlpha: true });
    if (!gl) return null;
    let lost = false, disposed = false;
    const onLost = event => { event.preventDefault(); lost = true; };
    canvas.addEventListener("webglcontextlost", onLost);
    const sources = [
      "attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}",
      `precision highp float;
      uniform vec2 extent,resolution,center;
      uniform float scale,lightTheme;
      uniform mat3 axes;
      uniform sampler2D noiseTexture;
      float noise(vec3 p){
        vec3 cell=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        vec2 uv=(cell.xy+cell.z*vec2(37.,17.)+f.xy+.5)/256.;
        return mix(texture2D(noiseTexture,uv).r,texture2D(noiseTexture,uv+vec2(37.,17.)/256.).r,f.z);
      }
      float fbm(vec3 p){return noise(p)*.56+noise(p*2.03+9.1)*.29+noise(p*4.09+17.7)*.15;}
      void main(){
        vec2 pixel=gl_FragCoord.xy/resolution*extent;
        vec3 view=normalize(vec3((pixel.x-center.x)/scale,(pixel.y-extent.y+center.y)/scale,-12.5));
        vec3 eye=vec3(axes[0].z,axes[1].z,axes[2].z)*12.5;
        vec3 ray=vec3(dot(axes[0],view),dot(axes[1],view),dot(axes[2],view));
        float b=dot(eye,ray),c=dot(eye,eye)-196.;
        float discriminant=b*b-c;
        if(discriminant<0.){gl_FragColor=vec4(0);return;}
        float start=max(0.,-b-sqrt(discriminant)),end=-b+sqrt(discriminant);
        float stride=(end-start)/84.;
        float distance=start+stride*.5;
        vec3 accumulated=vec3(0);float opacity=0.;
        for(int i=0;i<84;i++){
          vec3 p=eye+ray*distance;
          float axial=dot(p.xy,vec2(.681,.732));
          vec3 q=vec3(dot(p.xy,vec2(-.732,.681)),p.z,axial);
          float a=abs(axial),t=a/10.2;
          float angle=atan(q.y,q.x);
          float radius=length(q.xy);
          // An unequal pair of rounded bipolar lobes, enclosing a luminous waist.
          float swell=pow(min(t,1.),.78);
          float profile=.55+7.8*swell*(.88+.12*sin(axial*.7));
          profile*=1.+.14*sin(angle*3.+axial*.45)+.08*cos(angle*5.-axial*.31);
          float cap=1.-smoothstep(6.8+noise(q*.7)*1.8,10.4,a);
          if(radius<profile+1.4&&cap>0.){
            vec3 flow=q*vec3(.7,.7,.38);
            float coarse=fbm(flow);
            float fine=fbm(q*2.1+coarse*2.5);
            float ridge=1.-abs(fine*2.-1.);
            float boundary=radius-profile+(coarse-.5)*2.6;
            float shell=exp(-abs(boundary)*5.2);
            float strings=pow(max(0.,.5+.5*sin(angle*17.+axial*1.15+(coarse-.5)*8.)),8.);
            float lace=pow(ridge,5.)*(.2+strings*1.6);
            float cavity=1.-smoothstep(-.85,.05,boundary);
            float internal=exp(-abs(fine-.51)*23.)*cavity;
            float diffuse=cavity*(.025+.17*coarse)*(.3+.7*fine)+internal*.19;
            float skin=shell*(.1+lace*1.1);
            float core=exp(-dot(q*vec3(.9,.9,.48),q*vec3(.9,.9,.48))*1.4);
            float density=(diffuse+skin+core*.78)*cap;
            float absorption=1.-exp(-density*stride*1.5);
            vec3 blue=mix(vec3(.08,.18,.40),vec3(.22,.72,.94),fine);
            blue=mix(blue,vec3(.43,.23,.62),smoothstep(.48,.78,coarse)*.38);
            vec3 gold=mix(vec3(.74,.14,.035),vec3(1.52,.85,.28),ridge);
            vec3 color=mix(blue,gold,clamp(shell*.92+strings*shell*.25+internal*.32,0.,1.));
            color+=vec3(.47,.68,.88)*core*1.4;
            color*=.78+fine*.8+strings*shell*.42;
            color=mix(color,color*vec3(.84,.86,.88),lightTheme);
            accumulated+=(1.-opacity)*color*absorption;
            opacity+=(1.-opacity)*absorption;
            if(opacity>.987)break;
          }
          distance+=stride;
        }
        gl_FragColor=vec4(accumulated,opacity);
      }`
    ];
    const shaders=[];
    for(let i=0;i<2;i++){
      const shader=gl.createShader(i?gl.FRAGMENT_SHADER:gl.VERTEX_SHADER);
      if(!shader){shaders.forEach(value=>gl.deleteShader(value));canvas.removeEventListener("webglcontextlost",onLost);return null;}
      gl.shaderSource(shader,sources[i]);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){gl.deleteShader(shader);shaders.forEach(value=>gl.deleteShader(value));canvas.removeEventListener("webglcontextlost",onLost);return null;}
      shaders.push(shader);
    }
    const program=gl.createProgram();
    if(!program){shaders.forEach(value=>gl.deleteShader(value));canvas.removeEventListener("webglcontextlost",onLost);return null;}
    shaders.forEach(value=>gl.attachShader(program,value));gl.linkProgram(program);shaders.forEach(value=>gl.deleteShader(value));
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)){gl.deleteProgram(program);canvas.removeEventListener("webglcontextlost",onLost);return null;}
    const buffer=gl.createBuffer();
    if(!buffer){gl.deleteProgram(program);canvas.removeEventListener("webglcontextlost",onLost);return null;}
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const noiseTexture=gl.createTexture();
    if(!noiseTexture){gl.deleteBuffer(buffer);gl.deleteProgram(program);canvas.removeEventListener("webglcontextlost",onLost);return null;}
    const lattice=new Uint8Array(256*256*4);let seed=19471;
    for(let i=0;i<lattice.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const value=seed>>>24;lattice[i]=value;lattice[i+1]=value;lattice[i+2]=value;lattice[i+3]=255;}
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,noiseTexture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,256,0,gl.RGBA,gl.UNSIGNED_BYTE,lattice);
    const position=gl.getAttribLocation(program,"position");
    const uniforms=Object.fromEntries(["extent","resolution","center","scale","axes","lightTheme","noiseTexture"].map(name=>[name,gl.getUniformLocation(program,name)]));
    canvas.dataset.particleCount="0";canvas.dataset.renderer="raymarched-volume";
    return {
      draw({width,height,centerX,centerY,baseScale,axes,lightTheme}){
        if(disposed||lost||gl.isContextLost()||!(width>0&&height>0&&baseScale>0))return false;
        const ratio=Math.min(window.devicePixelRatio||1,Math.sqrt(250000/(width*height)));
        const w=Math.max(1,Math.floor(width*ratio)),h=Math.max(1,Math.floor(height*ratio));
        if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
        gl.viewport(0,0,w,h);gl.useProgram(program);gl.disable(gl.BLEND);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,noiseTexture);gl.uniform1i(uniforms.noiseTexture,0);
        gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
        gl.uniform2f(uniforms.extent,width,height);gl.uniform2f(uniforms.resolution,w,h);gl.uniform2f(uniforms.center,centerX,centerY);
        gl.uniform1f(uniforms.scale,baseScale);gl.uniform1f(uniforms.lightTheme,lightTheme?1:0);gl.uniformMatrix3fv(uniforms.axes,false,axes);
        gl.drawArrays(gl.TRIANGLES,0,6);return !gl.isContextLost();
      },
      dispose(){disposed=true;canvas.removeEventListener("webglcontextlost",onLost);gl.deleteTexture(noiseTexture);gl.deleteBuffer(buffer);gl.deleteProgram(program);}
    };
  };
})();

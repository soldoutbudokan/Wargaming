/* Field Command — dependency-free, instanced-by-regiment battlefield renderer. */
(function () {
  'use strict';

  const WORLD_W = 1800;
  const WORLD_H = 1200;
  const COLORS = ['#23625a', '#a34735'];
  const GL_COLORS = [[0.12, 0.35, 0.31], [0.62, 0.23, 0.16]];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function random(seed) {
    return function () {
      seed |= 0;
      seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function roundedRect(ctx, x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  class BattleRenderer {
    constructor(container) {
      this.container = container;
      this.view = { cx: 900, cy: 600, zoom: 1 };
      this.width = 1;
      this.height = 1;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.formations = [];
      this.batches = new Map();
      this.stats = { renderer: 'Canvas', drawnSoldiers: 0 };
      this.scenario = {};
      this.layers = [];
      if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
      container.style.overflow = 'hidden';
      this.terrainCanvas = this.createCanvas('battle-terrain');
      this.troopCanvas = this.createCanvas('battle-troops');
      this.overlayCanvas = this.createCanvas('battle-overlay');
      this.terrainContext = this.terrainCanvas.getContext('2d', { alpha: false });
      this.overlayContext = this.overlayCanvas.getContext('2d');
      this.mapCanvas = document.createElement('canvas');
      this.mapCanvas.width = WORLD_W * 2;
      this.mapCanvas.height = WORLD_H * 2;
      this.scarCanvas = document.createElement('canvas');
      this.scarCanvas.width = WORLD_W;
      this.scarCanvas.height = WORLD_H;
      this.previousCounts = new Map();
      this.lastRenderTime = 0;
      this.spriteCache = new Map();
      this.setupGL();
      this.resize();
      this.setScenario({ id: 'cannae' });
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(container);
      }
    }

    createCanvas(className) {
      const canvas = document.createElement('canvas');
      canvas.className = className;
      canvas.setAttribute('aria-hidden', 'true');
      Object.assign(canvas.style, {
        position: 'absolute', inset: '0', width: '100%', height: '100%',
        pointerEvents: 'none', display: 'block'
      });
      this.container.appendChild(canvas);
      this.layers.push(canvas);
      return canvas;
    }

    setupGL() {
      try {
        const gl = this.troopCanvas.getContext('webgl', {
          alpha: true, antialias: false, premultipliedAlpha: true,
          depth: false, stencil: false, preserveDrawingBuffer: false
        });
        if (!gl) throw new Error('WebGL unavailable');
        const vertex = `
          precision highp float;
          attribute vec2 a_offset;
          uniform vec2 u_position;
          uniform vec2 u_extent;
          uniform vec2 u_camera;
          uniform vec2 u_resolution;
          uniform mediump vec2 u_rotation;
          uniform float u_scale;
          uniform float u_size;
          uniform float u_time;
          uniform float u_moving;
          uniform float u_disorder;
          varying mediump float v_shade;
          void main() {
            vec2 p = a_offset * u_extent;
            p += vec2(sin(a_offset.x * 390.0 + u_time * 7.0),
                      cos(a_offset.y * 350.0 + u_time * 7.0)) * u_moving * .24;
            p += vec2(sin(a_offset.y * 593.0), cos(a_offset.x * 337.0))
                 * u_extent * u_disorder * .07;
            vec2 rotated = vec2(p.x * u_rotation.x - p.y * u_rotation.y,
                                p.x * u_rotation.y + p.y * u_rotation.x);
            vec2 screen = (u_position + rotated - u_camera) * u_scale;
            gl_Position = vec4(screen.x * 2.0 / u_resolution.x,
                              -screen.y * 2.0 / u_resolution.y, 0.0, 1.0);
            gl_PointSize = u_size;
            v_shade = .82 + fract(a_offset.x * 179.0 + a_offset.y * 293.0) * .28;
          }
        `;
        const fragment = `
          precision mediump float;
          uniform vec3 u_color;
          uniform mediump vec2 u_rotation;
          uniform float u_kind;
          uniform float u_detail;
          varying mediump float v_shade;
          float oval(vec2 p, vec2 r) {
            return 1.0 - smoothstep(.87, 1.0, length(p / r));
          }
          float box(vec2 p, vec2 r) {
            vec2 d = abs(p) - r;
            return 1.0 - smoothstep(-.018, .018, max(d.x, d.y));
          }
          void main() {
            vec2 p = (gl_PointCoord - vec2(.5)) * 2.0;
            if (u_detail < .5) {
              float d = length(p / vec2(.74, 1.0));
              if (d > 1.0) discard;
              float a = 1.0 - smoothstep(.72, 1.0, d);
              gl_FragColor = vec4(u_color * v_shade * a, a);
              return;
            }
            vec2 q = vec2(p.x * u_rotation.x + p.y * u_rotation.y,
                         -p.x * u_rotation.y + p.y * u_rotation.x);
            vec3 color = vec3(.17, .16, .12);
            float a = oval(q - vec2(.08,.19), vec2(.43,.62)) * .25;
            float body = oval(q - vec2(0.0,.1), vec2(.22,.35));
            float head = oval(q - vec2(0.0,-.22), vec2(.20,.18));
            float shield = oval(q - vec2(-.25,.08), vec2(.20,.28));
            float weapon = box(q - vec2(.31,-.11), vec2(.027,.74));
            float boots = max(oval(q - vec2(-.12,.49),vec2(.08,.18)),
                              oval(q - vec2(.12,.49),vec2(.08,.18)));
            if (u_kind > .5 && u_kind < 1.5) {
              float horse = oval(q - vec2(0.0,.12),vec2(.31,.57));
              horse = max(horse, oval(q - vec2(0.0,-.49),vec2(.16,.27)));
              horse = max(horse, box(q - vec2(-.29,.19),vec2(.07,.31)));
              horse = max(horse, box(q - vec2(.29,.19),vec2(.07,.31)));
              color = mix(color,vec3(.31,.23,.15) * v_shade,horse);
              a = max(a, horse);
              body = oval(q - vec2(0.0,.09),vec2(.2,.23));
              head = oval(q - vec2(0.0,-.14),vec2(.15,.14));
              shield *= .7;
              boots = 0.0;
            } else if (u_kind > 1.5 && u_kind < 2.5) {
              float bow = length((q-vec2(.12,-.05))/vec2(.34,.61));
              weapon = (1.0-smoothstep(.06,.13,abs(bow-1.0))) * step(.12,q.x);
              weapon = max(weapon,box(q-vec2(.13,-.05),vec2(.018,.57)));
              shield = 0.0;
            } else if (u_kind > 2.5 && u_kind < 3.5) {
              weapon = box(q-vec2(.26,-.13),vec2(.038,.70));
              shield = 0.0;
            } else if (u_kind > 3.5 && u_kind < 4.5) {
              float wheels = max(oval(q-vec2(-.38,.08),vec2(.13,.34)),
                                 oval(q-vec2(.38,.08),vec2(.13,.34)));
              float carriage = box(q-vec2(0.0,.21),vec2(.29,.27));
              float barrel = box(q-vec2(0.0,-.17),vec2(.13,.62));
              color = mix(color,vec3(.26,.21,.14),carriage);
              color = mix(color,vec3(.13,.15,.13),max(wheels,barrel));
              a = max(a,max(carriage,max(wheels,barrel)));
              float glint=box(q-vec2(-.04,-.25),vec2(.025,.48));
              color=mix(color,vec3(.48,.48,.35),glint);
              if(a<.01)discard;
              gl_FragColor=vec4(color*a,a);
              return;
            } else if (u_kind > 4.5) {
              weapon = 0.0;
              shield = 0.0;
            }
            color = mix(color,vec3(.13,.14,.11),boots); a=max(a,boots);
            color = mix(color,u_color*v_shade,body); a=max(a,body);
            color = mix(color,vec3(.38,.26,.14),weapon); a=max(a,weapon);
            vec3 shieldColor = mix(u_color,vec3(.38,.29,.17),.30);
            color = mix(color,shieldColor,shield); a=max(a,shield);
            float shieldBoss=oval(q-vec2(-.25,.04),vec2(.07,.09))*step(.1,shield);
            color=mix(color,vec3(.66,.59,.39),shieldBoss);
            vec3 helmet = u_kind > 2.5 ? vec3(.19,.21,.18) : vec3(.60,.56,.43);
            helmet *= .83 + .25 * clamp(-q.x-q.y,0.0,1.0);
            color=mix(color,helmet,head); a=max(a,head);
            if(a<.01)discard;
            gl_FragColor=vec4(color*a,a);
          }
        `;
        const compile = (source, type) => {
          const shader = gl.createShader(type);
          gl.shaderSource(shader, source);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const error = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(error);
          }
          return shader;
        };
        const vs = compile(vertex, gl.VERTEX_SHADER);
        const fs = compile(fragment, gl.FRAGMENT_SHADER);
        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('WebGL program unavailable');
        this.gl = gl;
        this.program = program;
        this.buffer = gl.createBuffer();
        this.uniforms = {};
        for (const name of ['position', 'extent', 'camera', 'resolution', 'rotation', 'scale', 'size', 'time', 'moving', 'color', 'kind', 'detail', 'disorder']) {
          this.uniforms[name] = gl.getUniformLocation(program, 'u_' + name);
        }
        this.offsetLocation = gl.getAttribLocation(program, 'a_offset');
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        this.stats.renderer = 'WebGL';
        this.troopCanvas.addEventListener('webglcontextlost', event => {
          event.preventDefault();
          this.contextLost = true;
        });
        this.troopCanvas.addEventListener('webglcontextrestored', () => {
          this.contextLost = false;
          this.setupGL();
          this.setFormations(this.formations);
        });
      } catch (_) {
        // A context of another type cannot be acquired after a failed WebGL setup.
        const replacement = document.createElement('canvas');
        replacement.className = this.troopCanvas.className;
        replacement.style.cssText = this.troopCanvas.style.cssText;
        replacement.setAttribute('aria-hidden', 'true');
        this.troopCanvas.replaceWith(replacement);
        this.layers[1] = replacement;
        this.troopCanvas = replacement;
        this.gl = null;
        this.troopContext = replacement.getContext('2d');
        this.stats.renderer = 'Canvas';
      }
    }

    resize() {
      const rect = this.container.getBoundingClientRect();
      this.width = Math.max(1, rect.width);
      this.height = Math.max(1, rect.height);
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.fitScale = Math.min(this.width / WORLD_W, this.height / WORLD_H);
      for (const canvas of this.layers) {
        const w = Math.round(this.width * this.dpr);
        const h = Math.round(this.height * this.dpr);
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
      }
      if (this.gl) this.gl.viewport(0, 0, this.troopCanvas.width, this.troopCanvas.height);
    }

    get scale() { return this.fitScale * this.view.zoom; }

    screenToWorld(clientX, clientY) {
      const rect = this.container.getBoundingClientRect();
      return {
        x: (clientX - rect.left - this.width / 2) / this.scale + this.view.cx,
        y: (clientY - rect.top - this.height / 2) / this.scale + this.view.cy
      };
    }

    worldToScreen(x, y) {
      return {
        x: (x - this.view.cx) * this.scale + this.width / 2,
        y: (y - this.view.cy) * this.scale + this.height / 2
      };
    }

    zoomAt(clientX, clientY, factor) {
      const before = this.screenToWorld(clientX, clientY);
      this.view.zoom = clamp(this.view.zoom * factor, .65, 12);
      const after = this.screenToWorld(clientX, clientY);
      this.view.cx += before.x - after.x;
      this.view.cy += before.y - after.y;
      this.constrainView();
    }

    pan(dx, dy) {
      this.view.cx -= dx / this.scale;
      this.view.cy -= dy / this.scale;
      this.constrainView();
    }

    constrainView() {
      this.view.cx = clamp(this.view.cx, -150, WORLD_W + 150);
      this.view.cy = clamp(this.view.cy, -150, WORLD_H + 150);
    }

    resetView() {
      this.view.cx = WORLD_W / 2;
      this.view.cy = WORLD_H / 2;
      this.view.zoom = 1;
    }

    setScenario(scenario, terrain) {
      this.scenario = scenario || {};
      this.terrain = terrain || (window.FieldTerrain ? new window.FieldTerrain(this.scenario.id || 'cannae') : null);
      this.scarCanvas.getContext('2d').clearRect(0, 0, WORLD_W, WORLD_H);
      this.previousCounts.clear();
      this.lastRenderTime = 0;
      this.drawTerrain();
      this.resetView();
    }

    setFormations(formations) {
      this.formations = formations;
      this.batches.clear();
      this.previousCounts.clear();
      let total = 0;
      for (const f of formations) total += Math.max(0, Math.floor(f.initial || f.count || 0));
      const offsets = new Float32Array(total * 2);
      let start = 0;
      for (const f of formations) {
        const count = Math.max(0, Math.floor(f.initial || f.count || 0));
        const aspect = Math.max(.15, (f.width || 100) / (f.depth || 60));
        const columns = Math.max(1, Math.ceil(Math.sqrt(count * aspect)));
        const rows = Math.max(1, Math.ceil(count / columns));
        const rng = random((Number(f.id) || start + 1) * 173 + 42);
        const points = new Float32Array(count * 2);
        for (let i = 0; i < count; i++) {
          points[i * 2] = ((i % columns) + .5 + (rng() - .5) * .15) / columns - .5;
          points[i * 2 + 1] = (Math.floor(i / columns) + .5 + (rng() - .5) * .15) / rows - .5;
        }
        // Randomize draw order once so casualties thin a formation evenly.
        for (let i = count - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          const x = points[i * 2];
          const y = points[i * 2 + 1];
          points[i * 2] = points[j * 2];
          points[i * 2 + 1] = points[j * 2 + 1];
          points[j * 2] = x;
          points[j * 2 + 1] = y;
        }
        offsets.set(points, start * 2);
        this.batches.set(f.id, { start, initial: count, points, tile: null, tileCount: -1 });
        start += count;
      }
      if (this.gl && !this.contextLost) {
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, offsets, this.gl.STATIC_DRAW);
      }
    }

    drawTerrain() {
      const ctx = this.mapCanvas.getContext('2d');
      const id = String(this.scenario.id || 'cannae').toLowerCase();
      const frost = id.includes('auster');
      const ridge = id.includes('hasting');
      this.terrainVariant = frost ? 'austerlitz' : ridge ? 'hastings' : 'cannae';
      const terrain = this.terrain || { hills: [], forests: [], waters: [], fords: [], muds: [] };
      const rng = random(frost ? 610 : ridge ? 1066 : 216);
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      ctx.clearRect(0, 0, WORLD_W, WORLD_H);
      const ground = ctx.createLinearGradient(0, 0, WORLD_W * .4, WORLD_H);
      ground.addColorStop(0, frost ? '#afb8a7' : ridge ? '#a3af81' : '#bbb98c');
      ground.addColorStop(.5, frost ? '#c0c3af' : ridge ? '#b0b88b' : '#c5ba8b');
      ground.addColorStop(1, frost ? '#bac0ab' : ridge ? '#a9b083' : '#bdb48a');
      ctx.fillStyle = ground; ctx.fillRect(0, 0, WORLD_W, WORLD_H);

      // Weathered fields and tracks are cosmetic. All impassable terrain below
      // comes directly from the same FieldTerrain instance used by the engine.
      const fieldColors = frost ? ['#b4b8a4','#aab09a','#c6c6af','#aeb8a3']
        : ridge ? ['#9aa778','#b5b88a','#a7b484','#b9b68a']
          : ['#b6b888','#c4b886','#aab07f','#c8bc91'];
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 10; col++) {
          const x = col * 205 - 90 + rng() * 55;
          const y = row * 190 - 80 + rng() * 45;
          const w = 165 + rng() * 100, h = 115 + rng() * 110;
          ctx.save(); ctx.translate(x + w/2, y + h/2); ctx.rotate((rng()-.5)*.19-.08);
          ctx.fillStyle = fieldColors[Math.floor(rng()*fieldColors.length)];
          ctx.globalAlpha = .5; ctx.fillRect(-w/2,-h/2,w,h);
          ctx.strokeStyle = '#5a6040'; ctx.globalAlpha = .1; ctx.lineWidth = .7;
          for (let stripe=-h/2+5;stripe<h/2;stripe+=5+rng()*3) {
            ctx.beginPath();ctx.moveTo(-w/2+3,stripe);ctx.lineTo(w/2-3,stripe+rng()*2);ctx.stroke();
          }
          ctx.restore();
        }
      }

      // Lit relief follows the exact elliptical elevation footprint.
      for (const hill of terrain.hills) {
        ctx.save(); ctx.translate(hill.x,hill.y);ctx.scale(hill.rx,hill.ry);
        const shade=ctx.createRadialGradient(-.29,-.32,.04,0,0,1);
        shade.addColorStop(0,'rgba(232,222,167,.29)');
        shade.addColorStop(.42,'rgba(217,211,157,.17)');
        shade.addColorStop(.73,'rgba(91,102,55,.13)');
        shade.addColorStop(1,'rgba(83,92,49,0)');
        ctx.fillStyle=shade;ctx.beginPath();ctx.arc(0,0,1,0,Math.PI*2);ctx.fill();
        ctx.restore();
        const layers=Math.max(4,Math.round(hill.height/8));
        for(let i=1;i<=layers;i++) {
          const r=Math.sqrt(1-Math.pow(i/(layers+1),2/3));
          ctx.beginPath();ctx.ellipse(hill.x,hill.y,hill.rx*r,hill.ry*r,0,0,Math.PI*2);
          ctx.strokeStyle='rgba(74,89,45,.105)';ctx.lineWidth=.8;ctx.stroke();
        }
      }

      for(const mud of terrain.muds) {
        ctx.save();ctx.translate(mud.x,mud.y);ctx.scale(mud.rx,mud.ry);
        const shade=ctx.createRadialGradient(0,0,.1,0,0,1);
        shade.addColorStop(0,'rgba(91,81,53,.32)');shade.addColorStop(.7,'rgba(104,92,57,.19)');shade.addColorStop(1,'rgba(104,92,57,.07)');
        ctx.fillStyle=shade;ctx.beginPath();ctx.arc(0,0,1,0,Math.PI*2);ctx.fill();ctx.restore();
        for(let n=0;n<150;n++) {
          const a=rng()*Math.PI*2,r=Math.sqrt(rng());
          const x=mud.x+Math.cos(a)*mud.rx*r,y=mud.y+Math.sin(a)*mud.ry*r;
          ctx.strokeStyle='rgba(78,74,52,.19)';ctx.lineWidth=.8;
          ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+3+rng()*7,y-1);ctx.stroke();
        }
      }

      for (let i=0;i<23000;i++) {
        const x=rng()*WORLD_W,y=rng()*WORLD_H;
        ctx.strokeStyle=rng()>.65?'rgba(232,223,167,.19)':'rgba(68,81,42,.12)';
        ctx.lineWidth=.4+rng()*.5;
        ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+.6+rng()*1.8,y-1-rng()*2.5);ctx.stroke();
      }

      const waterPath = water => {
        ctx.beginPath();
        if(water.kind==='pond')ctx.ellipse(water.x,water.y,water.rx,water.ry,0,0,Math.PI*2);
        else water.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
      };
      for(const water of terrain.waters) {
        ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
        waterPath(water);
        if(water.kind==='pond') {
          ctx.fillStyle='#748f87';ctx.fill();ctx.strokeStyle='rgba(70,91,56,.28)';ctx.lineWidth=8;ctx.stroke();
          waterPath(water);ctx.clip();
          const ice=ctx.createLinearGradient(water.x-water.rx,water.y-water.ry,water.x+water.rx,water.y+water.ry);
          ice.addColorStop(0,'#b6c7bc');ice.addColorStop(.55,'#94b0a8');ice.addColorStop(1,'#7d9c95');
          ctx.fillStyle=ice;ctx.fillRect(water.x-water.rx,water.y-water.ry,water.rx*2,water.ry*2);
          for(let i=0;i<42;i++) {
            const x=water.x+(rng()-.5)*water.rx*2,y=water.y+(rng()-.5)*water.ry*2;
            ctx.strokeStyle='rgba(223,232,210,.39)';ctx.lineWidth=.7;
            ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+10+rng()*24,y-5-rng()*10);ctx.lineTo(x+31,y-7);ctx.stroke();
          }
        } else {
          ctx.strokeStyle='rgba(74,97,63,.24)';ctx.lineWidth=water.width+10;ctx.stroke();
          waterPath(water);ctx.strokeStyle='#759c92';ctx.lineWidth=water.width;ctx.stroke();
          waterPath(water);ctx.strokeStyle='rgba(150,185,166,.38)';ctx.lineWidth=water.width*.51;ctx.stroke();
          // Exactly the passable circular ford / water intersection.
          for(const ford of terrain.fords) {
            ctx.save();ctx.beginPath();ctx.arc(ford.x,ford.y,ford.r,0,Math.PI*2);ctx.clip();
            waterPath(water);ctx.strokeStyle='#aab59a';ctx.lineWidth=water.width;ctx.stroke();
            ctx.strokeStyle='rgba(225,222,173,.57)';ctx.lineWidth=1.5;
            for(let i=-6;i<=6;i++){
              ctx.beginPath();ctx.moveTo(ford.x-water.width*.35,ford.y+i*10);
              ctx.lineTo(ford.x+water.width*.35,ford.y+i*10-3);ctx.stroke();
            }
            ctx.restore();
          }
          ctx.strokeStyle='rgba(206,227,202,.28)';ctx.lineWidth=.8;
          for(let i=0;i<180;i++) {
            const a=water.points[Math.floor(rng()*(water.points.length-1))];
            const index=water.points.indexOf(a),b=water.points[index+1],t=rng();
            const x=a.x+(b.x-a.x)*t+(rng()-.5)*water.width*.5,y=a.y+(b.y-a.y)*t;
            ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-1,y+6+rng()*9);ctx.stroke();
          }
        }
        ctx.restore();
      }

      for(const forest of terrain.forests) {
        ctx.save();ctx.beginPath();ctx.ellipse(forest.x,forest.y,forest.rx,forest.ry,0,0,Math.PI*2);
        ctx.fillStyle='rgba(63,82,40,.23)';ctx.fill();ctx.clip();
        const trees=[];
        for(let i=0;i<Math.round(forest.rx*forest.ry/50);i++) {
          const a=rng()*Math.PI*2,r=Math.sqrt(rng());
          trees.push({x:forest.x+Math.cos(a)*forest.rx*r,y:forest.y+Math.sin(a)*forest.ry*r,r:4+rng()*8});
        }
        trees.sort((a,b)=>a.y-b.y);
        for(const tree of trees) {
          const {x,y,r}=tree;
          ctx.fillStyle='rgba(37,57,28,.2)';ctx.beginPath();ctx.ellipse(x+5,y+6,r*1.13,r*.7,-.6,0,Math.PI*2);ctx.fill();
          const canopy=ctx.createRadialGradient(x-r*.3,y-r*.4,0,x,y,r);
          canopy.addColorStop(0,frost?'#a7b09a':'#a1ad6d');canopy.addColorStop(.44,frost?'#7d9071':'#7b9156');canopy.addColorStop(1,frost?'#526c51':'#4d6c3d');
          ctx.fillStyle=canopy;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
          ctx.strokeStyle='rgba(37,55,27,.14)';ctx.lineWidth=.8;ctx.stroke();
          if(frost){ctx.fillStyle='rgba(224,227,205,.45)';ctx.beginPath();ctx.ellipse(x-r*.2,y-r*.35,r*.58,r*.28,-.2,0,Math.PI*2);ctx.fill();}
        }
        ctx.restore();
      }

      for(const hill of terrain.hills) if(hill.height>40)this.mapLabel(ctx,hill.name.toUpperCase(),hill.x,hill.y-hill.ry*.68,13,.37);
      for(const water of terrain.waters)if(water.kind==='pond')this.mapLabel(ctx,water.name.toUpperCase(),water.x,water.y+3,10,.45);
      for(const ford of terrain.fords){
        this.mapLabel(ctx,'FORD',ford.x+73,ford.y-15,10,.55);
        ctx.strokeStyle='rgba(243,234,198,.75)';ctx.lineWidth=2;ctx.setLineDash([4,5]);
        ctx.beginPath();ctx.moveTo(ford.x-46,ford.y);ctx.lineTo(ford.x+46,ford.y);ctx.stroke();ctx.setLineDash([]);
      }
      if(id==='cannae')this.mapLabel(ctx,'APULIAN PLAIN',990,145,15,.4);
      const light=ctx.createLinearGradient(0,0,WORLD_W,WORLD_H);
      light.addColorStop(0,'rgba(250,231,165,.07)');light.addColorStop(1,'rgba(31,50,31,.10)');
      ctx.fillStyle=light;ctx.fillRect(0,0,WORLD_W,WORLD_H);
      const vignette=ctx.createRadialGradient(900,600,350,900,600,1100);
      vignette.addColorStop(0,'rgba(37,48,27,0)');vignette.addColorStop(1,'rgba(37,48,27,.19)');
      ctx.fillStyle=vignette;ctx.fillRect(0,0,WORLD_W,WORLD_H);
    }

    mapLabel(ctx, text, x, y, size, opacity) {
      ctx.save();
      ctx.fillStyle = `rgba(66,73,52,${opacity})`;
      ctx.textAlign = 'center';
      ctx.font = `${size}px Georgia, serif`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
      ctx.fillText(text, x, y);
      ctx.restore();
    }

    render(formations, selectedIds, opts) {
      opts = opts || {};
      selectedIds = selectedIds || new Set();
      if (!this.batches.size && formations.length) this.setFormations(formations);
      const scale = this.scale;
      const ctx = this.terrainContext;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = this.terrainVariant === 'austerlitz' ? '#bcbfab' : '#c3bea0';
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.setTransform(scale * this.dpr, 0, 0, scale * this.dpr,
        (this.width / 2 - this.view.cx * scale) * this.dpr,
        (this.height / 2 - this.view.cy * scale) * this.dpr);
      ctx.drawImage(this.mapCanvas, 0, 0, WORLD_W, WORLD_H);
      this.updateScars(formations, opts.time || 0);
      ctx.drawImage(this.scarCanvas, 0, 0, WORLD_W, WORLD_H);
      if (this.gl && !this.contextLost) this.drawGL(formations, opts);
      else if (this.troopContext) this.drawCanvasTroops(formations);
      this.drawOverlay(formations, selectedIds, opts);
    }

    drawGL(formations, opts) {
      const gl = this.gl;
      const u = this.uniforms;
      const scale = this.scale * this.dpr;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.enableVertexAttribArray(this.offsetLocation);
      gl.vertexAttribPointer(this.offsetLocation, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(u.camera, this.view.cx, this.view.cy);
      gl.uniform2f(u.resolution, this.troopCanvas.width, this.troopCanvas.height);
      gl.uniform1f(u.scale, scale);
      gl.uniform1f(u.time, (opts.time || 0));
      let drawn = 0;
      for (const f of formations) {
        const batch = this.batches.get(f.id);
        if (!batch) continue;
        const count = clamp(Math.floor(f.count || 0), 0, batch.initial);
        if (!count) continue;
        const width = f.width || 100;
        const depth = f.depth || 60;
        // Engine angles describe facing direction; the frontage is perpendicular.
        const angle = (f.angle || 0) + Math.PI / 2;
        gl.uniform2f(u.position, f.x, f.y);
        gl.uniform2f(u.extent, width, depth);
        gl.uniform2f(u.rotation, Math.cos(angle), Math.sin(angle));
        const color = GL_COLORS[f.team === 1 ? 1 : 0];
        const fade = (f.status === 'routing' || f.status === 'routed' ? .77 : 1) * (1 - (f.fatigue || 0) * .0012);
        gl.uniform3f(u.color, color[0] * fade, color[1] * fade, color[2] * fade);
        const kind = this.soldierKind(f);
        const pointSize = clamp(Math.sqrt(width * depth / Math.max(1, batch.initial)) * scale * (kind === 1 ? .98 : .84), 1.1 * this.dpr, 23 * this.dpr);
        gl.uniform1f(u.size, pointSize);
        gl.uniform1f(u.kind, kind);
        gl.uniform1f(u.detail, pointSize / this.dpr >= 5 ? 1 : 0);
        gl.uniform1f(u.disorder, clamp(1 - (f.cohesion == null ? 100 : f.cohesion) / 100, 0, 1));
        gl.uniform1f(u.moving, !opts.paused && (f.status === 'moving' || f.status === 'charging') ? 1 : 0);
        gl.drawArrays(gl.POINTS, batch.start, count);
        drawn += count;
      }
      this.stats.drawnSoldiers = drawn;
    }

    soldierKind(f) {
      if (f.type === 'artillery') return 5; // Each point is a crew member.
      if (f.type === 'cavalry') return 1;
      if (f.weapon === 'musket' || f.type === 'musketeers' || f.type === 'musket') return 3;
      if (f.type === 'archers' || f.type === 'archer') return 2;
      return 0;
    }

    soldierSprite(kind, team) {
      const key = kind + ':' + team;
      if (this.spriteCache.has(key)) return this.spriteCache.get(key);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.translate(32, 32);ctx.scale(28, 28);
      const oval = (x, y, rx, ry, color) => {
        ctx.fillStyle = color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();
      };
      const teamColor = COLORS[team === 1 ? 1 : 0];
      oval(.1,.16,.43,.61,'rgba(24,28,18,.26)');
      if (kind === 4) {
        ctx.fillStyle='#58482e';ctx.fillRect(-.29,-.2,.58,.7);
        oval(-.39,.04,.12,.35,'#303329');oval(.39,.04,.12,.35,'#303329');
        ctx.fillStyle='#404639';ctx.fillRect(-.13,-.82,.26,1.1);
        ctx.fillStyle='#94937a';ctx.fillRect(-.09,-.78,.045,.82);
        ctx.fillStyle='#282c23';ctx.fillRect(-.14,-.83,.28,.09);
      } else {
        if(kind===1) {
          oval(0,.12,.31,.56,'#685137');
          oval(0,-.5,.15,.26,'#4f402e');
          ctx.fillStyle='#45382b';ctx.fillRect(-.36,-.09,.10,.54);ctx.fillRect(.26,-.09,.10,.54);
          oval(0,.09,.23,.23,teamColor);
        } else {
          oval(-.11,.49,.085,.16,'#333528');oval(.11,.49,.085,.16,'#333528');
          oval(0,.12,.22,.34,teamColor);
        }
        ctx.strokeStyle='#665438';ctx.lineWidth=.047;ctx.lineCap='round';
        if(kind===2) {
          ctx.beginPath();ctx.ellipse(.12,-.05,.32,.58,0,-Math.PI/2,Math.PI/2);ctx.stroke();
          ctx.lineWidth=.017;ctx.beginPath();ctx.moveTo(.12,-.63);ctx.lineTo(.12,.53);ctx.stroke();
        } else if(kind<2||kind===3) {
          ctx.beginPath();ctx.moveTo(.3,.58);ctx.lineTo(.3,-.89);ctx.stroke();
          ctx.strokeStyle='#b6b49a';ctx.lineWidth=.035;
          ctx.beginPath();ctx.moveTo(.3,-.59);ctx.lineTo(.3,-.9);ctx.stroke();
        }
        if(kind<2) {
          oval(-.23,.06,.20,.27,teamColor);
          ctx.strokeStyle='#a28d5b';ctx.lineWidth=.036;ctx.beginPath();ctx.ellipse(-.23,.06,.20,.27,0,0,Math.PI*2);ctx.stroke();
          oval(-.23,.02,.056,.072,'#c0ac78');
        }
        oval(0,kind===1?-.14:-.21,kind===1?.15:.18,.16,kind>=3?'#30372d':'#9d987c');
        oval(-.048,kind===1?-.18:-.26,.074,.046,kind>=3?'#596451':'#d0c4a1');
      }
      this.spriteCache.set(key,canvas);
      return canvas;
    }

    updateScars(formations, time) {
      const ctx = this.scarCanvas.getContext('2d');
      if(time < this.lastRenderTime) {
        ctx.clearRect(0,0,WORLD_W,WORLD_H);
        this.previousCounts.clear();
      }
      for(const f of formations) {
        const previous=this.previousCounts.get(f.id),batch=this.batches.get(f.id);
        if(previous!=null && batch && previous>f.count) {
          const angle=(f.angle||0)+Math.PI/2,c=Math.cos(angle),s=Math.sin(angle);
          // Marks stay where losses occurred; they never move with the regiment.
          for(let i=0;i<Math.min(24,previous-f.count);i++) {
            const index=Math.min(batch.initial-1,f.count+i);
            const px=batch.points[index*2]*(f.width||100),py=batch.points[index*2+1]*(f.depth||60);
            const x=f.x+px*c-py*s,y=f.y+px*s+py*c;
            ctx.save();ctx.translate(x,y);ctx.rotate((index*2.399)%Math.PI);
            ctx.fillStyle=f.team===1?'rgba(89,47,31,.48)':'rgba(48,68,46,.48)';
            ctx.fillRect(-1.3,-.55,2.6,1.1);ctx.restore();
          }
        }
        this.previousCounts.set(f.id,f.count);
      }
      this.lastRenderTime=time;
    }

    drawCanvasTroops(formations) {
      const ctx = this.troopContext;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);
      let drawn = 0;
      for (const f of formations) {
        const batch = this.batches.get(f.id);
        if (!batch) continue;
        const count = clamp(Math.floor(f.count || 0), 0, batch.initial);
        if (!count) continue;
        const width = f.width || 100;
        const depth = f.depth || 60;
        const spacing = Math.sqrt(width * depth / Math.max(1, batch.initial));
        const kind=this.soldierKind(f);
        const detailed=spacing*this.scale*(kind===1?.98:.84)>=5;
        const rasterScale=detailed?Math.max(3,Math.min(8,Math.ceil(this.scale*1.3))):Math.max(3,1.5/Math.max(.2,spacing));
        const sprite=detailed?this.soldierSprite(kind,f.team):null;
        const position=this.worldToScreen(f.x,f.y);
        drawn+=count;
        if(position.x+width*this.scale<0 || position.y+width*this.scale<0 || position.x-width*this.scale>this.width || position.y-width*this.scale>this.height)continue;
        // The fallback caches each regiment at an inspectable resolution.
        // Rebuilding is needed only when the formation dimensions change.
        if (!batch.tile || batch.tileWidth !== width || batch.tileDepth !== depth || batch.rasterScale!==rasterScale || batch.detailed!==detailed || batch.kind!==kind) {
          const tile = batch.tile || document.createElement('canvas');
          tile.width = Math.ceil(width * rasterScale) + 10;
          tile.height = Math.ceil(depth * rasterScale) + 10;
          const tctx = tile.getContext('2d');
          tctx.fillStyle = COLORS[f.team === 1 ? 1 : 0];
          const size = Math.max(1, spacing * rasterScale * (kind===1?.95:.82));
          for (let i = 0; i < count; i++) {
            const x = (batch.points[i * 2] + .5) * width * rasterScale + 5;
            const y = (batch.points[i * 2 + 1] + .5) * depth * rasterScale + 5;
            if(sprite)tctx.drawImage(sprite,x-size/2,y-size/2,size,size);
            else tctx.fillRect(x - size / 2, y - size / 2, size, size);
          }
          batch.tile = tile;
          batch.rasterScale = rasterScale;
          batch.rasterSize = size;
          batch.tileCount = count;
          batch.tileWidth = width;
          batch.tileDepth = depth;
          batch.detailed=detailed;
          batch.kind=kind;
        } else if (batch.tileCount !== count) {
          const tctx = batch.tile.getContext('2d');
          const size = batch.rasterSize;
          tctx.fillStyle = COLORS[f.team === 1 ? 1 : 0];
          // Update only the changed soldiers, including when seeking a replay.
          for (let i = Math.min(count, batch.tileCount); i < Math.max(count, batch.tileCount); i++) {
            const x = (batch.points[i * 2] + .5) * width * batch.rasterScale + 5;
            const y = (batch.points[i * 2 + 1] + .5) * depth * batch.rasterScale + 5;
            if (count < batch.tileCount) tctx.clearRect(x - size / 2 - .25, y - size / 2 - .25, size + .5, size + .5);
            else if(sprite)tctx.drawImage(sprite,x-size/2,y-size/2,size,size);
            else tctx.fillRect(x - size / 2, y - size / 2, size, size);
          }
          batch.tileCount = count;
        }
        const pos = this.worldToScreen(f.x, f.y);
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate((f.angle || 0) + Math.PI / 2);
        ctx.scale(this.scale, this.scale);
        ctx.drawImage(batch.tile, -width / 2 - 5 / batch.rasterScale, -depth / 2 - 5 / batch.rasterScale,
          batch.tile.width / batch.rasterScale, batch.tile.height / batch.rasterScale);
        ctx.restore();
      }
      this.stats.drawnSoldiers = drawn;
    }

    drawBattleEffects(ctx, formations, opts) {
      const scale=this.scale,time=opts.time||0;
      const haze=(x,y,r,opacity,color)=>{
        const p=this.worldToScreen(x,y),radius=Math.max(1,r*scale);
        const gradient=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,radius);
        gradient.addColorStop(0,`rgba(${color},${opacity})`);
        gradient.addColorStop(.45,`rgba(${color},${opacity*.65})`);
        gradient.addColorStop(1,`rgba(${color},0)`);
        ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fill();
      };
      for(const f of formations) {
        if(!f.count)continue;
        if(['moving','charging','routing'].includes(f.status)) {
          const phase=(time*.65+f.id*.371)%1;
          const behind=(f.depth||60)*.35+phase*18;
          haze(f.x-Math.cos(f.angle)*behind,f.y-Math.sin(f.angle)*behind,
            10+phase*14,(1-phase)*(f.type==='cavalry'?.21:.11),'168,151,109');
        }
        if(f.type==='artillery') {
          const p=this.worldToScreen(f.x,f.y),angle=(f.angle||0)+Math.PI/2;
          const guns=Math.max(1,Math.min(8,Math.floor(f.guns||f.initial/80||2)));
          ctx.save();ctx.translate(p.x,p.y);ctx.rotate(angle);
          const icon=this.soldierSprite(4,f.team),size=clamp(12*scale,5,34);
          for(let i=0;i<guns;i++) {
            const x=((i+.5)/guns-.5)*(f.width||100)*scale;
            const y=-(f.depth||60)*scale*.22;
            ctx.drawImage(icon,x-size/2,y-size/2,size,size);
          }
          ctx.restore();
        }
      }
      for(const effect of (opts.effects||[])) {
        const age=time-effect.time,life=effect.life||1;
        if(age<0||age>life)continue;
        const t=clamp(age/life,0,1),seed=Number(effect.id)||0;
        const tx=effect.tx==null?effect.x:effect.tx,ty=effect.ty==null?effect.y:effect.ty;
        const from=this.worldToScreen(effect.x,effect.y),to=this.worldToScreen(tx,ty);
        if(effect.type==='arrow') {
          const length=Math.hypot(to.x-from.x,to.y-from.y);
          for(let i=0;i<5;i++) {
            const flight=clamp(t*1.1-i*.025,0,1);
            const sway=(i-2)*Math.max(1.5,scale*4);
            const x=from.x+(to.x-from.x)*flight+sway;
            const y=from.y+(to.y-from.y)*flight-Math.sin(flight*Math.PI)*Math.min(23,length*.14)+sway*.3;
            const direction=Math.atan2(to.y-from.y-Math.cos(flight*Math.PI)*35,to.x-from.x);
            ctx.strokeStyle=`rgba(68,61,42,${.8*(1-t*.4)})`;ctx.lineWidth=Math.max(.7,scale*.6);
            ctx.beginPath();ctx.moveTo(x-Math.cos(direction)*Math.max(3,scale*3),y-Math.sin(direction)*Math.max(3,scale*3));ctx.lineTo(x,y);ctx.stroke();
          }
        } else if(effect.type==='musket'||effect.type==='cannon') {
          const cannon=effect.type==='cannon';
          if(t<.24) {
            const flight=clamp(t/.24,0,1);
            ctx.strokeStyle=cannon?'rgba(70,59,39,.84)':`rgba(253,234,176,${(1-t/.24)*.8})`;
            ctx.lineWidth=cannon?Math.max(1.5,scale):.8;
            ctx.beginPath();ctx.moveTo(from.x+(to.x-from.x)*Math.max(0,flight-.15),from.y+(to.y-from.y)*Math.max(0,flight-.15));
            ctx.lineTo(from.x+(to.x-from.x)*flight,from.y+(to.y-from.y)*flight);ctx.stroke();
            if(!cannon){ctx.fillStyle=`rgba(255,223,133,${1-t/.24})`;ctx.beginPath();ctx.arc(from.x,from.y,Math.max(1.8,scale*2.5),0,Math.PI*2);ctx.fill();}
          }
          for(let i=0;i<(cannon?5:3);i++) {
            const drift=Math.sin(seed*1.3+i)*8;
            haze(effect.x+age*7+drift,effect.y-age*5+Math.cos(i*2)*7,
              (cannon?13:8)+t*(cannon?31:23),Math.pow(1-t,.7)*(cannon?.23:.17),'216,211,189');
          }
        } else if(effect.type==='impact') {
          haze(tx,ty,5+t*24,(1-t)*.29,'112,98,69');
          if(t<.5){const p=this.worldToScreen(tx,ty);ctx.strokeStyle=`rgba(133,108,63,${(.5-t)*.5})`;ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.x,p.y,(3+t*18)*scale,0,Math.PI*2);ctx.stroke();}
        }
      }
    }

    drawOverlay(formations, selectedIds, opts) {
      const ctx = this.overlayContext;
      const scale = this.scale;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);

      for(const f of formations) {
        if(!selectedIds.has(f.id)||!f.count||!(f.range>65))continue;
        const p=this.worldToScreen(f.x,f.y),r=f.range*scale;
        ctx.save();ctx.translate(p.x,p.y);
        ctx.strokeStyle='rgba(241,238,197,.36)';ctx.lineWidth=1;ctx.setLineDash([4,7]);
        ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
        ctx.fillStyle='rgba(244,239,195,.035)';ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,r,(f.angle||0)-.5,(f.angle||0)+.5);ctx.closePath();ctx.fill();
        ctx.restore();
      }
      this.drawBattleEffects(ctx,formations,opts);

      // Orders are drawn underneath flags and the selection outline.
      for (const f of formations) {
        if (!selectedIds.has(f.id) || f.count <= 0) continue;
        const target = f.targetId != null ? formations.find(other => other.id === f.targetId && other.count > 0) : null;
        const tx = target ? target.x : f.targetX;
        const ty = target ? target.y : f.targetY;
        if (tx == null || ty == null || Math.hypot(tx - f.x, ty - f.y) < 8) continue;
        const from = this.worldToScreen(f.x, f.y);
        const to = this.worldToScreen(tx, ty);
        const waypoints = Array.isArray(f._path) && f._path.length
          ? f._path.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).map(p => this.worldToScreen(p.x,p.y))
          : [];
        const attack = !!target;
        ctx.save();
        ctx.strokeStyle = attack ? 'rgba(131,51,38,.84)' : 'rgba(35,91,79,.83)';
        ctx.lineWidth = 1.7;
        ctx.setLineDash([5, 5]);
        ctx.lineDashOffset = -(opts.time || 0) * 5;
        ctx.beginPath(); ctx.moveTo(from.x, from.y);
        for(const point of waypoints)ctx.lineTo(point.x,point.y);
        ctx.lineTo(to.x,to.y);ctx.stroke();
        ctx.setLineDash([]);
        ctx.translate(to.x, to.y);
        const last=waypoints.slice().reverse().find(p=>Math.hypot(p.x-to.x,p.y-to.y)>1)||from;
        ctx.rotate(Math.atan2(to.y - last.y, to.x - last.x));
        ctx.beginPath(); ctx.moveTo(-10, -5); ctx.lineTo(0, 0); ctx.lineTo(-10, 5); ctx.stroke();
        if (attack) {
          ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.restore();
      }

      for (const f of formations) {
        if (f.count <= 0) continue;
        const pos = this.worldToScreen(f.x, f.y);
        const selected = selectedIds.has(f.id);
        const width = (f.width || 100) * scale;
        const depth = (f.depth || 60) * scale;
        const visualAngle = (f.angle || 0) + Math.PI / 2;
        const projectedHalfHeight = (Math.abs(Math.sin(visualAngle)) * width + Math.abs(Math.cos(visualAngle)) * depth) / 2;
        if (pos.x < -200 || pos.y < -200 || pos.x > this.width + 200 || pos.y > this.height + 200) continue;
        const color = COLORS[f.team === 1 ? 1 : 0];
        if (selected) {
          ctx.save();
          ctx.translate(pos.x, pos.y); ctx.rotate(visualAngle);
          ctx.strokeStyle = 'rgba(255,247,216,.98)';
          ctx.lineWidth = 2;
          ctx.shadowColor = 'rgba(47,49,32,.3)'; ctx.shadowBlur = 3;
          roundedRect(ctx, -width / 2 - 4, -depth / 2 - 4, width + 8, depth + 8, 3);
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = color; ctx.lineWidth = .75;
          roundedRect(ctx, -width / 2 - 6, -depth / 2 - 6, width + 12, depth + 12, 3);
          ctx.stroke();
          ctx.fillStyle='rgba(255,247,214,.92)';
          ctx.beginPath();ctx.moveTo(-4,-depth/2-8);ctx.lineTo(0,-depth/2-14);ctx.lineTo(4,-depth/2-8);ctx.closePath();ctx.fill();
          ctx.restore();
        }

        const flagX = pos.x;
        const flagY = pos.y - Math.max(14, projectedHalfHeight + 7);
        const flagW = selected ? 28 : 23;
        const flagH = selected ? 22 : 19;
        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(57,62,42,.7)';
        ctx.beginPath(); ctx.moveTo(flagX, flagY + flagH / 2); ctx.lineTo(flagX, flagY + flagH / 2 + 8); ctx.stroke();
        ctx.shadowColor = 'rgba(42,43,28,.25)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 2;
        roundedRect(ctx, flagX - flagW / 2, flagY - flagH / 2, flagW, flagH, 3);
        ctx.fillStyle = color; ctx.fill();
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        ctx.strokeStyle = selected ? '#fff6da' : 'rgba(245,235,208,.7)';
        ctx.lineWidth = selected ? 2 : 1; ctx.stroke();
        ctx.translate(flagX, flagY);
        ctx.strokeStyle = '#eee6cd'; ctx.lineWidth = 1.4;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        if (f.type === 'artillery') {
          ctx.moveTo(-5,1);ctx.lineTo(5,-2);ctx.moveTo(-4,-2);ctx.lineTo(5,-5);
          ctx.moveTo(-3,3);ctx.arc(-3,3,2,0,Math.PI*2);ctx.moveTo(5,3);ctx.arc(3,3,2,0,Math.PI*2);
        } else if (f.type === 'cavalry') {
          ctx.moveTo(-5, 3); ctx.lineTo(0, -3); ctx.lineTo(5, 3);
          ctx.moveTo(-5, -1); ctx.lineTo(0, -7); ctx.lineTo(5, -1);
        } else if (f.weapon === 'musket') {
          ctx.moveTo(-5,5);ctx.lineTo(5,-5);ctx.moveTo(-5,2);ctx.lineTo(-2,5);
          ctx.moveTo(0,-3);ctx.lineTo(3,0);
        } else if (f.type === 'archers' || f.type === 'archer') {
          ctx.arc(-2, 0, 6, -Math.PI / 2, Math.PI / 2);
          ctx.moveTo(-2, -6); ctx.lineTo(-2, 6);
          ctx.moveTo(-6, 0); ctx.lineTo(7, 0); ctx.moveTo(4, -2); ctx.lineTo(7, 0); ctx.lineTo(4, 2);
        } else {
          ctx.moveTo(-4, 5); ctx.lineTo(4, -5);
          ctx.moveTo(4, 5); ctx.lineTo(-4, -5);
          ctx.moveTo(-5, 2); ctx.lineTo(-2, 5);
          ctx.moveTo(2, 5); ctx.lineTo(5, 2);
        }
        ctx.stroke();
        ctx.restore();

        if (selected || this.view.zoom >= 1.8) {
          const label = f.name || f.label || `${f.type === 'cavalry' ? 'Cavalry' : f.type === 'archers' ? 'Archers' : 'Infantry'} ${f.id + 1}`;
          const textY = pos.y + Math.max(14, projectedHalfHeight + 13);
          ctx.font = `${selected ? '600' : '500'} 10px "Inter", "Arial", sans-serif`;
          const textWidth = ctx.measureText(label).width;
          ctx.fillStyle = selected ? 'rgba(36,55,43,.89)' : 'rgba(237,228,199,.88)';
          roundedRect(ctx, pos.x - textWidth / 2 - 7, textY - 10, textWidth + 14, 17, 3);
          ctx.fill();
          ctx.textAlign = 'center';
          ctx.fillStyle = selected ? '#f1ead3' : '#414b36';
          ctx.fillText(label, pos.x, textY + 2);
          if (selected) {
            const normalized = (f.morale == null ? 1 : f.morale > 1 ? f.morale / 100 : f.morale);
            ctx.fillStyle = 'rgba(38,49,35,.22)';
            ctx.fillRect(pos.x - 21, textY + 11, 42, 3);
            ctx.fillStyle = normalized < .3 ? '#a15b3d' : '#397366';
            ctx.fillRect(pos.x - 21, textY + 11, 42 * clamp(normalized, 0, 1), 3);
          }
        }
      }

      const rect = opts.selectionRect;
      if (rect) {
        ctx.fillStyle = 'rgba(238,240,204,.14)';
        ctx.strokeStyle = '#f6f1d7'; ctx.lineWidth = 1;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.strokeRect(rect.x + .5, rect.y + .5, rect.w, rect.h);
      }

      if (this.width > 640) {
        ctx.save();
        ctx.translate(this.width - 41, 45);
        ctx.fillStyle = 'rgba(61,78,49,.57)';
        ctx.strokeStyle = 'rgba(61,78,49,.36)';
        ctx.lineWidth = .75;
        ctx.font = '9px Georgia, serif'; ctx.textAlign = 'center';
        ctx.fillText('N', 0, -20);
        ctx.beginPath(); ctx.arc(0, 1, 12, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(4, 6); ctx.lineTo(0, 2); ctx.lineTo(-4, 6); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(0, 2); ctx.moveTo(-15, 1); ctx.lineTo(15, 1); ctx.stroke();
        ctx.restore();
      }
    }

    destroy() {
      if (this.resizeObserver) this.resizeObserver.disconnect();
      if (this.gl) {
        this.gl.deleteBuffer(this.buffer);
        this.gl.deleteProgram(this.program);
      }
      for (const canvas of this.layers) canvas.remove();
      this.batches.clear();
    }
  }

  window.BattleRenderer = BattleRenderer;
})();

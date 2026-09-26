(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const format = n => Math.round(n).toLocaleString('en-US');
  const clock = t => `${Math.floor(t / 60).toString().padStart(2, '0')}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
  const paths = {
    map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Z"/><path d="M9 3v16M15 5v16"/>',
    flag: '<path d="M5 21V3m0 1c5-4 9 4 15 0v10c-6 4-10-4-15 0"/>',
    play: '<path d="m8 4 12 8-12 8V4Z"/>',
    pause: '<path d="M8 4v16M16 4v16"/>',
    restart: '<path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7"/>',
    replay: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/><path d="m10 8 6 4-6 4V8Z"/>',
    fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/><path d="M9 12h6m-3-3v6"/>',
    move: '<path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4m10-8 4 4-4 4"/>',
    shield: '<path d="M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7L12 3Z"/><path d="M12 7v10"/>',
    swords: '<path d="m4 3 17 17M3 4l1 5 5 1M3 21l5-5m8-8 5-5-1 5-3 1M4 15l5 5m6-5 5 5"/>',
    infantry: '<path d="M12 2v20M8 7l4-5 4 5M7 12h10"/><path d="M4 14v4c0 2 3 4 3 4s3-2 3-4v-4H4Z"/>',
    cavalry: '<path d="m7 21 1-6-3-3 3-6 4-1 2-3 1 4 4 5v10H7Z"/><path d="m8 9 3 2M12 6l-1 3M11 21v-5l3-4"/>',
    archers: '<path d="M7 2c14 5 14 15 0 20l4-10-4-10ZM3 12h18m-4-4 4 4-4 4"/>',
    musket: '<path d="m4 21 4-4-2-2 3-4 3 1L20 3m-8 9 2 2 7-9M3 18l3 3M9 11l3 3"/>',
    artillery: '<circle cx="8" cy="17" r="4"/><path d="m3 11 16-6 2 4-15 6m5 3 9 3M8 13v8m-4-4h8"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.infantry}</svg>`;
  document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));

  const map = $('map-container');
  let renderer;
  try { renderer = new BattleRenderer(map); }
  catch (error) { map.innerHTML = '<p style="padding:40px">The battlefield could not start. Please try a browser with Canvas support.</p>'; console.error(error); return; }
  let engine, scenario, running = false, started = false, speed = 1;
  const RECORD_INTERVAL = .25;
  let selected = new Set(), snapshots = [], nextSnapshot = RECORD_INTERVAL;
  let replayMode = false, replayPlaying = false, replayCursor = 0, replayTime = 0;
  let pointer = null, selectionRect = null, lastFrame = 0, accumulator = 0;
  let uiElapsed = 0, frameCount = 0, fpsElapsed = 0, toastTimer;
  let savedRunning = false;
  const cardNodes = new Map();
  const isViable = f => f.count > 0 && !['routing', 'defeated'].includes(f.status);
  function currentFormations() {
    if (!replayMode) return engine.formations;
    const index = Math.min(Math.floor(replayCursor), snapshots.length - 1);
    const first = snapshots[index], next = snapshots[Math.min(index + 1, snapshots.length - 1)];
    const fraction = replayCursor - index;
    return first.formations.map((f, i) => {
      const n = next.formations[i];
      const deltaAngle = Math.atan2(Math.sin(n.angle - f.angle), Math.cos(n.angle - f.angle));
      return {...f, x:f.x+(n.x-f.x)*fraction, y:f.y+(n.y-f.y)*fraction,
        angle:f.angle+deltaAngle*fraction, count:Math.round(f.count+(n.count-f.count)*fraction),
        width:f.width+(n.width-f.width)*fraction, depth:f.depth+(n.depth-f.depth)*fraction,
        morale:f.morale+(n.morale-f.morale)*fraction,
        fatigue:(f.fatigue||0)+((n.fatigue||0)-(f.fatigue||0))*fraction,
        cohesion:(f.cohesion??100)+((n.cohesion??100)-(f.cohesion??100))*fraction};
    });
  }

  function setReplayTime(time) {
    replayTime = Math.max(snapshots[0].time,Math.min(snapshots[snapshots.length-1].time,time));
    let lo=0, hi=snapshots.length-1;
    while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(snapshots[mid].time<=replayTime)lo=mid;else hi=mid-1;}
    const next=Math.min(lo+1,snapshots.length-1),span=snapshots[next].time-snapshots[lo].time;
    replayCursor=lo+(span>0?(replayTime-snapshots[lo].time)/span:0);
  }

  function currentEffects() {
    if(!replayMode)return engine.effects||[];
    const i=Math.floor(replayCursor), seen=new Set();
    return [...(snapshots[i].effects||[]),...(snapshots[Math.min(i+1,snapshots.length-1)].effects||[])].filter(e=>{
      if(seen.has(e.id)||replayTime<e.time||replayTime>e.time+e.life)return false;
      seen.add(e.id);return true;
    });
  }
  const unitRole=f=>f.type==='artillery'?'Artillery crew':f.weapon==='musket'?'Musket infantry':f.type==='cavalry'?'Cavalry':f.weapon==='sling'?'Slingers':f.weapon==='bow'?'Archers':'Infantry';

  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2600);
  }

  function createCards() {
    $('unit-roster').replaceChildren(); cardNodes.clear();
    engine.formations.filter(f => f.team === 0).forEach(f => {
      const button = document.createElement('button');
      button.className = 'unit-card'; button.dataset.id = f.id;
      button.innerHTML = `<span class="unit-top"><span class="unit-symbol">${icon(f.weapon==='musket'?'musket':f.type)}</span><span class="unit-count"></span></span><span class="unit-name"></span><span class="unit-status"></span><span class="morale-track"><span></span></span>`;
      button.querySelector('.unit-name').textContent = f.name;
      button.addEventListener('click', event => {
        if (replayMode) return;
        if (!isViable(f)) { toast('This formation has left the fight.'); return; }
        selectIds([f.id], event.shiftKey || event.metaKey || event.ctrlKey);
      });
      cardNodes.set(f.id, button); $('unit-roster').append(button);
    });
  }

  function loadBattle(id, total = +$('army-size').value) {
    scenario = BATTLES.find(s => s.id === id) || BATTLES[0];
    engine = new BattleEngine(scenario, total);
    running = false; started = false; replayMode = false; replayPlaying = false;
    selected.clear(); accumulator = 0; replayCursor = 0; replayTime = 0;
    snapshots = [engine.snapshot()]; nextSnapshot = RECORD_INTERVAL;
    $('replay-tray').hidden = true; $('result-card').hidden = true;
    $('army-size').value = total; $('size-value').textContent = format(total);
    const squareOption=$('formation-select').querySelector('option[value="square"]');
    squareOption.hidden=scenario.id!=='austerlitz';squareOption.disabled=scenario.id!=='austerlitz';
    squareOption.textContent='Square · muskets';
    $('formation-select').value='line';
    const copy = {'era':scenario.era,'battle-name':scenario.name,'location':scenario.location,'commander':scenario.commander,'army-name':scenario.friendly,'briefing':scenario.briefing,'history':scenario.history,'friendly-label':scenario.friendly.toUpperCase(),'enemy-label':scenario.enemy.toUpperCase(),'map-kicker':scenario.war,'map-title':scenario.mapTitle};
    Object.entries(copy).forEach(([id,text]) => $(id).textContent = text);
    renderer.setScenario(scenario,engine.terrain); renderer.setFormations(engine.formations); renderer.resetView();
    createCards(); updateUI();
    // A read-only status surface for browser verification and diagnostics.
    window.fieldCommand = {
      get engine() { return engine; }, get renderer() { return renderer; },
      get selected() { return [...selected]; }, get running() { return running; },
      get recordingLength() { return snapshots.length; }, get replayMode() { return replayMode; },
      get replayCursor() { return replayCursor; }
    };
  }

  function selectIds(ids, additive = false) {
    if (replayMode || engine.winner) return;
    if (!additive) selected.clear();
    ids.forEach(id => { if (additive && selected.has(id)) selected.delete(id); else selected.add(id); });
    $('map-hint').hidden = true;
    updateUI();
  }

  function all() {
    if (replayMode || engine.winner) return;
    selectIds(engine.formations.filter(f => f.team === 0 && isViable(f)).map(f => f.id));
  }

  function requireSelection() {
    if (replayMode) { toast('Return to battle to issue orders.'); return false; }
    if (engine.winner) return false;
    for (const id of selected) if (!isViable(engine.formations.find(f => f.id === id))) selected.delete(id);
    if (!selected.size) { toast('Select a formation first, or press A to select all.'); return false; }
    return true;
  }

  function command(action) {
    if (!requireSelection()) return;
    if (action === 'hold') { engine.hold([...selected]); toast(`${selected.size} formation${selected.size > 1 ? 's' : ''} holding position.`); }
    if (action === 'charge') { engine.charge([...selected]); toast('Charge ordered. Cavalry moves fastest.'); }
    if (action === 'move') toast('Click open ground to move. Click an enemy to attack.');
    updateUI();
  }

  function toggleRunning() {
    if (replayMode) {
      if (replayCursor >= snapshots.length - 1) setReplayTime(0);
      replayPlaying = !replayPlaying; updateUI(); return;
    }
    if (engine.winner) return;
    running = !running; started = true; accumulator = 0;
    updateUI();
    if (!running) toast('Tactical pause. You can still give orders.');
  }

  function recordSnapshot(force = false) {
    if (engine.time >= nextSnapshot || force) {
      if(!force || engine.time>snapshots[snapshots.length-1].time+.001) snapshots.push(engine.snapshot());
      nextSnapshot = (Math.floor(engine.time/RECORD_INTERVAL)+1)*RECORD_INTERVAL;
    }
  }

  function finishBattle() {
    running = false; recordSnapshot(true);
    const won = engine.winner === 'friendly';
    $('result-title').textContent = engine.winner === 'draw' ? 'A hard-fought draw' : won ? 'The field is yours.' : 'Your army retreats.';
    const stats = engine.getStats();
    $('result-description').textContent = `${stats.resultReason==='time_limit'?'Time limit reached; remaining combat strength decides the field. ':''}${clock(engine.time)} on the field. ${format(stats.friendly)} of your ${format(stats.friendlyInitial)} soldiers survived, including those who retreated.`;
    $('result-card').hidden = false;
    selected.clear(); updateUI();
  }

  function openReplay() {
    if (snapshots.length < 2) return;
    savedRunning = running; running = false; replayMode = true; replayPlaying = true; replayCursor = 0; replayTime = 0;
    $('result-card').hidden = true; $('replay-tray').hidden = false;
    $('replay-scrub').max = snapshots.length - 1;
    updateUI();
  }

  function exitReplay() {
    replayMode = false; replayPlaying = false; running = savedRunning && !engine.winner;
    $('replay-tray').hidden = true;
    if (engine.winner) $('result-card').hidden = false;
    accumulator = 0; updateUI();
  }

  function updateUI() {
    const formations = currentFormations();
    const stats = replayMode ? snapshots[Math.floor(replayCursor)] : engine.getStats();
    const friendly = formations.filter(f => f.team === 0).reduce((s,f) => s + f.count, 0);
    const enemy = formations.filter(f => f.team === 1).reduce((s,f) => s + f.count, 0);
    $('friendly-count').textContent = format(friendly); $('enemy-count').textContent = format(enemy);
    $('friendly-count').title = 'Surviving soldiers, including formations in retreat';
    $('enemy-count').title = 'Surviving soldiers, including formations in retreat';
    $('balance-fill').style.width = `${100 * friendly / Math.max(1, friendly + enemy)}%`;
    $('battle-clock').textContent = clock(replayMode?replayTime:stats.time);
    $('phase-label').textContent = replayMode ? 'Battle replay' : engine.winner ? 'Battle complete' : running ? 'In battle' : started ? 'Tactical pause' : 'Deployment';
    $('phase-dot').classList.toggle('running', running || replayPlaying);
    $('play-label').textContent = replayMode ? (replayPlaying ? 'Pause replay' : 'Play replay') : running ? 'Pause battle' : engine.winner ? 'Battle complete' : started ? 'Resume battle' : 'Begin battle';
    $('play-button').querySelector('.icon').innerHTML = icon(running || (replayMode && replayPlaying) ? 'pause' : 'play');
    $('play-button').disabled = !!engine.winner && !replayMode;
    $('replay-button').disabled = snapshots.length < 2 || replayMode;
    const selectedFormations = formations.filter(f => selected.has(f.id) && isViable(f));
    $('selection-info').textContent = replayMode ? 'Watching your recorded battle' : selectedFormations.length ? `${selectedFormations.length===1?selectedFormations[0].name:selectedFormations.length+' selected'} · ${format(selectedFormations.reduce((s,f) => s + f.count, 0))} soldiers` : 'Select a formation to give an order';
    updateCondition(selectedFormations);
    for (const f of formations.filter(f => f.team === 0)) {
      const card = cardNodes.get(f.id);
      card.classList.toggle('selected', selected.has(f.id) && !replayMode);
      card.classList.toggle('routing', f.status === 'routing'); card.classList.toggle('defeated', f.status === 'defeated');
      card.setAttribute('aria-pressed', String(selected.has(f.id) && !replayMode));
      card.setAttribute('aria-label', `${f.name}, ${format(f.count)} soldiers, ${f.status}, morale ${Math.round(f.morale)} percent`);
      card.title = `${f.name} · ${unitRole(f)}\nMorale ${Math.round(f.morale)}% · Cohesion ${Math.round(f.cohesion??100)}% · Fatigue ${Math.round(f.fatigue||0)}%\n${f.status} · ${f.terrain||'Open ground'}\nShift-click to add to selection`;
      card.querySelector('.unit-count').textContent = format(f.count);
      card.querySelector('.unit-status').textContent = f.status === 'holding' ? unitRole(f) : f.status;
      card.querySelector('.morale-track span').style.width = `${Math.max(0, Math.min(100, f.morale))}%`;
      card.disabled = replayMode || !!engine.winner;
    }
    for (const id of ['move-order','hold-order','charge-order','formation-select','select-all']) $(id).disabled = replayMode || !!engine.winner;
    if (selectedFormations.length === 1) $('formation-select').value = selectedFormations[0].stance;
    if (replayMode) {
      $('replay-scrub').value = Math.floor(replayCursor);
      $('replay-time').textContent = clock(replayTime);
      $('replay-play').innerHTML = icon(replayPlaying ? 'pause' : 'play');
      $('replay-play').setAttribute('aria-label', replayPlaying ? 'Pause recording' : 'Play recording');
    }
  }

  function updateCondition(formations) {
    $('condition-panel').hidden=!formations.length||replayMode;
    if(!formations.length||replayMode)return;
    const weight=formations.reduce((n,f)=>n+f.count,0)||1;
    const average=(key,def)=>formations.reduce((n,f)=>n+(f[key]??def)*f.count,0)/weight;
    for(const [name,def] of [['morale',100],['cohesion',100],['fatigue',0]]){
      const value=Math.max(0,Math.min(100,average(name,def)));
      $('condition-'+name).textContent=Math.round(value)+'%';
      $('condition-'+name+'-bar').style.width=value+'%';
    }
    const ranged=formations.filter(f=>f.maxAmmo>0);
    $('condition-ammo').textContent=ranged.length?`${Math.min(...ranged.map(f=>f.ammo))} volleys${ranged.length>1?' minimum':' left'}`:'Melee weapons';
    const reload=ranged.length?Math.max(...ranged.map(f=>(f.reload||0)*(1+(f.fatigue||0)*.006))):0;
    $('condition-reload').textContent=ranged.length?(reload>.1?`Reloading · ${reload.toFixed(1)}s`:ranged.every(f=>f.ammo<=0)?'Out of ammunition':'Ready to fire'):formations.length===1?unitRole(formations[0]):'Mixed formations';
    const terrains=new Set(formations.map(f=>f.terrain||'Open ground'));
    $('condition-terrain').textContent=terrains.size===1?[...terrains][0]:'Mixed terrain';
    const cover=Math.round(average('cover',0)*100),elevation=Math.round(average('elevation',0));
    $('condition-cover').textContent=`${cover?cover+'% cover':'No cover'} · ${elevation} m elevation`;
    const fatigue=average('fatigue',0),cohesion=average('cohesion',100);
    $('condition-advice').textContent=fatigue>60?'Tired troops lose speed and fighting strength. Hold away from combat to recover.':cohesion<55?'Ranks are disordered. Give this formation time to regroup.':ranged.length&&ranged.every(f=>f.ammo<=0)?'Ammunition is spent. Protect this formation or use it in close combat.':formations.some(f=>f.terrainType==='forest')?'Woodland provides cover, but slows movement and disrupts cavalry.':formations.some(f=>f.type==='artillery')?'Guns need a clear firing lane. Protect their crews from cavalry.':formations.some(f=>f.type==='cavalry')?'Build speed before contact. Rear attacks work best against tired, disordered troops.':'Keep your formations rested and protect their flanks. Rest restores cohesion.';
  }

  function hitFormation(x, y) {
    let best = null, bestDistance = Infinity;
    const screen = renderer.worldToScreen(x,y);
    for (const f of engine.formations) {
      if (!isViable(f)) continue;
      const p = renderer.worldToScreen(f.x,f.y), a = f.angle + Math.PI/2;
      const halfH = (Math.abs(Math.sin(a))*f.width + Math.abs(Math.cos(a))*f.depth)*renderer.scale/2;
      const flagY = p.y - Math.max(14,halfH+7);
      const d = Math.hypot(screen.x-p.x,screen.y-flagY);
      if (Math.abs(screen.x-p.x)<=18 && Math.abs(screen.y-flagY)<=15 && d<bestDistance) {best=f;bestDistance=d;}
    }
    if (best) return best;
    for (const f of engine.formations) {
      if (!isViable(f)) continue;
      const dx = x - f.x, dy = y - f.y;
      const cos = Math.cos(f.angle), sin = Math.sin(f.angle);
      const localX = cos * dx + sin * dy;
      const localY = -sin * dx + cos * dy;
      // Formation fronts are perpendicular to the direction of travel.
      const d = Math.hypot(dx,dy);
      if (Math.abs(localX) < f.depth / 2 + 24 && Math.abs(localY) < f.width / 2 + 24 && d < bestDistance) { best = f; bestDistance = d; }
    }
    return best;
  }

  map.addEventListener('pointerdown', event => {
    if (event.target.closest('button,input,.army-score,.result-card')) return;
    map.focus({preventScroll:true});
    const rect = map.getBoundingClientRect();
    pointer = {id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,startX:event.clientX-rect.left,startY:event.clientY-rect.top,button:event.button,shift:event.shiftKey,touch:event.pointerType==='touch',moved:false};
    map.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  map.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX-pointer.x, dy = event.clientY-pointer.y;
    if (Math.hypot(dx,dy)>5) pointer.moved = true;
    if (pointer.moved) {
      if (pointer.button > 0 || pointer.touch || replayMode) renderer.pan(event.clientX-pointer.lastX,event.clientY-pointer.lastY);
      else selectionRect = {x:pointer.startX,y:pointer.startY,w:dx,h:dy};
    }
    pointer.lastX=event.clientX; pointer.lastY=event.clientY;
  });
  map.addEventListener('pointerup', event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const p=pointer; pointer=null;
    if (!replayMode && !engine.winner) {
      if (selectionRect) {
        const box=selectionRect, x1=Math.min(box.x,box.x+box.w),x2=Math.max(box.x,box.x+box.w),y1=Math.min(box.y,box.y+box.h),y2=Math.max(box.y,box.y+box.h);
        selectIds(engine.formations.filter(f=>{const s=renderer.worldToScreen(f.x,f.y);return f.team===0&&isViable(f)&&s.x>=x1&&s.x<=x2&&s.y>=y1&&s.y<=y2;}).map(f=>f.id),p.shift);
      } else if (!p.moved && p.button === 0) {
        const world=renderer.screenToWorld(event.clientX,event.clientY),hit=hitFormation(world.x,world.y);
        if (hit && hit.team===0) selectIds([hit.id],p.shift);
        else if (requireSelection()) {
          if(!hit && engine.terrain && engine.terrain.sample(world.x,world.y).blocked){toast('Deep water blocks movement. Choose a bank or marked ford.');selectionRect=null;return;}
          engine.order([...selected],world.x,world.y,hit && hit.team===1 ? hit.id : null);
          toast(hit ? `Attack ${hit.name}.` : `Move ordered${running ? '.' : ' · starts when the battle runs.'}`);
          updateUI();
        }
      }
    }
    selectionRect=null;
    if (map.hasPointerCapture(event.pointerId)) map.releasePointerCapture(event.pointerId);
  });
  map.addEventListener('pointercancel', () => {pointer=null;selectionRect=null;});
  map.addEventListener('contextmenu', event => event.preventDefault());
  map.addEventListener('wheel', event => {event.preventDefault();renderer.zoomAt(event.clientX,event.clientY,Math.exp(-event.deltaY*.001));},{passive:false});

  function centerZoom(factor) {const r=map.getBoundingClientRect();renderer.zoomAt(r.left+r.width/2,r.top+r.height/2,factor);}
  function openDialog(id) {
    running=false; replayPlaying=false; accumulator=0; updateUI(); $(id).showModal();
  }
  $('zoom-in').onclick=()=>centerZoom(1.25); $('zoom-out').onclick=()=>centerZoom(.8); $('reset-view').onclick=()=>renderer.resetView();
  $('play-button').onclick=toggleRunning; $('restart').onclick=()=>{loadBattle(scenario.id);toast('Battlefield reset. Your next move is unwritten.');};
  $('army-size').onchange=()=>{loadBattle(scenario.id);toast(`${format(+$('army-size').value)} soldiers ready. Battle reset.`);};
  $('select-all').onclick=all; $('move-order').onclick=()=>command('move'); $('hold-order').onclick=()=>command('hold'); $('charge-order').onclick=()=>command('charge');
  $('inspect-selection').onclick=()=>{
    const f=engine.formations.filter(f=>selected.has(f.id)&&isViable(f));if(!f.length)return;
    renderer.view.cx=f.reduce((n,v)=>n+v.x,0)/f.length;renderer.view.cy=f.reduce((n,v)=>n+v.y,0)/f.length;
    renderer.view.zoom=f.length>1?3:(f[0].initial>1500?12:10);
    toast('Close view. Scroll out or use Fit battlefield to return.');
  };
  $('formation-select').onchange=event=>{
    if(!requireSelection())return;
    const stance=event.target.value, ids=[...selected].filter(id=>stance!=='square'||engine.formations.find(f=>f.id===id)?.weapon==='musket');
    if(!ids.length){toast('Square is available to musket infantry.');event.target.value='line';return;}
    engine.setFormation(ids,stance);toast(`${stance[0].toUpperCase()+stance.slice(1)} formation ordered${stance==='square'?' for musket infantry':''}.`);updateUI();
  };
  document.querySelectorAll('[data-speed]').forEach(button=>button.onclick=()=>{speed=+button.dataset.speed;document.querySelectorAll('[data-speed]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});});
  $('replay-button').onclick=openReplay; $('result-replay').onclick=openReplay; $('exit-replay').onclick=exitReplay;
  $('result-reset').onclick=()=>loadBattle(scenario.id);
  $('replay-play').onclick=()=>{if(replayCursor>=snapshots.length-1)setReplayTime(0);replayPlaying=!replayPlaying;updateUI();};
  $('replay-scrub').oninput=event=>{setReplayTime(snapshots[+event.target.value].time);replayPlaying=false;updateUI();};
  $('dismiss-hint').onclick=()=>$('map-hint').hidden=true;
  $('open-sidebar').onclick=()=>$('open-sidebar').closest('main').querySelector('.sidebar').classList.add('open');
  $('close-sidebar').onclick=()=>document.querySelector('.sidebar').classList.remove('open');
  $('battle-tab').onclick=()=>map.focus(); document.querySelector('.brand').onclick=event=>{event.preventDefault();map.focus();};
  ['guide-top','help-button'].forEach(id=>$(id).onclick=()=>openDialog('guide-dialog'));
  document.querySelectorAll('.dialog-close').forEach(button=>button.onclick=()=>button.closest('dialog').close());
  document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}}));
  $('scenario-picker').onclick=()=>{
    $('scenario-list').replaceChildren();
    BATTLES.forEach(s=>{
      const b=document.createElement('button');b.className='scenario-option'+(s.id===scenario.id?' active':'');
      b.innerHTML=`<span class="scenario-art"><span>${s.motif}</span></span><span class="scenario-copy"><small>${s.era}</small><h3>${s.name}</h3><p>${s.summary}</p><span>${s.id===scenario.id?'Current battlefield':'Take command'} ↗</span></span>`;
      b.onclick=()=>{loadBattle(s.id);$('scenario-dialog').close();document.querySelector('.sidebar').classList.remove('open');toast(`${s.name}. You command ${s.friendly}.`);};$('scenario-list').append(b);
    });openDialog('scenario-dialog');
  };
  $('history-button').onclick=()=>{
    $('notes-title').textContent=scenario.name;$('notes-date').textContent=`${scenario.date} · ${scenario.location}`;
    $('notes-context').textContent=scenario.context;$('notes-tactic').textContent=scenario.tactic;
    $('notes-source').href=scenario.source;$('notes-source').textContent=`${scenario.sourceName} ↗`;openDialog('history-dialog');
  };
  document.addEventListener('keydown',event=>{
    if (document.querySelector('dialog[open]') || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code==='Space' && event.target.tagName==='BUTTON') return;
    const key=event.key.toLowerCase();
    if(event.code==='Space'){event.preventDefault();toggleRunning();}
    else if(key==='a'){event.preventDefault();all();}
    else if(key==='h')command('hold');else if(key==='c')command('charge');
    else if(key==='escape'){selected.clear();document.querySelector('.sidebar').classList.remove('open');updateUI();}
    else if(key==='?' || key==='f1'){event.preventDefault();openDialog('guide-dialog');}
    else if(key.startsWith('arrow')){event.preventDefault();renderer.pan(key==='arrowleft'?50:key==='arrowright'?-50:0,key==='arrowup'?50:key==='arrowdown'?-50:0);}
    else if(key==='+' || key==='=')centerZoom(1.2);else if(key==='-')centerZoom(1/1.2);
  });
  // A background tab pauses, keeping commands and recorded time predictable.
  document.addEventListener('visibilitychange',()=>{if(document.hidden){running=false;replayPlaying=false;accumulator=0;updateUI();}});

  function frame(now) {
    const dt=lastFrame?Math.min(.1,(now-lastFrame)/1000):0;lastFrame=now;
    if(running && !engine.winner){
      accumulator+=dt*speed;
      while(accumulator>=1/30){engine.update(1/30);accumulator-=1/30;recordSnapshot();if(engine.winner){finishBattle();break;}}
    }
    if(replayMode && replayPlaying){setReplayTime(replayTime+dt*speed);if(replayCursor>=snapshots.length-1)replayPlaying=false;}
    const formations=currentFormations();
    renderer.render(formations,replayMode?new Set():selected,{time:replayMode?replayTime:engine.time,effects:currentEffects(),selectionRect,paused:!running&&!(replayMode&&replayPlaying)});
    uiElapsed+=dt;fpsElapsed+=dt;frameCount++;
    if(uiElapsed>.12){updateUI();uiElapsed=0;}
    if(fpsElapsed>=1){$('fps').textContent=`${Math.round(frameCount/fpsElapsed)} FPS`;$('renderer-label').textContent=renderer.stats.renderer==='WebGL'?'GPU':'CANVAS';frameCount=0;fpsElapsed=0;}
    requestAnimationFrame(frame);
  }
  loadBattle('cannae'); requestAnimationFrame(frame);
})();

/* Optional browser integration checks: npm install playwright, then install Chromium.
   Run: node test-ui.cjs; set BROWSER_EXECUTABLE to use an existing Chromium binary. */
const {chromium} = require('playwright');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({headless:true,
    executablePath:process.env.BROWSER_EXECUTABLE || undefined,
    args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(__dirname,'index.html')).href);
  await page.waitForFunction(()=>window.fieldCommand && fieldCommand.renderer.stats.drawnSoldiers===10000);
  assert.equal(await page.evaluate(()=>fieldCommand.engine.formations.reduce((n,f)=>n+f.count,0)),10000);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(__dirname,'preview-desktop.png')});
  await page.selectOption('#army-size','100000');
  await page.waitForFunction(()=>fieldCommand.renderer.stats.drawnSoldiers===100000);
  const renderer=await page.evaluate(()=>({name:fieldCommand.renderer.stats.renderer,error:fieldCommand.renderer.gl?.getError(),points:fieldCommand.renderer.stats.drawnSoldiers}));
  assert.equal(renderer.points,100000); if(renderer.name==='WebGL')assert.equal(renderer.error,0);
  await page.locator('.unit-card').first().click();
  assert.deepEqual(await page.evaluate(()=>fieldCommand.selected),[0]);
  const destination=await page.evaluate(()=>{const p=fieldCommand.renderer.worldToScreen(300,610),r=document.getElementById('map-container').getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y};});
  await page.mouse.click(destination.x,destination.y);
  assert.equal(await page.evaluate(()=>fieldCommand.engine.formations[0].command),'move');
  await page.click('#play-button'); await page.waitForTimeout(1300);
  assert.ok(await page.evaluate(()=>fieldCommand.engine.time)>0.7);
  assert.ok(await page.evaluate(()=>fieldCommand.engine.formations[0].y)<790);
  await page.click('#play-button');
  const pausedTime=await page.evaluate(()=>fieldCommand.engine.time);
  await page.waitForTimeout(200); assert.equal(await page.evaluate(()=>fieldCommand.engine.time),pausedTime);
  await page.click('#hold-order');assert.equal(await page.evaluate(()=>fieldCommand.engine.formations[0].command),'hold');
  await page.selectOption('#formation-select','column');assert.equal(await page.evaluate(()=>fieldCommand.engine.formations[0].stance),'column');
  await page.click('#select-all');assert.equal(await page.evaluate(()=>fieldCommand.selected.length),12);
  await page.click('#replay-button');assert.equal(await page.evaluate(()=>fieldCommand.replayMode),true);
  await page.locator('#replay-scrub').evaluate(el=>{el.value=el.max;el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.click('#play-button');await page.waitForTimeout(200);
  assert.ok(await page.evaluate(()=>fieldCommand.replayCursor)<await page.evaluate(()=>fieldCommand.recordingLength-1));
  await page.click('#exit-replay');assert.equal(await page.evaluate(()=>fieldCommand.replayMode),false);
  assert.equal(await page.evaluate(()=>fieldCommand.engine.time),pausedTime);
  const zoom=await page.evaluate(()=>fieldCommand.renderer.view.zoom);await page.click('#zoom-in');
  assert.ok(await page.evaluate(()=>fieldCommand.renderer.view.zoom)>zoom);await page.click('#reset-view');
  await page.click('#scenario-picker');await page.locator('.scenario-option').nth(1).click();
  assert.equal(await page.evaluate(()=>fieldCommand.engine.scenarioId),'hastings');
  assert.equal(await page.evaluate(()=>fieldCommand.recordingLength),1);
  await page.click('#scenario-picker');await page.locator('.scenario-option').nth(2).click();
  assert.equal(await page.evaluate(()=>fieldCommand.engine.scenarioId),'austerlitz');
  await page.locator('.unit-card').nth(1).click();
  await page.selectOption('#formation-select','square');
  assert.equal(await page.evaluate(()=>fieldCommand.engine.formations[1].stance),'square');
  assert.ok(await page.locator('#condition-ammo').textContent());
  await page.click('#history-button');assert.ok(await page.locator('#notes-context').textContent());await page.locator('#history-dialog .dialog-close').click();
  await page.click('#scenario-picker');await page.locator('.scenario-option').first().click();
  await page.selectOption('#army-size','10000');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const flag=await page.evaluate(()=>{const f=fieldCommand.engine.formations[2],ren=fieldCommand.renderer,p=ren.worldToScreen(f.x,f.y),r=document.getElementById('map-container').getBoundingClientRect(),a=f.angle+Math.PI/2;return {x:r.left+p.x,y:r.top+p.y-Math.max(14,(Math.abs(Math.sin(a))*f.width+Math.abs(Math.cos(a))*f.depth)*ren.scale/2+7)};});
  await page.mouse.click(flag.x,flag.y);assert.deepEqual(await page.evaluate(()=>fieldCommand.selected),[2]);
  await page.screenshot({path:path.join(__dirname,'preview-mobile.png')});
  await page.click('#open-sidebar');await page.click('#scenario-picker');await page.locator('.scenario-option').nth(1).click();
  assert.equal(await page.evaluate(()=>fieldCommand.engine.scenarioId),'hastings');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,renderer,checks:'load, 100k draw count, selection, movement, pause, hold, formations, select all, replay end restart/scrub/return, zoom, scenarios, notes, mobile flag selection, overflow, runtime errors'},null,2));
  await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});

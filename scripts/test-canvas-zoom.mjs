import assert from 'node:assert/strict';
import { createTestRoot, buildBrowserFixture, serveBrowserFixture, startBrowser } from './browser-test-harness.mjs';

const root = await createTestRoot('canvas-zoom-');
await buildBrowserFixture(root, `
import cytoscape from 'cytoscape';
import { observeCanvasZoomBounds, updateCanvasZoomBounds, canvasZoomPercent } from './src/lib/canvasZoom';
document.body.innerHTML='<div id="graph" style="width:800px;height:600px"></div>';
const cy=cytoscape({container:document.getElementById('graph'), minZoom:0.1,maxZoom:3,
  layout:{name:'preset'},style:[{selector:'node',style:{width:80,height:40,label:'data(label)'}}],
  elements:Array.from({length:400},(_,i)=>({data:{id:String(i),label:'Source '+i},position:{x:(i%20)*1000,y:Math.floor(i/20)*1000}}))});
window.cy=cy;
window.update=()=>updateCanvasZoomBounds(cy);
window.percent=canvasZoomPercent;
window.stop=observeCanvasZoomBounds(cy,()=>window.updates=(window.updates||0)+1);
`);
const server = await serveBrowserFixture(root);
let session;
try {
  session = await startBrowser({root});
  await session.navigate(server.url);
  const {evaluate, until} = session;
  await until('window.updates > 0');
  assert(await evaluate('cy.minZoom() < 0.1'));
  await evaluate('update(); cy.fit(cy.elements(),36); void 0');
  assert(await evaluate('Math.abs(cy.minZoom()/cy.zoom()-0.75)<0.00001'));
  assert(await evaluate(`(()=>{const b=cy.elements().renderedBoundingBox();return b.x1>=35&&b.y1>=35&&b.x2<=cy.width()-35&&b.y2<=cy.height()-35})()`));

  // Enlarging a graph must not change a valid existing viewport.
  await evaluate('cy.zoom(0.5);cy.pan({x:123,y:234});window.before=cy.minZoom();cy.getElementById("399").position({x:1000000,y:1000000}); void 0');
  await until('cy.minZoom() < window.before');
  assert.equal(await evaluate('cy.zoom()'),0.5);
  assert.deepEqual(await evaluate('cy.pan()'),{x:123,y:234});
  assert(await evaluate('percent(cy.minZoom()) > 0 && percent(cy.minZoom()) < 1'));

  // Container resizing updates limits without fitting the graph.
  await evaluate('window.before=cy.minZoom();document.getElementById("graph").style.height="300px"');
  await until('cy.minZoom() < window.before');
  assert.equal(await evaluate('cy.zoom()'),0.5);
  assert.deepEqual(await evaluate('cy.pan()'),{x:123,y:234});

  // Pinned nodes preserve a zoom below the new minimum when the graph shrinks.
  await evaluate('cy.getElementById("0").data("pinned",true);cy.zoom(cy.minZoom());window.pinnedViewport={zoom:cy.zoom(),pan:cy.pan()};cy.getElementById("399").position({x:100,y:100});void 0');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.deepEqual(await evaluate('({zoom:cy.zoom(),pan:cy.pan()})'),await evaluate('window.pinnedViewport'));
  await evaluate('cy.getElementById("0").data("pinned",false);void 0');

  // Filtering out distant nodes clamps only an out-of-range zoom.
  await evaluate('cy.zoom(cy.minZoom());cy.nodes().not("#0").remove(); void 0');
  await until('cy.minZoom()===0.1 && cy.zoom()===0.1');
  await evaluate('cy.nodes().remove(); void 0');
  await until('cy.minZoom()===0.1');
  assert(await evaluate('Number.isFinite(cy.zoom())'));
  await evaluate('window.stop();cy.destroy(); void 0');
  console.log('Adaptive graph zoom: large-graph fit, 25% margin, sub-1% zoom, viewport preservation, resize, filtering and empty graph passed.');
} finally {
  await session?.close();
  await server.close();
}

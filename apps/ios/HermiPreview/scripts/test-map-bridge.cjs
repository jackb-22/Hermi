// Behavioral contract checks against the actual bundled map script, without network/tiles.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const html = fs.readFileSync('Sources/HermiDesign/Resources/map.html','utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n');
const nodes = new Map(), messages=[], markers=[];
function node(){return {style:{setProperty(k,v){this[k]=v}},classList:{remove(k){this.removed=k}},removeAttribute(k){delete this.attributes[k]},value:'0.5',attributes:{},listeners:{},setAttribute(k,v){this.attributes[k]=v},append(){},addEventListener(k,f){this.listeners[k]=f}}}
const document={documentElement:node(),activeElement:null,getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},querySelector(id){return this.getElementById(id)},createElement:node,createElementNS:node};
let map;
class MapStub {
 constructor(options){map=this;this.options=options;this.events={};this.sources={};this.layers={};this.images={};this.rendered=[];this.touchZoomRotate={disableRotation(){}};}
 on(k,f){this.events[k]=f;return this} addControl(){} addLayer(layer){this.layers[layer.id]=layer} resize(){} areTilesLoaded(){return true}
 addSource(k,v){this.sources[k]={data:v.data,setData(d){this.data=d}}} getSource(k){return this.sources[k]}
 zoomIn(){this.lastZoom='in'} zoomOut(){this.lastZoom='out'}
 panBy(offset){this.lastPan=offset} fitBounds(b,o){this.lastFit={b,o}}
 hasImage(id){return !!this.images[id]} addImage(id,image,options){this.images[id]={image,options}} queryRenderedFeatures(){return this.rendered}
 getContainer(){return {clientWidth:400,clientHeight:800}} getCanvas(){return {width:1200,height:2400,clientWidth:400,clientHeight:800}}
 getBounds(){return {getWest:()=>-73.97,getSouth:()=>40.80,getEast:()=>-73.96,getNorth:()=>40.81}} getZoom(){return 15.1}
 project(point){return this.projectOverride?this.projectOverride(point):{x:200,y:350}} unproject(p){this.lastUnproject=p;return {lng:-73.9654,lat:40.8073}}
}
class MarkerStub {
 constructor(options){this.options=options;this.handlers={};markers.push(this)} setLngLat(c){this.point={lng:c[0],lat:c[1]};return this} getLngLat(){return this.point}
 addTo(){return this} on(k,f){this.handlers[k]=f;return this} remove(){this.removed=true}
}
const context={document,console,setTimeout,clearTimeout,hermiPalette:{ink:'#203D39',paper:'#F8FAF3',green:'#23856B',lime:'#BFDE59',lake:'#69B7CC'},webkit:{messageHandlers:{hermi:{postMessage(m){messages.push(m)}}}},addEventListener(){},maplibregl:{Map:MapStub,Marker:MarkerStub,AttributionControl:class{},LngLatBounds:class{constructor(a,b){this.sw=[...a];this.ne=[...b]}extend(c){this.sw=[Math.min(this.sw[0],c[0]),Math.min(this.sw[1],c[1])];this.ne=[Math.max(this.ne[0],c[0]),Math.max(this.ne[1],c[1])];return this}}}};
context.window=context;vm.createContext(context);vm.runInContext(scripts,context);
context.commandHermi({id:'early',action:'drop',x:0.5,y:0.5});assert.equal(messages.at(-1).type,'dropRejected');
map.events.load();
assert.equal(JSON.stringify(map.options.maxBounds),"[[-74.34,40.44],[-73.62,40.98]]");assert.equal(map.options.minZoom,9);
{const v=messages.find(m=>m.type==='viewport');assert.ok(v);assert.deepEqual(Array.from(v.bounds),[-73.97,40.80,-73.96,40.81]);assert.equal(v.zoom,15.1);
 map.events.moveend();const s=messages.at(-1);assert.equal(s.type,'stopped');assert.equal(s.bounds.length,4)}
context.commandHermi({id:'drop-1',action:'drop',x:0.5,y:0.5});
assert.deepEqual(Array.from(map.lastUnproject),[200,400]);assert.equal(messages.at(-1).requestID,'drop-1');
context.commandHermi({id:'outside',action:'drop',x:1.2,y:0.5});assert.equal(messages.at(-1).type,'dropRejected');
const pin={id:'pin-1',category:'Food',lng:-73.9654,lat:40.8073,radiusMiles:1,color:'#EF8067',rows:[' III ','IFFFI',' III ']};
const payload={places:[],social:false,discovery:pin,editingDiscovery:true,bottomInset:300};
context.renderHermi(payload);const marker=markers.at(-1);assert.equal(marker.options.draggable,true);assert.equal(nodes.get('pin-editor').style.display,'block');
context.renderHermi({...payload,discovery:{...pin,radiusMiles:2}});assert.equal(markers.at(-1),marker);assert.equal(nodes.get('radius-value').textContent,'2 mi');
marker.handlers.dragstart();marker.setLngLat([-73.96,40.81]);marker.handlers.dragend();assert.equal(messages.at(-1).type,'pinMove');assert.equal(messages.at(-1).id,'pin-1');
// Native validation rejects the move and returns its previous coordinate, same stable marker.
context.renderHermi({...payload,revision:1});assert.equal(marker.getLngLat().lng,pin.lng);assert.equal(marker.removed,undefined);
nodes.get('pin-radius').value=String(Math.log(10)/Math.log(40));nodes.get('pin-radius').listeners.input();assert.ok(Math.abs(messages.at(-1).miles-1)<1e-9);
marker.handlers.dragstart();marker.setLngLat([-73.9,40.9]);marker.options.element.listeners.pointercancel();marker.handlers.dragend();
assert.equal(messages.at(-1).type,'pinDragCancelled');assert.equal(marker.getLngLat().lng,pin.lng);
nodes.get('pin-remove').onclick({stopPropagation(){}});assert.equal(messages.at(-1).type,'pinRemove');
context.renderHermi({places:[],social:false});assert.equal(marker.removed,true);assert.equal(nodes.get('pin-editor').style.display,'none');
// Tap-away hides editing without removing pin or recommendations.
context.renderHermi({...payload,places:[{id:'cafe',name:'Cafe',color:'#EF8067',lng:-73.965,lat:40.807}]});
const dots=()=>map.getSource('places').data.features;
assert.equal(dots().length,1);assert.equal(dots()[0].properties.id,'cafe');
assert.equal(dots()[0].properties.icon,'dot-#EF8067');assert.equal(map.images['dot-#EF8067'].image.width,6);
map.events.click({point:{x:10,y:10}});assert.equal(messages.at(-1).type,'mapTap');
assert.equal(nodes.get('pin-editor').style.display,'none');assert.equal(nodes.get('pin-remove').style.display,'none');
assert.equal(dots().length,1);assert.equal(map.getSource('discovery-radius').data.features.length,0);
// A tap on a dot opens that place instead of tapping away.
map.rendered=[{properties:{id:'cafe'},geometry:{coordinates:[-73.965,40.807]}}];
map.events.click({point:{x:200,y:350}});assert.equal(messages.at(-1).type,'place');assert.equal(messages.at(-1).id,'cafe');map.rendered=[];
context.renderHermi({...payload,editingDiscovery:true,bottomInset:520});
assert.equal(nodes.get('pin-editor').style.bottom,'656px');assert.equal(nodes.get('pin-remove').style.display,'block');
for(const [value,expected] of [['0',0.1],['1',4]]){nodes.get('pin-radius').value=value;nodes.get('pin-radius').listeners.input();assert.equal(messages.at(-1).miles,expected)}
console.log('Map bridge passed: dots, tap-away, panel clearance, 0.1–4 radius, readiness, CSS coordinate scaling, bounds, stable drag marker, rejected-move restore, radius and remove.');

// Multiple pins retain marker identities and individual values without redundant badges.
const food2={...pin,id:'food-2',lng:-73.963,radiusMiles:0.1};
const nature={...pin,id:'nature-1',category:'Nature',lng:-73.962,radiusMiles:4};
const multi={...payload,discoveries:[pin,food2,nature],discovery:pin,editingDiscovery:true};
context.renderHermi(multi);
const live=()=>markers.filter(m=>m.options.draggable&&!m.removed);
assert.equal(live().length,3);
const firstMarker=live().find(m=>m.pinID===pin.id), secondMarker=live().find(m=>m.pinID===food2.id);
context.renderHermi({...multi,discovery:food2});assert.equal(nodes.get('radius-value').textContent,'0.1 mi');
assert.equal(live().find(m=>m.pinID===pin.id),firstMarker);
nodes.get('pin-radius').value='1';nodes.get('pin-radius').listeners.input();assert.equal(messages.at(-1).id,food2.id);
// Move prior representative off screen: badge transfers to visible same-category pin.
map.projectOverride=p=>({x:p.lng===pin.lng?-100:200,y:350});map.events.move();
map.events.click();context.renderHermi({...multi,discovery:undefined,editingDiscovery:false});assert.equal(live().length,3);
assert.equal(nodes.get('pin-editor').style.display,'none');
context.renderHermi({...multi,discoveries:[pin,nature],discovery:nature});
assert.equal(secondMarker.removed,true);assert.equal(live().length,2);assert.equal(nodes.get('radius-value').textContent,'4 mi');
console.log('Multi-pin bridge passed: identities, independent selection, radius target, deselection, removal without duplicate badges.');

// Social uses explicit supplied sharing data; Solo removes routes and markers.
const socialMarkers=[{id:'sam-now',kind:'current',name:'Sample shared current place',lng:-73.9654,lat:40.8073},{id:'riley-love',kind:'loved',name:'Sample loved place',lng:-73.967,lat:40.808}];
const socialRoutes=['current','loved'].map(kind=>({type:'Feature',properties:{kind},geometry:{type:'LineString',coordinates:[[-73.96,40.80],[-73.97,40.81]]}}));
context.renderHermi({places:[],social:true,socialMarkers,socialRoutes});
assert.equal(map.getSource('social-routes').data.features.length,2);
assert.deepEqual(Array.from(map.layers['social-current'].paint['line-dasharray']),[1,2]);
assert.equal(map.layers['social-loved'].paint['line-dasharray'],undefined);
const friends=markers.filter(m=>m.options.element.className.startsWith('friend ')&&!m.removed);
assert.equal(friends.length,2);assert.equal(friends[0].getLngLat().lng,socialMarkers[0].lng);
friends[0].options.element.onclick({stopPropagation(){}});assert.equal(messages.at(-1).type,'socialInfo');
context.renderHermi({places:[],social:true,socialMarkers,socialRoutes,reduceMotion:true});
assert.equal(document.documentElement.className,'reduce-motion');
context.renderHermi({places:[],social:false,socialMarkers,socialRoutes});
assert.equal(map.getSource('social-routes').data.features.length,0);
assert.ok(friends.every(m=>m.removed));
assert.ok(!html.includes('control-tip'));assert.ok(!html.includes('held=false'));
console.log('Social bridge passed: dotted/solid routes, explicit marker coordinates, Solo clearing, Reduce Motion, and no hold tips.');

// Feed routes: the line goes on the route layer, stops are numbered markers, the camera fits once per route.
const route={line:[[-73.965,40.806],[-73.967,40.808],[-73.963,40.81]],stops:[{index:1,lng:-73.965,lat:40.806,color:'#EF8067'},{index:2,lng:-73.963,lat:40.81,color:'#23856B'}]};
context.renderHermi({places:[],social:false,route});
assert.equal(map.getSource('adventure').data.features[0].geometry.coordinates.length,3);
const stops=markers.filter(m=>m.options.element.className==='route-stop'&&!m.removed);
assert.equal(stops.length,2);assert.equal(stops[1].options.element.textContent,'2');
assert.deepEqual(Array.from(map.lastFit.b.sw),[-73.967,40.806]);assert.deepEqual(Array.from(map.lastFit.b.ne),[-73.963,40.81]);
map.lastFit=null;context.renderHermi({places:[],social:false,route});assert.equal(map.lastFit,null);
context.renderHermi({places:[],social:false});
assert.equal(map.getSource('adventure').data.features.length,0);assert.ok(stops.every(m=>m.removed));
console.log('Route bridge passed: feed route line, numbered stops, fit once, clear.');

// Profile Adventures: explored tiles replace the sample route and fit once.
context.renderHermi({places:[],social:false,adventure:true,tiles:[[77210,98474],[77211,98471]]});
assert.equal(map.getSource('explored').data.features.length,2);
assert.equal(map.getSource('adventure').data.features.length,0);
assert.ok(map.lastFit.b.sw[0]<-73.9&&map.lastFit.b.sw[1]>40.7);
assert.equal(nodes.get('.notice').textContent,'EXPLORED · 2 TILES');
context.renderHermi({places:[],social:false,adventure:true});
assert.equal(map.getSource('explored').data.features.length,0);assert.equal(map.getSource('adventure').data.features.length,1);
console.log('Explored bridge passed: tiles as squares, sample route hidden, fit, label.');

// Live Social: planned/done lines, steady recent marker, quest marker, live label.
const liveRoutes=[{type:'Feature',properties:{kind:'planned'},geometry:{type:'LineString',coordinates:[[-73.96,40.80],[-73.97,40.81]]}},{type:'Feature',properties:{kind:'done'},geometry:{type:'LineString',coordinates:[[-73.95,40.80],[-73.96,40.80]]}}];
const liveMarkers=[{id:'friend:1',kind:'recent',name:'jenny at Book Culture',lng:-73.965,lat:40.806},{id:'open:p',kind:'quest',name:'Open plan: X',lng:-73.96,lat:40.80}];
context.renderHermi({places:[],social:true,socialMarkers:liveMarkers,socialRoutes:liveRoutes,socialLabel:'SOCIAL · 1 OUT · 1 PLAN · CHECK-INS, NOT LIVE GPS'});
assert.deepEqual(Array.from(map.layers['social-planned'].paint['line-dasharray']),[1,2]);assert.equal(map.layers['social-done'].paint['line-dasharray'],undefined);
assert.equal(map.getSource('social-routes').data.features.length,2);
const liveSocial=markers.filter(m=>!m.removed&&m.options.element.className.startsWith('friend '));
assert.deepEqual(liveSocial.map(m=>m.options.element.className),['friend recent','friend quest']);
assert.equal(nodes.get('.notice').textContent,'SOCIAL · 1 OUT · 1 PLAN · CHECK-INS, NOT LIVE GPS');
liveSocial[1].options.element.onclick({stopPropagation(){}});assert.equal(messages.at(-1).type,'socialInfo');assert.equal(messages.at(-1).id,'open:p');
console.log('Live social bridge passed: planned/done lines, recent and quest markers, live label, tap.');


assert.ok(html.includes(".pin{z-index:20"));
assert.ok(html.includes("pointer-events:none!important;z-index:1"));
assert.equal(markers.filter(m=>m.options.element.className==='landmark').length,14);
assert.ok(!html.includes("category-indicator"));

// Zoom response is bounded and decluttering keeps overlapping decorative art apart.
const sights=markers.filter(m=>m.options.element.className==='landmark');
map.getZoom=()=>16;map.events.zoom();
const closeWidth=parseInt(sights[0].options.element.style.width);
map.getZoom=()=>11;map.events.zoom();
const farWidth=parseInt(sights[0].options.element.style.width);
assert.equal(closeWidth,52);assert.equal(farWidth,65);
assert.equal(sights.filter(m=>m.options.element.style.display==='block').length,1);
map.projectOverride=p=>({x:200,y:400+(p.lat-40.75)*3000});map.events.move();
assert.ok(sights.filter(m=>m.options.element.style.display==='block').length>1);
map.getZoom=()=>9;map.events.zoom();assert.equal(parseInt(sights[0].options.element.style.width),65);
map.getZoom=()=>19;map.events.zoom();assert.equal(parseInt(sights[0].options.element.style.width),52);
map.projectOverride=null;
console.log('Landmark bridge passed: 14 sights, bounded inverse zoom sizing, overlap suppression, pan updates.');

assert.equal(nodes.get('.maplibregl-ctrl-attrib').classList.removed,'maplibregl-compact-show');
context.commandHermi({action:'in'});assert.equal(map.lastZoom,'in');
context.commandHermi({action:'out'});assert.equal(map.lastZoom,'out');
context.renderHermi({...payload,bottomInset:308});
assert.equal(document.documentElement.style['--controls-bottom'],'308px');
context.renderHermi({...payload,bottomInset:110});
assert.equal(document.documentElement.style['--controls-bottom'],'110px');
console.log('Map chrome passed: zoom commands, initially collapsed credits, overlay-aware credit positioning.');

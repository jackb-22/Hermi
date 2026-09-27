// Behavioral contract checks against the actual bundled map script, without network/tiles.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const html = fs.readFileSync('Sources/HermiDesign/Resources/map.html','utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n');
const nodes = new Map(), messages=[], markers=[];
function node(){return {style:{setProperty(){}},value:'0.5',attributes:{},listeners:{},setAttribute(k,v){this.attributes[k]=v},append(){},addEventListener(k,f){this.listeners[k]=f}}}
const document={documentElement:node(),activeElement:null,getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},querySelector(id){return this.getElementById(id)},createElement:node,createElementNS:node};
let map;
class MapStub {
 constructor(){map=this;this.events={};this.sources={};this.layers={};this.touchZoomRotate={disableRotation(){}};}
 on(k,f){this.events[k]=f;return this} addControl(){} addLayer(layer){this.layers[layer.id]=layer} resize(){} areTilesLoaded(){return true}
 addSource(k,v){this.sources[k]={data:v.data,setData(d){this.data=d}}} getSource(k){return this.sources[k]}
 panBy(offset){this.lastPan=offset}
 getContainer(){return {clientWidth:400,clientHeight:800}} getCanvas(){return {width:1200,height:2400,clientWidth:400,clientHeight:800}}
 getBounds(){return {getWest:()=>-73.97,getSouth:()=>40.80,getEast:()=>-73.96,getNorth:()=>40.81}} getZoom(){return 15.1}
 project(point){return this.projectOverride?this.projectOverride(point):{x:200,y:350}} unproject(p){this.lastUnproject=p;return {lng:-73.9654,lat:40.8073}}
}
class MarkerStub {
 constructor(options){this.options=options;this.handlers={};markers.push(this)} setLngLat(c){this.point={lng:c[0],lat:c[1]};return this} getLngLat(){return this.point}
 addTo(){return this} on(k,f){this.handlers[k]=f;return this} remove(){this.removed=true}
}
const context={document,console,setTimeout,clearTimeout,hermiPalette:{ink:'#203D39',paper:'#F8FAF3',green:'#23856B',lime:'#BFDE59',lake:'#69B7CC'},webkit:{messageHandlers:{hermi:{postMessage(m){messages.push(m)}}}},addEventListener(){},maplibregl:{Map:MapStub,Marker:MarkerStub,AttributionControl:class{}}};
context.window=context;vm.createContext(context);vm.runInContext(scripts,context);
context.commandHermi({id:'early',action:'drop',x:0.5,y:0.5});assert.equal(messages.at(-1).type,'dropRejected');
map.events.load();
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
const dot=markers.findLast(m=>m.options.element.className==='recommendation');
assert.ok(dot);assert.equal(dot.options.anchor,'center');
map.events.click();assert.equal(messages.at(-1).type,'mapTap');
assert.equal(nodes.get('pin-editor').style.display,'none');assert.equal(nodes.get('pin-remove').style.display,'none');
assert.equal(dot.removed,undefined);assert.equal(map.getSource('discovery-radius').data.features.length,0);
context.renderHermi({...payload,editingDiscovery:true,bottomInset:520});
assert.equal(nodes.get('pin-editor').style.bottom,'656px');assert.equal(nodes.get('pin-remove').style.display,'block');
for(const [value,expected] of [['0',0.1],['1',4]]){nodes.get('pin-radius').value=value;nodes.get('pin-radius').listeners.input();assert.equal(messages.at(-1).miles,expected)}
console.log('Map bridge passed: dots, tap-away, panel clearance, 0.1–4 radius, readiness, CSS coordinate scaling, bounds, stable drag marker, rejected-move restore, radius and remove.');

// Multiple pins retain marker identities, individual values and one visible badge per category.
const food2={...pin,id:'food-2',lng:-73.963,radiusMiles:0.1};
const nature={...pin,id:'nature-1',category:'Nature',lng:-73.962,radiusMiles:4};
const multi={...payload,discoveries:[pin,food2,nature],discovery:pin,editingDiscovery:true};
context.renderHermi(multi);
const live=()=>markers.filter(m=>m.options.draggable&&!m.removed);
assert.equal(live().length,3);
const firstMarker=live().find(m=>m.pinID===pin.id), secondMarker=live().find(m=>m.pinID===food2.id);
assert.equal(live().filter(m=>m.categoryBadge.style.display==='block').length,2);
assert.equal(firstMarker.categoryBadge.style.display,'block');assert.equal(secondMarker.categoryBadge.style.display,'none');
context.renderHermi({...multi,discovery:food2});assert.equal(nodes.get('radius-value').textContent,'0.1 mi');
assert.equal(live().find(m=>m.pinID===pin.id),firstMarker);
nodes.get('pin-radius').value='1';nodes.get('pin-radius').listeners.input();assert.equal(messages.at(-1).id,food2.id);
// Move prior representative off screen: badge transfers to visible same-category pin.
map.projectOverride=p=>({x:p.lng===pin.lng?-100:200,y:350});map.events.move();
assert.equal(firstMarker.categoryBadge.style.display,'none');assert.equal(secondMarker.categoryBadge.style.display,'block');
map.projectOverride=null;map.events.move();assert.equal(secondMarker.categoryBadge.style.display,'block');
map.events.click();context.renderHermi({...multi,discovery:undefined,editingDiscovery:false});assert.equal(live().length,3);
assert.equal(nodes.get('pin-editor').style.display,'none');
context.renderHermi({...multi,discoveries:[pin,nature],discovery:nature});
assert.equal(secondMarker.removed,true);assert.equal(live().length,2);assert.equal(nodes.get('radius-value').textContent,'4 mi');
console.log('Multi-pin bridge passed: identities, independent selection, radius target, deselection, removal and sticky visible category badges.');

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

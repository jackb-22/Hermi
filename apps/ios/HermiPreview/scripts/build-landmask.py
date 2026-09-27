#!/usr/bin/env python3
"""Build a pinned, offline NYC placement mask from official downloaded GeoJSON.
Usage: python3 scripts/build-landmask.py .build/landmask-source
No runtime download, third-party Python package, or backend dependency.
"""
import hashlib, json, math, sys
from pathlib import Path

# ~1 metre precision; retain every ring/hole. Boundary decisions are approximate.
EPSILON = 0.00001

def simplify(points):
    if len(points) < 5:
        return points
    keep = {0, len(points)-1}
    stack = [(0, len(points)-1)]
    while stack:
        start, end = stack.pop()
        ax, ay = points[start][:2]; bx, by = points[end][:2]
        dx, dy = bx-ax, by-ay
        denominator = dx*dx+dy*dy
        distance, index = 0, start
        for i in range(start+1, end):
            px, py = points[i][:2]
            t = max(0, min(1, ((px-ax)*dx+(py-ay)*dy)/denominator)) if denominator else 0
            d = (px-ax-t*dx)**2+(py-ay-t*dy)**2
            if d > distance: distance, index = d, i
        if distance > EPSILON**2:
            keep.add(index); stack.extend(((start,index),(index,end)))
    result = [points[i] for i in sorted(keep)]
    return result if len(result) >= 4 else points

def polygons(path):
    data = json.loads(path.read_text())
    output=[]
    for f in data['features']:
        geometry=f['geometry']
        if geometry is None: raise ValueError('Missing geometry')
        ps = [geometry['coordinates']] if geometry['type']=='Polygon' else geometry['coordinates']
        if geometry['type'] not in ('Polygon','MultiPolygon'): raise ValueError('Unexpected geometry')
        for polygon in ps:
            output.append([[[round(p[0],7),round(p[1],7)] for p in simplify(ring)] for ring in polygon])
    return output,len(data['features'])

source=Path(sys.argv[1])
land,land_count=polygons(source/'boroughs.geojson')
water,water_count=polygons(source/'water.geojson')
assert land_count==5 and water_count==2206, 'Check upstream dataset changes before regenerating'
out=Path('Sources/HermiDesign/Resources/nyc-landmask.json')
out.write_text(json.dumps({'version':'2026-09-27','land':land,'water':water},separators=(',',':'))+'\n')
print('Bundled',len(land),'land polygons and',len(water),'water polygons;',out.stat().st_size,'bytes')
for name in ('boroughs','water'):
    p=source/(name+'.geojson')
    print(name,hashlib.sha256(p.read_bytes()).hexdigest())

# Offline NYC pin-placement mask

Snapshot retrieved 2026-09-27. Frontend-only placement aid; does not verify presence, ownership, public access or backend check-in eligibility.

Sources (NYC Open Data):
- DCP Borough Boundaries, water areas excluded, version 26b, dataset gthc-hcne: https://data.cityofnewyork.us/City-Government/Borough-Boundaries/gthc-hcne
- OTI NYC Planimetric Database: Hydrography, dataset pjs3-c3z5: https://data.cityofnewyork.us/Environment/NYC-Planimetric-Database-Hydrography/pjs3-c3z5

Five borough features (117 polygons) and 2,206 water features. All polygon holes retained. Hydrography excludes inland lakes/reservoirs in addition to the borough shoreline. Coordinates are WGS84 [longitude, latitude]. The script simplifies rings at 0.00001 degrees (~1 metre) and rounds to seven decimal places. Shoreline decisions are approximate; bridges over water are excluded. This is not a navigability dataset.

Raw SHA-256:
- boroughs.geojson: 7aa44d9fb611f2f518a226ff994a6516a261a8ce982ccf1e7b37d663687f443c
- water.geojson: afe97cf37886177c940cc43937638045a5abe2a8bc3f7bc2adb96908297ff4d9

Bundled output: nyc-landmask.json, 4,602,585 bytes. Source files are ignored build inputs under .build/landmask-source. Rebuild with `python3 scripts/build-landmask.py .build/landmask-source` from apps/ios/HermiPreview. Script verifies source feature counts; review upstream changes before replacing this snapshot.

Validation is offline, requires both land and water resources, and fails closed if the resource cannot be decoded. Bounding boxes narrow polygon tests. No third-party runtime GIS dependency or backend edits.

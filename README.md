# 📡 Scan Academy — laser scanning field training game

A browser game that teaches surveying students the real workflow of terrestrial
laser scanning. No build step, no dependencies — open `index.html` in a browser
(or serve the folder with any static server, e.g. `python3 -m http.server`).

## The four phases

1. **Prepare** — pack the van. It has only **8 slots** for 12 items, so it is
   easy to accidentally leave something on the storage shelf. Left-behind kit
   has real consequences on site:
   - no scanner → no work at all (blocked, with a way back)
   - no tripod → handheld scans are shaken
   - no SD card → scanner memory holds only 4 scans
   - no spare batteries → 100% battery only; each scan drains 14% and you must
     press **🔋 Swap spare battery** to use a spare
   - no PPE → site safety locks the door to outside
   - no weather cover → rainy outside scans come out shaken
   - no target ID labels → cannot label targets in phase 3
   - no laptop / no cables → registration penalties

2. **Field work** — top view of an industrial hall (concrete pillars) with a
   door to a rainy yard. Total-station targets T1–T6 are already placed.
   - **Drag the scanner with the mouse**, press **SCAN** (or Space) — a small
     rotating sweep animation plays, points appear as the beam passes.
   - Scanning from one spot leaves **shadows** behind concrete structures —
     there is *no UI hint*; the gaps are only visible in the accumulated cloud.
   - **Targets are only seen with line of sight**, in some scans only — they
     form the skeleton, so scans must overlap densely for cloud-to-cloud
     registration.
   - Scanning **outside** without linking inside↔outside clouds lets
     temperature-driven air refraction drift the indoor cloud (~28 mm error).
   - The **compressor vibrates**: scans near it (or uncovered rain scans) are
     *shaken* (bad) — you must spot and exclude them later.

3. **Registration** (top view, sequential) — **no floor plan is shown** (that
   is not visible in the real world either): only point clouds + control targets.
   - Only the **joined network** (drawn as one merged pale-blue "registered
     cloud") and the **one selected unregistered scan** are visible at a time.
   - **Scan 1 is already placed** as the reference frame — no snapping into the
     real world. Set it as base after labeling its targets.
   - Pick which scan joins next in the list (if the selected one is from a
     totally different location with no overlap, choose another), drag its
     cloud until it matches the registered cloud (coarse, snaps ✔), label the
     targets it sees, then **Register to network** (animated fine
     cloud-to-cloud ICP).
   - A join needs **enough shared surfaces** (≥25 shared surface cells and
     ≥20% of the smaller cloud) — otherwise there is no cloud-to-cloud
     connection and the join is refused.
   - **Targets must be named before a scan can be registered**: a checklist
     above the button shows what's missing, the button stays disabled with the
     reason, needed targets get ⚠ rows in the target list, an inline T1–T6
     chooser per target, and a pulsing ring on the canvas.
   - Tick **"bad scan"** for shaken scans — they can never join. Uncoarsely
     aligned joins get "ICP did not converge" (+18 mm).
   - When every good scan is in the network, **✔ Finish registration** computes
     residuals and accuracy.

4. **Report** — a top-view canvas of the final registered cloud (merged cloud,
   green connection lines, numbered stations, excluded scans in gray, targets
   flagged ✔/✘ with assigned IDs) plus the written report: scan table with
   residuals, connection list, target ID check, coverage %, estimated accuracy
   in mm, equipment not packed. **Deliver to the customer** → score (0–100,
   ★–★★★) with feedback on every learning point.

## Files

```
index.html      screens & layout
css/style.css   styling
js/data.js      map, targets, equipment
js/utils.js     geometry (ray/segment intersection, line of sight)
js/prep.js      phase 1
js/field.js     phase 2 (raycast scan simulation, battery, coverage, link graph)
js/register.js  phase 3 (sequential pairwise registration)
js/report.js    phase 4 (report canvas + document + scoring)
js/main.js      state + screen manager + main loop
```

## Simulation notes

- 360 rays per scan against all wall segments (analytic ray/segment
  intersection); 1 px = 5 cm.
- Coverage is measured on discretized surface cells (12 px grid); a scan covers
  the cells its points fall in (3×3 neighbourhood), counted only on real
  surfaces.
- Scan-to-scan links (cloud-to-cloud) require ≥25 exactly shared surface cells
  AND ≥20% of the smaller cloud's cells.
- Shaken scans (compressor vibration zone, rain without cover, no tripod) get
  extra point noise and a residual penalty if left in the network.
- Registration residuals (mm): base noise 0.8–2.5, shaken +6–14, ICP
  non-convergence (no coarse alignment) +18, no inside↔outside link +28 mm
  refraction drift on indoor scans, wrong/missing target IDs +6 mm each,
  no laptop +4, no cables +3. Accuracy = mean residual + ID penalty.

# Scan Academy — laser scanning field training game

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
   - no rain umbrella → outdoor scans get a wet window (noisy, bad scan)
   - no target ID labels → targets cannot be named in registration

2. **Field work** — top view of an industrial hall (concrete pillars) with a
   door to a rainy yard. Total-station control targets T1–T6 are already placed.
   - **Drag the scanner**, press **SCAN** (or Space). Invalid spots (inside
     objects, against a wall, outside without PPE) snap back to the last valid
     position; scanning is validated too.
   - Scanning from one spot leaves **shadows** behind concrete — no UI hint.
   - Targets are recognised only with line of sight and within 18 m.
   - **Compressor vibration** → angular wobble (error grows with range);
     **no tripod** → random-walk drift. Both make a *bad* scan.
   - **Rain** (everywhere outside the hall roof): some beams hit droplets →
     short-range ghost points, even with an umbrella. **No umbrella** → wet
     window → blurred, noisy (bad) scan. **With umbrella** → its tripod clamp
     shadows a narrow sector of every outdoor scan (scan that spot from elsewhere).

3. **Registration** — works like real registration software.
   - Every scan arrives shifted and rotated in its own frame. The **targets it
     recognised (◆) move with the scan**. Control points (✛) are the known
     total-station coordinates.
   - **Name the targets in each scan** (click ◆). A name ties the scan to that
     control point — and through it to every other scan that saw it.
   - **Cloud-to-cloud links** between overlapping scans (ICP). ICP only
     converges if the pair is already roughly aligned (drag, wheel / Q E to
     rotate, or register by targets first); from > 3 m it fails, from
     0.8–3 m it converges to a wrong local minimum (high ICP RMS).
   - **Run registration** = least-squares adjustment (Gauss–Newton) over all
     scans. Each constraint gets an error; redundancy is shown. Untick bad
     constraints, fix names, tick *bad* for bad scans, run again.
   - **The lesson**: a wrongly named target pulls its scan to the wrong place.
     With cross-registration (redundancy) it shows up as a red error; in a
     plain chain / single-target scan it is invisible — errors look green.

4. **Report** — the customer checks against an independent survey: for every
   scan the **reported** error is shown next to the **true** error, the cloud is
   coloured by true error, wrong target names are listed. **Score (0–100) =
   how much of the site was delivered at the required accuracy**: usable
   coverage 70 (only scans within the 10 mm requirement count; ~95 % = full)
   + accuracy 30 (full at ≤ 10 mm, 0 at 30 mm). Everything else (wrong names,
   missing redundancy, bad scans, forgotten kit) is explained as the *reason*
   coverage or accuracy was lost; kit that stayed at the office is listed
   neutrally, and only if it had a consequence.

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

- 360 rays per scan against all segments (analytic ray/segment intersection);
  1 px = 5 cm, range 26 m.
- Coverage: discretised surface cells (12 px) of walls, pillars, machine and
  yard objects (not the site fence); counted from registered scans whose true
  error is ≤ 50 mm.
- Cloud-to-cloud overlap requires ≥ 25 shared surface cells AND ≥ 20 % of the
  smaller cloud; 5 well-spread shared points act as ICP tie points.
- Adjustment unknowns: (dx, dy, rotation) per scan. With ≥ 2 named control
  points the network is georeferenced; otherwise scan 1 is the datum and equal
  names only tie scans to each other. Scans with < 3 equations are flagged
  under-constrained.

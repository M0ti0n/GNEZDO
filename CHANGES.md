# Changes by test build

Newest first. Each build is the `test-build` release; earlier builds (up to 7 Nov 2026) were made on every change to main.

## Next build

- Laser Technology tables have a new column, **Laser · Trace shortest** (1 = on). It sets, per thickness, whether AUTO CUT traces first over the whole sheet in the order of the shortest rapids. A row with no value set is on from 4 mm up. On a laser, Settings → Machines → Cut order now points to this column instead of its checkbox; other machines keep the checkbox
- Settings → Machines has a **Rapid speed** (mm/min) for the time estimates in the Nest report and the Simulation. Empty: 15,000 mm/min on a plasma (measured: 2 m in 8 s), 20,000 mm/min on the others (before this, 20,000 for every machine)
- HACO plasma machine file: 25 mm pierce time 4 s (measured; it was 1.8 s), rapid speed 15,000 mm/min
- Technology tables are **locked** when opened, against changes by accident (no password). **Unlock all** (beside Import table) makes everything changeable, **Lock all** locks it again. A padlock on each row (beside its thickness) and on each column (under its name) unlocks only that row or column, shown green; Tab then goes only through the unlocked values. While locked, the name, material tags, thickness range, + Thickness, Delete row, Delete technology, + New and Import table cannot be used
- Remnant cutting order: the remnant's own cut lines first, then the hand cuts (CUT V / CUT H). A hand cut from a sheet edge to a remnant line now always starts at the sheet edge and ends on the remnant line already cut; one between two remnant lines (or edge to edge) starts at the end nearer the head. Before, a hand cut could be cut first, from the remnant line out to the edge, before the remnant line was cut
- Nest report: the sheet drawing shows the remnant (Process → Remnant): its pieces hatched with their names, its cuts. Remnant (kg / %) in the Nest report, the solution info and the nest export now count the remnant's pieces (not the discarded ones) when it is worked out, instead of the strip after the cut area
- NC programs: a point beyond the sheet's edge (a remnant cut with a negative Gap in / Gap out, meant to run off the plate) is now written beyond the edge. Before, it was folded back onto the sheet, so a −2 mm gap stopped the cut 2 mm short of the edge instead
- Settings → Machines → NC output: **Program name**, the NC file's name and the name inside the program. `{jobname}` is the job's name, `{#}` the sheet's number; empty = {jobname}_{#} as before. **Letters and digits only** leaves out spaces, _, - and other characters, for controls that refuse them. The HACO plasma machine file uses {jobname}P{#} with letters and digits only: job MIHA2280, sheet 1 → MIHA2280P1.NCP
- Technology table: light green vertical lines between the column groups (Cutting, Holes · leads, Outline · leads, ...), the color of the line under the group names
- Technology CSV export: a micro joint Length or Restart that was never set is written as 1 (what the app uses), not 0

## Build 13 Nov 2026 (`51c852d`)

**New**
- Settings → Machines → Cut order: **Tracing first, over the whole sheet, in the order of the shortest rapids** (off unless ticked, per machine). AUTO CUT then puts every trace line of the sheet before the cutting instead of part by part: from 0,0 the nearest line next, each cut from its nearer end, then shortened further where turning a stretch of the order round saves travel. Not used after an order picked by hand (Manual cut). The LVD postprocessor keeps that order (a part's marking may then come in more than one T2 placement)
- Settings → **Projects and parts** (instead of the Projects placeholder): every saved project and its parts.
  - Toolbar: Project search (code, name or customer), **Part name** search (lists the projects that have such a part; it also filters their parts), Created from / to, **Show projects without parts**, **Delete** (the ticked projects)
  - **Default project**: what parts imported with the project box left empty are offered (kept in this browser)
  - Left: the projects (check box, project with its name, the date on the right), sorted by name or date, up or down
  - Right: the picked project's parts with created, modified and the jobs they are used in; a job clicked opens it. Material and Thickness filters, part name search, sorted by name, created or modified. Right click a part: Properties… / Versions… (double click: Properties)
  - A project cannot be renamed; only a project **without parts** can be deleted (projects with parts cannot be ticked)
- **Every part is in a project**: Part properties will not save a part without one. Changing its project moves it (it leaves the old one); the list suggests projects as you type, and a new one can be saved there. If the target project already has a part with that name: **Replace** it (the one there is taken out; jobs that use it keep it), or Back / close the window and nothing changes
- Import: with the project box empty, Process offers the default project (Use the default project …), and Process all asks to save the parts under it; with no default project set, parts are not saved until a project is set
- Process → **Micro joint**: short places left uncut along a contour (outlines and holes), with no lead-in or lead-out: the cut stops before the joint and starts again after it. The joint's length comes from the Technology table (new columns **Micro joint: Length**, default 1 mm, and **Restart**: 0 no pierce, 1 pierce, 2 quick pierce) and can be changed in the panel. This part / all copies and MOVE at the top, Keep the original lead in / out, then the modes (on / off each, Esc: off):
  - MANUAL: click a contour where a joint goes; each joint gets a balloon MJ1, MJ2 … (hover: its length)
  - CORNERS: joints on the sharp corners towards the sheet's four corners (a round corner: its point that way); SIDES: on the middles of the sides towards the sheet's four sides. 4, or 3 when the original lead is kept (the one nearest it goes)
  - OPPOSITE SIDES X (top and bottom) / Y (left and right), OPPOSITE CORNERS X (towards the machine's 0,0 corner and the one across) / Y (the other two): two joints, the cut starting at one of them (the original lead goes)
  - A balloon clicked: picked, its length in the box (changed at once); DELETE takes it out (the last one: the contour's own lead comes back)
  - The directions are the sheet's whole four sides, whatever a shaped remnant's outline; with all copies each copy gets its own by its directions
  - NC: LVD laser: after a joint M98P8037 (quick pierce) when Restart is 2 (or 0, until the controller's way of starting without a pierce is known), else M98P8036; plasma pierces as always. POST PROCESSOR zips rebuilt
- **RESET** in Micro joint and Break cut is an on / off button: click a part and its micro joints and break cuts go, and its leads are the automatic cut's again (where it started; this part or all copies)
- Break cut balloons: hovering over one shows its gap
- Process → **Break cut** (laid out like Lead in / out): this part / all copies, MOVE, MODIFY EXISTING / ADD NEW, Keep the original lead in / out, the lead type (only the ones with a gap), the drawing with its values, Manual gap distance selection, RESET / APPLY / DELETE. A break is a lead with a negative gap: the cut stops that far short and leaves a bridge. ADD NEW + APPLY: a BC balloon on the pointer, dropped on an outline (the gap from the drawing, behind the point); with Manual gap distance selection two balloons, 1 where the cut stops and 2 where it starts again (2 always after 1 in the cut direction; the gap box is grayed out). Keep the original lead in / out: the outline is cut in pieces (a pierce each); off: the break takes the original lead's place. MODIFY EXISTING: click a lead or a balloon (its type and values come into the drawing), APPLY changes it. MOVE: click a balloon, then where it goes. Outlines with breaks are changed only in Break cut
- New lead type **Corner in, gap out** (sharp corners): in line at the corner, the gap, then out at an angle (90° by default), e.g. to break an outline at its original corner lead
- Lead in / out and Break cut: a **negative gap** shows light red (box and balloon); it does not stop anything
- Process → **Movement** (buttons with Fab's icons, arrows from lead-out to lead-in): SINGLE POINT: click a rapid move, then the point it should go through. MULTIPOINT: click a rapid move, then its points one by one, and close on a lead-in (the lead-ins it may go to are ringed; it snaps to them). Closing on another lead-in changes the cut order: from an outline, to another part (that part, whole, is cut next); from a hole or open cut, only to another hole or open cut of the same part. DELETE POINT (on / off): a click on a point takes it out (the rapid goes straight past it). Esc leaves the rapid as it was; STRAIGHT RAPIDS takes every point of the sheet out. Points show as blue dots, and are dropped when the contour before their rapid changes (cut order changed later). Written into the NC programs (plasma: G00 per point; laser: G0 per point at the start of the contour, the part then gets a subprogram of its own) and played in Simulation
- Import, part properties and sheets: **material and thickness only from the Technology tables**. The material list is the material tags of the machines' Technology tables (Settings → Machines → Technology), the thickness list the rows the tables have for that material (a table without tags takes any material, so the plasma's rows count for every material). Something typed that is not there is put back when the field is left. A part's or sheet's old material that is not in the tables stays until it is changed. With no material tags anywhere yet, anything can still be typed
- POST PROCESSOR → HACO-KOMPAKT-plasma zip: its two tables (80 A and 130 A, O2 / air) are tagged with the construction steels MS, S235, S355, St37-2, Mn12, Hardox (as the laser's O2 tables), so the plasma takes only those. An installed plasma gets them by importing the zip again (Replace) or adding the tags in Settings → Machines → Technology
- Process → Process del: **Delete selected** (on / off): while on, click parts on the open sheet to take their cut path away (they are not processed any more; a common cut block goes whole). UNDO DELETE now goes back one delete at a time
- Process → **Manual cut**: on a processed sheet, SELECT, then click contours in the order to cut them (a picked contour clicked again, SELECT on or off, or × on its row: out of the list, the ones after it move up). The list holds them in that order (drag, or Up / Down, to change it), each as its part's ID in the job part list and which copy of it on the sheet (12_3: part 12, third copy; the name on hover); the picked contours glow on the sheet, the one chosen in the list glows stronger (orange). PROCESS (at the top, as in Auto cut) puts them in the cut path in that order, in the places they had (the rest stays where it is; pick every contour to set the whole order). A part's outline cannot come before its own holes, marking or open cuts
- Process → **Simulation**: plays the open sheet's cut back. The parts keep their colors until they are cut out, then turn see-through; the path and the rapids show as far as the head (a red crosshair) has come. PLAY / PAUSE, STOP (back to the start), a playback bar to drag through it, a contour back / on, the speed 1× to 100×, and what is being cut now (part, contour, parts cut). Times from the Technology row's speeds and pierce time and 20 m/min rapids (an estimate). The Process tools are a little narrower so all eleven fit
- Process → **Lead in / out**: on an open sheet, click a lead (or its outline / hole) to pick it. MOVE: the first click picks a lead, the second puts it at the nearest point of the same contour (a sharp corner within 3 mm: on the corner). LEAD IN / OUT TYPE picks the type (the types of Leads & cutting); its values (lead-in, lead-out, angles, gap, radius, as the type uses them) are set in the drawing below and APPLY puts them on the picked lead. The drawing is not to scale: its lines show the directions, the boxes the values; the gap (blue) is always drawn, dashed when it stops short. RESET gives back the automatic cut's type and the Technology row's values, DELETE (red) makes it 0 / 0 (pierced on the contour). The toggle: this part only, or every copy of the part on the sheet (the same contour, the same point). Common cut blocks are not changed here
- **LVD laser postprocessor** and machine zip (POST PROCESSOR → LVD-AXEL-laser.gnezdo-machine.zip, Settings → Machines → Import machine): programs in the form of the laser's own (.CNC): the sheet and the technology program in the main program, each part a subprogram placed with G980 (parts cut the same way share one; a part's marking is a subprogram of its own, T2, and all marking comes before the first cut, so pre-pierce works with marking, also with a single marked part), E001 / E002 / E003 (big / middle / little by the contour's longer side) on every contour, E004 marking, pre-pierce. Technology tables MS, St37-2, SS and AL from the laser's tables (lead-in / lead-out, kerf, parts gap, sheet trim 5 mm, contour size limits, tech programs). Its 0,0 corner is set to bottom left: check it on the machine
- Settings → Machines → Technology, laser machines: **Laser** columns per thickness: Middle up to / Little up to (contour size classes), Pre-pierce (1 = pierce every contour first), Tech program (the machine's technology program number)
- Settings → Machines → Leads & cutting → **Common cut**: how a shared line starts and ends: in line from outside the block (default), at an angle from outside (the Technology row's Angled leads, 45° when empty), or no lead (pierced on the line's end). Lengths: the outline lead-in / lead-out, never longer than the room to the next part
- Manual nest: **Common cut snapping key** (Settings → Manual nest; Shift unless changed), held while dragging: a marked common cut line snaps onto another part's, a kerf apart. Ctrl snapping (the part gap) works as before, with Common cut on or off; the Common cut button now only makes Arrange build blocks. Ctrl, Delete, Esc and the letters of the Ctrl shortcuts (A, C, V, Y, Z) can't be given to a Manual nest action
- Rules → Import rules: **Common cut on every straight outline line**: every straight line of a part's outline becomes a common cut line and Common cut is ticked for new imports (holes left out; lines can still be unmarked per part)
- Process → Auto cut: **common cut**. Parts with the Common cut rule that lie a kerf apart along their marked lines (Custom nest with Common cut, or snapped in Manual nest) make a block: first every part's holes, then each shared line once along the middle of the kerf gap (no kerf compensation, pierced outside the block and coming in along the line), then one outline around the whole block. Shared lines are drawn in the common cut color; a block counts as processed while all its parts stay put, and picking one of its parts under Selected parts processes the whole block. The kerf is the sheet's (Technology row)
- Import **SVG** drawings (parts, stock sheets, remnants): paths with lines, arcs and curves, rectangles (rounded too), circles, ellipses, polygons, groups and transforms; stroke colors go through the color rules, Inkscape layers count as layers. Size from the document's width / height (mm, cm, in, pt, px); with no unit a user unit is a millimeter (the list says so)
- Import **DWG** drawings (parts, stock sheets, remnants): the GNEZDO server converts them to DXF with the ODA File Converter (free, installed on that PC) or LibreDWG's dwg2dxf (in a "tools" folder next to "program"), found by itself or set in config.json (INSTALL.txt). Without a converter the import list says so

- Settings → Personal → **Job names per machine**: + Add job name gives a job name its own machine (the first one stays for all machines, i.e. the machines without one of their own). New job suggests the picked machine's name, and picking another machine in New job switches to its name (unless the name was typed over). For a machine's own name, the next number also counts the files in that machine's NC and job folders (MIHA2804_1.NCP there: MIHA2804 is taken), so it goes on from programs written before GNEZDO or by another program too

- Process → Post process: **Pre-pierce** check box for the selected sheet (laser machines). It shows what the sheet's Technology row says (Pre-pierce column) and can be turned on or off for this sheet alone (kept with the sheet, written into its NC program: #516); set back to the table's value, it follows the table again

**Changed**
- Settings → **Rules** (instead of the separate Import rules page): tabs **Import rules** and **Nesting rules** at the top (the tab last used is kept)
- Tab bar: the open tabs are the darker green of the GNEZDO button, so they and their names stand out from the bar
- Parts list (side panel): no more version bubble (v2, v3 …) on the parts; a part's version is in its **Part properties** (with "see versions"), and the right-click menu still has Versions…
- The **GNEZDO button opens Settings** directly (no menu). Settings: Stock is now **Stock and remnants**, Manual nest is **Shortcuts**, a **Projects** section (not built yet), and **Import rules** (opens the import rules page; Close there goes back to Settings). The menu's Technology table (it is under Settings → Machines) and its placeholder pages are gone
- **Export solution to DXF** moved from the GNEZDO menu to the **Solution info** tab of the Solutions panel (a button under the table; when the nest has finished)
- **Side rail**: Import and New job are back on it, under Home (Import shows how many files wait, as before); the tool strip above the home page with them is gone. Import has a new icon (a part with an arrow down into it). The rail's icons are 60% bigger (the buttons the same size)
- Job toolbar on a narrower screen: **Process or Report opened** scrolls the toolbar to its right end (Report at the screen's edge, Work parts partly hidden, the arrow on the left brings it back); **Work parts or Automatic nest opened** scrolls it to its left end
- Micro joint's mode buttons look like the app's other tool buttons (green when on), the length box green
- Process: new **Inline cut** button (Fab's icon; not built yet) and Fab's new **Process del** icon. Micro joint's mode buttons are taller, so their names fit on two rows
- Post process on a job saved before: its **changes are saved first, without asking**, so the job and its NC files go together (a job never saved still asks first, as the files are named after it)
- Lead in / out and Break cut drawing: a **static picture** with the value boxes **beside the lines, never on them**. The angles are drawn at 45° (Corner in, gap out: 90°) whatever is typed, so neither the lines nor the boxes move while values change; only a gap turning negative redraws it (the cut stops short, the leads drawn further apart so they no longer cross)
- Break cut balloons (BC, 1, 2) on the sheet are **half the size**
- Weights: "MS" counts as mild steel (7.85 kg/dm³), not brass
- Post process: arcs and circles go out as arcs (G02 / G03, at most 180° each) instead of short lines, found again from the drawing's points, and straight lines as one move each. This applies to the HACO plasma too (its postprocessor already writes arcs)

**Fixed**
- Sheet properties of a nested sheet: a **new size keeps the parts where they are from the 0,0 corner**. With the 0,0 corner at the bottom or the right, the parts (and a processed sheet's cut path, its Movement points and break cuts) move with that edge, so they stay put from 0,0 and the sheet shrinks or grows on the far sides; processed parts stay processed
- Nest report and Cost report: the parts' **tracing and open cut lines** on the sheet drawings and the part pictures
- Date fields in the search filters (Parts, Jobs, Remnants): an **English calendar** of GNEZDO's own (Monday first, Today, Clear) instead of the browser's, which showed the computer's language (Danes, Počisti); dates show and type as 13. 11. 2026 (2026-11-13 works too)
- A part's **tracing and open cut lines are shown before it is processed**: in Part properties (the picture), in the parts beside a sheet (Manual nesting) and on the sheets (tracing purple, open cut light blue). They were always saved with the part and cut when the sheet is processed, but these pictures drew only the closed contours, so the lines looked lost after saving or adding the part to a job
- Parts saved over (importer, EDIT) show their new lines right away

**Fixed** (bug check)
- Sheet size changed with the 0,0 corner at the bottom or right: a break cut's remembered original lead now moves with the parts too (RESET put it back in the old place)
- SVG import: arcs written with their flags run together ("a5 5 0 0110 10", as SVG optimizers write them) were read wrongly
- Server in Docker: requests over 1 MB (a big job with its nest, a DWG) were refused by the web server in front of it; DWG files from 30 to 100 MB were refused by the GNEZDO server
- Texts that still pointed to the old GNEZDO menu, Settings → Manual nest / Stock and the old Rules page now name Settings → Shortcuts, Stock and remnants and Rules

## Build 12 Nov 2026, third (`aed34e0`)

**New**
- Process: small, thin direction arrows in the middle of each rapid move (same color as its dashed line) and along the cut contours (cutting direction); Settings → Personal → Cut path turns each on or off
- Process → Remnant: **Cut along X / Cut along Y** under the modes picks RECTANGULAR's first cut (the whole length or the whole width, the second one up to it) and works the remnant out at once; Settings → Stock → Remnants holds the one to start with
- Process: a red dot where a cut ends when it has no lead-out (the green dot marks the pierce, also with no lead-in)

**Changed**
- Auto cut, windows and slots (inner contours that are not round holes): the leads go in the middle of a radius (arc) if the contour has one, else on a straight side at least 2 × the lead-in from its corners (the middle of a side too short for that), nearest the lead corner
- A new sheet's gaps come from the machine's Technology row for its material and thickness: Gaps · Parts (parts gap), Gaps · **Sheet trim** (was Border; all four edges) and Cutting · Kerf (cut diameter). Another material or thickness in the stock list or Sheet properties brings that row's gaps (unless they were changed by hand). The machine's own Gaps of a new sheet stay only for a thickness without a row
- HACO KOMPAKT plasma zip: parts gap = outline lead-in + 3 mm (2–25 mm), + 5 mm (30, 35 mm); sheet trim = outline lead-out + 2 mm. Import the zip again to get them

## Build 12 Nov 2026, second (`78ceca3`)

**New**
- Settings → Machines → Technology: **Remnant cut** columns per thickness: Gap in / Gap out (where a remnant cut starts and ends from the sheet edge it runs to: + inside the sheet, an uncut bridge; − beyond the edge), To parts (distance from the parts; empty = Settings → Stock → Remnants), Lead-in / Lead-out. Leads & cutting: the Remnant cut lead type (in line, 90°, at an angle; from the scrap side). Post process writes the remnant cuts with them
- POST PROCESSOR → HACO KOMPAKT plasma zip: hole lead-in 10 mm (12 mm sheet) and 13 mm (15 mm sheet), outline lead-in 13 mm (15 mm sheet); Remnant cut · To parts = outline lead-in + 3 mm (2–15 mm), + 5 mm (20–35 mm); Remnant cut gap in / out 4 mm inside the sheet; Remnant cut lead 90°. Import the zip again to get them
- Process → Remnant → **DELETE CUT**: a click on the remnant's own cut (red) or outline deletes the whole remnant (asks first); a click on an open cut (magenta) still deletes only that cut

## Build 12 Nov 2026 (`7ac0cbc`)

**New**
- Process → **Process del**: panel with DELETE REMNANT, DELETE CUT PATH and DELETE PROCESS (both) for the open sheet or the sheet selected among all sheets; asks first, UNDO DELETE brings it back
- Process → **Post process**: POST PROCESS SELECTED SHEET and POST PROCESS ALL SHEETS, one NC file per sheet named JOBNAME_# with the machine's postprocessor, written to the machine's NC folder (or downloaded). An unsaved job is saved first; for the selected sheet it asks before replacing a file of the same name, all sheets replace without asking. Spinner while it runs, "POST PROCESS successful" in the panel. A sheet needs its cut path (Auto cut); the remnant's cuts come last
- Settings → **Personal**: preferred job name prefix; a new job gets the next number after the newest run of three consecutive numbers (JOHN230 … JOHN233 → JOHN234)
- **Remnants** on the left rail: Remnant search (job name, material, thickness, project, created, modified, size X / Y; a turned remnant matches too) and the saved remnants as cards: name, EDIT (name, material, thickness, pieces), DELETE, its outline, size, material and thickness. A saved remnant keeps the projects of its sheet's parts and when it was saved and changed
- Remnant search panel: **Import remnant** (a remnant drawn in DXF or SVG; DWG: save as DXF first) with name, material, thickness, pieces and a note; click a remnant card to see its details there (size, weight, created and modified with how long ago, by whom, where it came from, projects) and its **note** (protective foil on top, badly scratched …), also in EDIT
- Home: IMPORT and NEW JOB on the toolbar (Import left the side rail; its badge counts the files waiting); no empty tool bar on screens without tools
- Process → **Remnant**: REMNANT panel (icon beside the title). Remnant mode: TRIM (a rough outline of the parts, straight edges, 90° to 270°, 45° corners where clear, no edge shorter than the minimum), RECTANGULAR (a cut across the whole sheet, a second up to it; along X or Y), SKELET (round the parts at the minimum distance, channels narrower than the smallest edge left out; windows in parts count). Remnant tools: CUT V / CUT H (an open cut through the remnant where you click, edge to edge), DELETE CUT. The list names every remnant REM_<job>_S<sheet>_<n> (1 = the biggest); SAVE keeps the ticked ones in the remnant store (save icon), DISCARD marks them as scrap (✗); doing neither is fine. Remnant areas hatched, their cuts red, open cuts magenta, also in the sheet pictures. Settings → Stock → Remnants: minimum distance to parts, smallest edge, smallest remnant (% of the sheet), RECTANGULAR first cut along X or Y
- Remnant: SKELET keeps sharp corners (the parts' outlines offset with sharp corners, rounded part corners under the smallest arc radius count as sharp, narrow channels left out with a square); it follows a part's arc from that radius up (Settings → Stock → Remnants, 20 mm). Stronger hatch; mode and tool buttons without a white background
- Process → **Auto cut**: the sheet with the AUTO CUT panel. Select mode: Multi sheet (every sheet; saves a new job first), Selected sheet, Selected parts (SELECT, click parts in cut order; drag or ▲▼ in the list to change it; trace box per part), Trace, Cut internal. PROCESS works out the cut path: tracing, holes, then the outline; parts in another part's hole first; big parts last within their box; then the path generation rule (bottom to top, left to right, right to left, top to bottom, shortest distance, smallest to biggest). Leads from Leads & cutting and the Technology table. Picked parts are faded with a glow; processed parts show only their cut and trace lines, with lead-ins (green), lead-outs (red) and travel (dashed). The cut path is saved with the job
- Processed sheets show their cut path in the sheet view of Automatic nest and in EDIT / VIEW too (Job search keeps the plain view). AUTO CUT panel in the app's style; Selected parts list: cut order numbers (they stay put when parts are dragged), part names, trace boxes; ten rows to start, growing, then scrolling; Up / Down below it. PROCESS shows two gears
- One sheet / all sheets: from Work parts or Report, Automatic nest, Manual nest and Process open on all sheets; EDIT / VIEW opens one; Automatic nest (like BACK) goes back to all sheets; Manual nest and Process keep the view as it is. The AUTO CUT panel is as wide as the panel beside the sheets (all sheets) or as Manual nest's (one sheet); parts are picked in the one-sheet view
- AUTO CUT panel: the tool icon (half size) beside the AUTO CUT title; Select mode and PROCESS under it at full width
- Settings → Machines → Machine → **Folders**: per machine, the NC folder (required; or tick to download NC programs in the browser instead) and the job folder with "Also write every saved job as a file" (off: jobs only in the database). The server writes there; Check tests a folder. NC output → Try it: Save to the NC folder

**Fixed**
- Post process: with the machine's 0,0 at the top left (or bottom right) the pierce was on the short lead-out and the program left by the lead-in; Auto cut now makes the path in the machine's own direction (outlines clockwise, holes counter-clockwise as the machine sees them, as in the plasma's old programs), so the screen, the leads and the NC program agree. A cut path made before a change of the 0,0 corner asks for Auto cut again
- Post process: a sheet whose material and thickness have no Technology row is not written (it had no speeds); the message names the missing row
- Process del: UNDO DELETE in the panel brings back what was deleted (Ctrl+Z did not)
- Import remnant: a remnant of the same name as a saved one no longer replaces it silently
- Job name suggestion: worked out from the newest made jobs (with many jobs it could miss the latest numbers)

**Changed**
- The Windows server package is now called `gnezdo-server-windows.zip` (was `gnezdo-windows.zip`)
- Machine → Cut order: holes first and parts inside other parts first are always applied (no longer checkboxes); only Big parts last stays, and it outranks the order picked under Auto cut. The directions (bottom to top, left to right, shortest travel) move to Auto cut
- Big parts last holds only for the parts in the big part's bounding box; parts elsewhere are cut in the Auto cut order

## Build 11 Nov 2026 (`ba40568`)

**New**
- Settings → Machines, four tabs per machine:
  - **Machine**: what it cuts (common cut, open cut, tracing, holes), cut order rules (bottom to top / left to right / shortest travel, holes first, parts inside other parts first, big parts last), Export / Import machine as a `.zip`
  - **Technology**: cutting tables per thickness (kerf, speeds, small holes, pierce time, leads, gaps, angles); import from a `.DBF` material table, pick which technologies, export CSV; new thickness = a copy of the next thicker row
  - **Leads & cutting**: six lead-in / lead-out pair types with drawings; which one the automatic cut uses on sharp corners and elsewhere, for outlines and holes
  - **NC output**: the machine's postprocessor (a JavaScript file it carries), file extension, try it on a sample plate; a generic ISO postprocessor to start from
- Reports (toolbar → Report):
  - **Nest report**: A4 page per sheet with machine, job, sheet data, estimated times, weights, the sheet drawn to scale with part numbers and rulers, and the parts table; print all, only changed pages or chosen pages
  - **Cost report**: price per part from weight and cutting time, per project, prices per material, fixed cost, sum
- Importer: **Scale** tool (type a size with a unit, e.g. `200mm`, or a scale factor, e.g. `2`; the input box opens at the picked line)
- Job search: sheet preview 2 × 2 or one per row; send a sheet's parts to a job open in a tab; Machine column and filter; materials, thicknesses and projects as small bubbles
- Process section: Break cut, Micro joint, Lead in / out, Movement and Remnant tools (icons only, they do nothing yet)
- Settings and Rules: Close under the categories (back to Home)

**Changed**
- Importer: Properties button in the standard size, 8 px between tools (room for one more tool on a 1080p screen)
- Nest report: part numbers 50 % bigger, placed on the part's material
- Result lists: scroll bars always shown
- README brought up to date with the roadmap; neutral sample names in the demo data

## Build 9 Nov 2026 (`06279ac`)

**New**
- Common cut: importer tool and color list, a nesting rule per part; Custom nest joins copies along their common cut lines into blocks; Manual nest snaps marked lines together and Arrange makes blocks
- Manual nest: Ctrl selects several parts
- Importer: line colors from your own lists (exact HEX / AutoCAD colors, any shade, grays) for cut contour, trace and open cut; lines shown in the color of their operation
- Process section: Auto cut and Manual cut tools (icons only)

**Changed**
- Importer: Folder import and File import are buttons; panel buttons light green on hover
- Work parts: removing a nested part asks first and takes its pieces off the sheets
- A DXF / DWG dropped anywhere goes to the importer (the browser no longer opens dropped files)
- Job toolbar: section tiles 140 px, the same whether a section is open or not (everything fits a 1080p screen, also at 125 %)

**Fixed**
- Common cut trials: placed parts counted first, the best trial kept when stopped

## Build 8 Nov 2026, 23:19 (`ddf91c7`)

**Fixed**
- Desktop: GNEZDO no longer stops when Firefox drops the window's connection (it stops 30 s after the window closes)

## Build 8 Nov 2026, 22:22 (`0bfa12c`)

**Fixed**
- A remnant / DXF sheet from Add sheet is never merged into identical stock
- Qty req not set: the tile cannot be dragged and says why
- Failed solutions no longer lock a part's material

## Build 8 Nov 2026, 21:53 (`48d6f16`)

**New**
- Manual nest → Add sheet: ADD FROM REMNANT and ADD FROM DXF (size and shape from the file)
- Manual nest: tiles green from Qty req to Qty max, red below and above; no dragging beyond Qty max

**Changed**
- Import: the file list is the drop area; Add files… / Add folder… next to Clear list

**Fixed**
- DXF remnants with a repeated point in the outline broke nesting
- AUTOMATIC NEST from Work parts no longer opens Manual nest
- Desktop packages: the program starts as the desktop build wherever it is started from

## Build 8 Nov 2026, 19:48 (`7f385de`)

**New**
- Test builds only when asked, not on every change
- Settings → Data: the desktop's data folder (open, back up); the server's database (admin can change it); the server's first start asks for the database in the browser

**Changed**
- Work parts: material and thickness locked while the part is on the sheets of any solution
- Arrange: a second copy turned 180° is tried lined up with the first (trapezoids, L shapes interlock)
- Sheet properties: a sheet can be turned through a position outside the cutting area

**Fixed**
- Job search: the selected job's saved nest is drawn (was an empty placeholder); material / thickness buttons pick the sheets too

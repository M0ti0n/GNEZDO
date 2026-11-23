# Changes by test build

Newest first. Each build is the `test-build` release; earlier builds (up to 7 Nov 2026) were made on every change to main.

## Next build

Nothing yet.

## Build 23 Nov 2026, 3 (`7a8ea76`)

- Test-build release: its text (the change log) had grown past GitHub's limit, so the release could not be published. It now lists the newest builds and links to CHANGES.md for the older ones.
- The browser's page zoom is off: Ctrl + mouse wheel (and a touchpad pinch) and Ctrl + / Ctrl − no longer make the whole page, toolbars and panels bigger or smaller by accident. The drawing views keep their own wheel zoom (Import 2D, Manual nest, 3D Extractor's part and flat pattern), Ctrl held or not. Ctrl 0 still sets the page back to 100 % (for a page zoomed before this build).
- Linux desktop: a browser that does not start (a broken install) no longer sends GNEZDO to the default browser: the next browser found is tried. A broken link left on the PATH by an uninstalled browser (such as google-chrome-stable) is passed over. Found when the Linux build was tried with Ungoogled Chromium as a package, in /opt, as a snap, behind Ubuntu's snap wrapper, as a system and a user flatpak, and as an AppImage: each opened GNEZDO in its own window.

## Build 23 Nov 2026, 2 (`841ccc6`)

- Linux desktop: the window's browser is found however it was installed: an ordinary package (on the PATH or in /opt), a snap (its profile in ~/snap/<name>, where a snap may write), a flatpak (started with flatpak run, GNEZDO's profile folder opened to it) or an AppImage in the usual folders (~/Applications, ~/Downloads, ~/.local/bin …). Ungoogled Chromium is looked for first, then Chromium, Chrome, Edge and Brave. config.json's Browser also takes a flatpak's id. Before, only Chromium, Chrome, Edge and Brave on the PATH were found, so an Ungoogled Chromium flatpak opened nothing.

## Build 23 Nov 2026, 1 (`ab04bdf`)

- Nest report and cost report: the mouse wheel scrolls the row of pages sideways (Shift no longer needed).

- Nest report: a small part (numbered above the sheet with a line to it) gets one number and line, on its copy nearest the top, however many times it is nested; the other copies are found by their shape. A sheet of many small parts had a line to every copy.
- Cost report: the sum (and the fixed cost) right under the last part, not at the bottom of the last page.

- Post process, laser with **pre-pierce** on: a sheet with parts processed first by hand (Auto cut → Selected parts, kept first when the rest was processed) is now **two NC programs**: A with those parts (its own pre-pierce pass, marking and cutting) and B with the rest (and the remnant's cuts), named with A / B after the sheet's name (JOB_2 → JOB_2A and JOB_2B; with letters and digits only, e.g. JOBP2A and JOBP2B); the nest report says JOB_2 [A-B] at the top of the sheet's page. Before, the one pre-pierce pass pierced the whole sheet before anything was cut. Each program says which it is in a comment under its name (SHEET 2, 2 OF 2, SAME 0,0 AS JOB_2A): run A, then B with the same 0,0. Simulation plays A whole, then B; Restart help names the program a contour is in; the sheet is recorded as sent with both files. The LVD laser postprocessor writes the comment (POST PROCESSOR → LVD-AXEL-laser: Settings → Machines → NC output → Replace, or import the machine zip again).

- Auto cut, outline leads: a pierce must stay at least half the sheet's trim off the sheet's edge (5 mm trim: 2.5 mm). A lead whose pierce would come nearer is not shortened; its start moves to the next choice (a part at the bottom-right of the sheet: its lead goes up its right side or to its bottom-left corner). An obtuse sharp corner (over 135°) whose straight lead does not fit (the pierce or lead-out too near the part's next edge, as at a 154° bend) gets 45° leads in and out there, with no gap, before the lead moves on.

- Auto cut, outline leads, new order. When the outline comes within 25 mm of the lead place (the box corner, bottom-right by default), the lead goes there: a straight (corner) lead at a sharp corner, a 90° lead on a radius or edge. When that lead does not fit (a part next to it), it is first shortened there (75 %, then 50 %) before it moves to the next sharp corner, going up or down the place's side rather than across. When the box corner is empty (a triangle, an L's notch, a slope), the nearest sharp corners come first and a 90° lead on an edge only after them. Leads are never shortened below 50 % (was 35 %), outlines and holes. Tested on the 53 test DXF parts and 14 STEP flat patterns at 0/90/180/270 degrees, mirrored and not, packed 5 mm apart: leads at the place went from 297 to 420 of 516 (160 of them shortened to 75 %); the average distance from the place from 82 to 27 mm.

- User manual (English, PDF) added to docs/, with a download link at the top of the README: white cover, descriptions checked against the app, real screenshots and buttons from the current build.
- Slovenian user manual (GNEZDO_Navodila_za_uporabo-slo.pdf) added to docs/, with its own download link at the top of the README.
- The last mention of another nesting program's name in the change log replaced with a general one.


## Build 22 Nov 2026, 5 (`1a8e3c8`)

- **3D Extractor: new icons** for **Send to Import 2D** (a part with a bend line and an arrow) and **Export to DXF** (a sheet with a part and DXF in red; the button was called Flat DXF).

## Build 22 Nov 2026, 4 (`de86398`)

- **A new home screen:** two columns, without the Import and New job tiles.
  - **Recently added parts:** the last ten parts added to the library, each with a small picture, its project, its material and thickness, and when it was added. Clicking one opens the Parts panel.
  - **Recent jobs:** each job's name, its materials and thicknesses, and one of two states. **Nested** means every part is nested and every sheet is post processed (or the job is marked as cut). **In progress** is everything else.
  - **Server:** the jobs open now come first, with who has each one open (their colored name; yours says "here"), then the recent jobs nobody has open. The list updates every 15 seconds.
- **Special tools: no tools built in.** A new installation starts with an empty Special tools; tools are added in Settings → Special tools → Add tool… (a .gnezdo-tool.zip).
  - The six fittings (segmented elbow, rect. → round, branch reducer, flange, threaded flange, screw flight) are now plug-in tools in SPECIAL TOOLS on GitHub, one zip each, with their pictures and value boxes as before. Their parts are the same.
  - Their forms change a little: on the flanges, **Sizes from the table** fills B, E, N and the slot width or thread from A (untick it to enter them), and the part's label gives the recommended thickness, the outside diameter and the tap drill. The screw flight's label gives the blank's angle and radii.
  - A GNEZDO that already has these fittings loses them with this build: add the zips to keep using them.
- **HACO plasma machine file** (POST PROCESSOR → HACO-KOMPAKT-plasma zip): both tables (80 A and 130 A, O2 / air) are tagged with the materials **MS, Mn12 and Hardox** only (S235, S355 and St37-2 are removed). An installed plasma gets them by importing the zip again (Replace) or by changing the tags in Settings → Machines → Technology.

## Build 22 Nov 2026, 3 (`3f02c70`)

- **3D Extractor: tubes, pipes and profiles are no longer unfolded.**
  - A tube or profile with holes, notches or mitered ends used to be taken for sheet metal (or "other"), and a flat pattern was made from one of its walls or its end. It is now sorted under **Tubes** or **Profiles** like a plain one.
  - Square and rectangular tubes are listed under Tubes too.
  - The list shows the section and length (Ø48.3 × 2.6 · L 1200, 40 × 40 × 3 · L 1000) instead of a flat size.
  - Opened, a tube or profile shows no flat pattern and can't be sent to Import 2D; **Unfold anyway** makes one if you really want it.
  - Long parts bent from sheet (angles, channels) are sheet metal, with or without holes (without holes they used to be listed as profiles), and so are strips with holes. A long part counts as sheet metal when its flat pattern is the whole section laid out. A rolled angle, which unfolds to one flange only, is a profile.
  - A plain flat plate more than 20 times as wide as it is thick is sheet metal (it used to be listed as a profile); narrower plain bars stay profiles.
- **Arc leads in rectangular holes no longer pierce on the hole's edge.** With a short lead-in and a larger arc radius, the lead was put so near a corner that its pierce landed on the next side of the hole, so the pierce mark was on the part. The lead now starts at least twice its radius from a corner, and an arc lead that would still reach the contour (at the pierce, or where the lead-out ends) is made smaller.

## Build 22 Nov 2026, 2 (`02ee03a`)

**QA round 2, batch 3: import, technology, LVD program, server checks:**
- **Drawings in inches (or feet, centimeters, ...)** get a **Read as inches** button in the import list: one click scales the drawing to millimeters (undoable), and the note says "converted from inches". It used to read 1 inch as 1 mm with only a note.
- **Blocks inserted with different X and Y scales** keep their arcs and circles as the ellipses they become, sampled every 2° or less. They used to stay circles of the X scale.
- **An arc whose start and end are the same angle is flagged** in the import check ("read as a whole circle"), with **Remove full arcs**. Some CAD programs write such arcs, and they used to be cut as an extra hole without a word.
- **Islands** no longer stop a part from being saved: Auto cut now cuts them as pieces of their own. Whether a contour lies inside another is decided by up to 7 points on it, not one, so a contour that touches another's edge is placed right.
- **The import check is faster:** a plate with 51,000 holes is read, checked and saved in about 6 s. The note in the 22 Nov build said about 4 s for the check, but it took 33 s. The check runs once per drawing, and saving reuses it.
- **Technology:** lead in / out lengths are refused above 100 mm and the size limits for little and middle holes above 1000 mm. A hole exactly at a size limit is now in the right class (the limit was off by 0.01 mm).
- **Post process refuses a sheet bigger than the machine's cutting area.**
- **LVD program:**
  - every first rapid move now has G40 (`N.. G0 G40 X.. Y..`);
  - part names in comments are cut to 24 characters;
  - two parts with the same name but different programs no longer share a subprogram.
- **Server checks:**
  - part names longer than 200 characters and materials longer than 60 are refused with a clear message (descriptions over 400, projects over 60), the same on every database;
  - a thickness must be 0.01 – 1000 mm with at most 2 decimals, when importing, editing a part or changing it in a job. A thickness like 1.255 used to become 1.26 on the server and stay 1.255 on the desktop;
  - a database error is no longer reported as "Someone else saved this part at the same moment";
  - a quantity like 1.5 or 2,147,483,648, or a request that can't be read, gets a message instead of an error page.
- **Cost report prices are shared:**
  - they are kept on the server like the stock and the rules, and are in the settings file. Only an admin changes them; the others can change them for one report;
  - a material is priced whatever its spelling ("S355" and "s355");
  - the report warns about materials that have no price.
- **The source no longer holds a `frontend/node_modules` link** (it pointed at a folder that exists only on the computer it came from); `node_modules` is ignored as a link too.
- **Number fields say what's wrong:** text that is not a number keeps the old value, a number under the minimum becomes the minimum, and a fraction in a whole-number field is rounded. The field turns red for a moment and its tooltip says why. "1.234,5" is not read as a number, and Arabic digits are read as digits.

**QA round 2, batch 2: several users and computers:**
- **Settings saved by two admins no longer overwrite each other.** A change made on settings someone else saved since you loaded them is refused, names who changed them, and the settings are loaded again as they are now, so you can make your change on top.
- **Every page reads changed settings again:** every minute, when its window comes back to the front, and always right before Auto cut and Post process. It used to keep what it read when it opened, so the same job could get other E codes, tech program or leads depending on which computer posted it.
- **Post process refuses a sheet whose Technology row or cutting settings changed since Auto cut** (leads, gaps, kerf, E code sizes, ...): "process the sheet again". It used to take the new E codes and tech program with the old leads.
- **Auto cut of a whole sheet asks before throwing away changes made by hand** (micro joints, breaks, leads, inline cuts): **Keep them** leaves those parts as they are, in the order of the rule, and processes the rest; **Make all again** redoes everything.
- **A lead-in shorter than the kerf is now warned about** when posting: the kerf compensation may notch the contour where it comes on.
- **NC files are written whole:** into a temporary file, then put in place, so the machine never reads a half-written program. Two users posting the same name wait for each other instead of failing.
- **NC file names:** a long name is shortened with its extension kept, Windows device names (NUL, CON, COM1, ...) get a "_" in front, and a name that is only an extension becomes program plus that extension.
- **Saving a job is watertight:** saves of one job go one at a time, so of several saves at the same moment from the same version only one goes in. A save that doesn't say which version of the job it changes (an older page, a script) is refused. Unsaved work restored after a crash keeps the version it was made on.

**QA round 2, batch 1: G-code that looked right and wasn't:**
- **Gentle arcs (15° or less) were cut as two straight lines,** up to 1.3 mm off the drawing on an R600. Arcs now always keep at least 6 points, so the NC program cuts them as arcs. Arcs too big for G2/G3 (over R20000) are cut as lines within 0.005 mm. This applies to parts imported or saved from now on; parts already saved keep their outline until they are imported or saved again.
- **Round contours on parts nested at 5°, 15°, 30°, 45° and so on had flat 7.5° chords** (0.1–0.2 mm off). The cut path now keeps its points to 0.001 mm instead of 0.01 mm, so circles, slots and obrounds are cut as arcs at every angle.
- **A part whose tracing or open cut lines changed was posted with the old lines.** Auto cut now remembers them, and Post process reads the part's drawing again from the database (not this browser's copy) and refuses: "the tracing or open cut lines of X changed since Auto cut: process it again".
- **A Tech program like 6021.5 called program 6022.** Technology values that must be whole numbers (Tech program, Pre-pierce, micro joint Restart) are refused when they aren't, and every value above its column's maximum is refused (Tech program up to 99999).
- **Parts and cuts off the sheet were posted.** Post process refuses a part that lies wholly or partly outside the sheet (or outside a remnant's outline), and a cut or lead that leaves the sheet. The remnant's own cuts may still run off it.
- **Islands (a contour inside a hole) are cut as what they are:** the outline of a piece of their own. Each one is cut clockwise with its lead from the scrap around it, before the hole it lies in; its own holes are cut before it. The NC program gets it as an outline. They used to be cut as holes, with the kerf going into the piece. Lead in / out, micro joints, break cuts and inline cuts leave islands as Auto cut made them.
- **Micro joints, breaks and hand-placed leads on round contours** now start and end exactly on the arc, instead of on the straight chord between two of its points (up to 0.2 mm inside an R100). The pieces are cut as arcs and the joints come out at the length set; on arcs they used to be up to 25 times longer.


## Build 22 Nov 2026 (`b0eca91`)

**Fixes from the check before the build:**
- The desktop build no longer says stock and rules aren't shared yet. It has no other browsers, so it quietly stores its own copy, as before.
- The server forgets job locks that lapsed (a computer that stopped without closing the job) instead of keeping them in memory.

**Send parts to someone's job** (server build):
- In the Parts list, tick parts and click **Send to someone's job…**. A pop-up with two columns opens: the job to send to on the left, the parts to send on the right. It lists the saved jobs open on other computers, with who has them open and the materials and thicknesses in them. Who has each job open is shown in a name tag in that user's own color (the same on every computer), and its materials and thicknesses in bubbles; those matching your parts are green. The most relevant jobs come first: most of your parts' materials and thicknesses, then the same materials in other thicknesses, then jobs with nothing saved yet, then the rest. Four jobs show; the rest scroll. Set how many of each (starting at 0, or the number from the file name when that rule is on, as when adding to work parts), add a note if you like, and send.
- The person with that job open gets a pop-up: "Mia is sending you 3 parts", with the job, the parts, the quantities and the note. **Accept** adds them to the job's work parts; a part already there gets the quantity added. **Refuse** doesn't.
- The sender is told the answer: accepted, refused, or that the job was closed before an answer, so the parts weren't added.
- Several offers at once are shown one after another. Offers are kept by the server until answered; a restart of the server forgets the unanswered ones.

**Settings → Data → Settings file** (admins):
- **Export settings** saves the shared settings as one readable file (gnezdo-settings-date.json): machines, stock and remnants, import rules, nesting rules and added special tools. Keep it with the backups, or use it to set up a new installation or move from the desktop to the server.
- **Import settings…** loads such a file. It lists what it replaces and asks first; whatever the file doesn't have stays as it is. A file that isn't a GNEZDO settings file, or comes from a newer GNEZDO, is refused.
- **Share this browser's settings:** after the update, stock and rules aren't on the server yet, and each browser keeps its own copy. An admin is told once and can share the right browser's copy from the right computer, or import a file. Nothing is uploaded on its own anymore.

**Only Personal is each user's own; the rest of Settings is the admin's** (server build):
- **Stock and remnants**, **Rules** (import and nesting rules) are now kept on the server, one copy for everyone, like the machines. They used to be kept in each browser. Until an admin shares them (see Settings file below), each browser keeps using its own copy.
- **Locked for users who aren't admins**, who can still look: Stock and remnants, Machines, Rules, Special tools. Deleting projects (Projects and parts) is admin-only too, and the server refuses it for anyone else.
- A remnant setting changed in Process → Remnant by someone who isn't an admin holds only on their page until it reloads; it isn't saved for others.
- **Personal** (job names, the cut-path view, manual nest keys) stays each user's own, in their browser.

**Settings → Administration** (admins of the server build; also in the menu under your name):
- **Users:** add, rename, set or remove a password, make or unmake an admin, remove. The last admin can't be removed or unmade.
- **Status API keys** for the apps that read GNEZDO's status.
- These were two separate dialogs under your name (Users, Status API keys). Both now live in this section.
- **A new installation has one user, Admin, an admin without a password.** The sign-in page fills in Admin and says to sign in without a password, then give Admin a password. It stops saying so once Admin has one. This replaces the "Create the first admin" page. An existing database without users gets Admin too.

**A job is open in one place at a time:**
- Opening a saved job that is open on another computer, in another browser or in another GNEZDO tab is refused, and says who has it and since when ("26-0409 Flanges is open on another computer by Mia (since 14:02): close it there first"). This applies to the same user too. Once it is closed there, it opens.
- Saving over a job that is open somewhere else is refused the same way; SAVE AS still saves your changes as a new job.
- A job is let go when its tab is closed or the page is closed. A computer that switches off or loses the network without closing it loses the job after 2 minutes. If that computer comes back after someone else has opened the job, it is told once, and its saves are refused.
- Restoring unsaved work of a job that is open somewhere else restores it as a new job, so nothing is saved over theirs.
- Long messages at the bottom of the screen stay longer, so they can be read.

From the QA report (batch 1: a program that looks right but is not):
- **Post process checks the sheet first** and does not write its program when:
  - a part on it is **not processed**: moved, or added since Auto cut (it was left out of the program without a word);
  - a part's **drawing changed** since Auto cut (replaced in the library, or another version restored): the old drawing was cut. Such a part also shows as not processed on the sheet. Cut paths made from this build on know their drawings; older ones are taken as they are
  - a **pierce lies in or within 1 mm of another part** (a lead that found no room, tight nesting), an outline's pierce lies in its own part, or a hole's is not in the hole
  - written anyway, with a note: contours pierced on their own line without a lead-in (not where a micro joint or break restarts)
- Post process checks the **Technology row**: a value that is not a number, below 0 (leads, E-code limits), the E-code limits not set (0 turns one off), or Slow (E003) above Medium (E002) stops it with the field named. A value written as text ("8") is read as the number
- Nesting: a layout the engine's own check finds **not valid** (parts on top of each other, e.g. with part gap 0) is not offered as a solution any more: the solution shows why, and Process / Post process cannot use it
- Micro joints: length 0 is refused; joints longer than half the contour (or together three quarters of it) are refused; a break or joint whose cut would leave the contour (straight across the part) is refused instead of written

From the QA report (batch 2: what the program says):
- NC programs: names (job, parts, material, technology) in **plain ASCII**: č, š, ž → c, s, z, ß → ss, Đ → D, Ł → L, Ø → O; emoji and other signs left out (the control reads ASCII; a UTF-8 Č came out as two odd characters)
- The **E code** (E001 / E002 / E003, by the contour's longer side) no longer changes with the nest angle: the size is measured as the part is drawn (a 3.5 mm square hole was E003 at 0° and E002 at 45°), and to 0.001 mm instead of 0.1 mm (a 4.04 mm hole counted as 4.0). The Simulation's times use the same class
- **Slot and obround ends** (half circles) are written as one arc each: about half of them ended in a straight line over the last 7.5° (0.05 mm off the drawing at R25, 0.2 mm at R100)
- A window with **rounded corners** starts on a point of the arc: the start between two points gave a short straight stub off the radius (0.09 mm at R40)

From the QA report (batch 3: import and saving):
- Import 2D check: new **Contour inside a hole**: a closed cutting contour inside a hole of the part (an island, and what is in it) is a piece of its own; it was cut as a hole (the wrong way round, pierced in its material, after the hole dropped it). Show it, **Remove** it, or import it as a part of its own
- Import rules: layer names match by **word** (at the start of a word in the layer name): MARK takes MARK, MARKING, MARK_2, LASER-MARK but no longer REMARKS; SIGN no longer takes DESIGN (holes on a DESIGN layer were traced instead of cut)
- **Big drawings**: an outline of 9,000 or more short lines no longer stops the import (it ran out of stack); a plate with 51,000 holes is checked in about 4 s (it ran for more than 11 minutes)
- **Saving a job someone else saved since you opened it** asks first: "Saved by someone else": save over it (their changes go) or cancel and use Save as. Before, the last save won without a word (a nest could be lost)
- LVD postprocessor: at most 998 contours in a subprogram (the 999th ended at N9999, the subprogram's own end label). Import the machine file again (`POST PROCESSOR/LVD-AXEL-laser.gnezdo-machine.zip`, or Settings → Machines → NC output → Replace) to use it

## Build 21 Nov 2026 (`d7e7647`)

- **PostgreSQL**: the server can keep its data in PostgreSQL instead of SQL Server ("Database": "postgres" in config.json, PostgreSQL 13 or newer). Names, unique names, sorting and searches ignore upper / lower case there too (as on SQL Server); GNEZDO refuses a PostgreSQL database that holds another program's tables. Settings → Data shows the PostgreSQL server and database
- **Server for Linux**: new gnezdo-server-linux.tar.gz in the test build: unpack to /opt, give it its own PostgreSQL database, run it as a service (gnezdo.service). INSTALL.txt inside: user, PostgreSQL database, config.json, service, firewall, update, backup with pg_dump
- Docker: `docker compose --profile postgres` starts GNEZDO with a PostgreSQL container (GNEZDO_DB_KIND=postgres in .env)

## Build 21 Nov 2026 (`c75f6c8`)

- Process → Manual cut: two ways, the toggle on top of the panel: **Contour cut order** (as before: contours picked one by one swap places) and the new **Path cut order**:
  - a **timeline** under the sheet goes along the cut path part by part (slider, ◀ ▶, or a click on its blocks); the parts up to it turn from colored to cut as in the Simulation, the last one cut in red
  - set it at the last part that is cut right, **SELECT**, click the parts to cut next in that order (their new numbers show on the sheet), **COMPLETE**: the path up to the timeline stays, the picked parts come next, the rest is **sorted again by the order of the sheet's last Auto cut** (shown in the panel), from where the head is then. Their contours stay as they are (leads, micro joints, break cuts)
  - what is cut as one moves as one: a common cut block, the inline passes, a common pierce group; a part lying in a picked part's hole still comes before it. Marking done first of all stays first
  - **UNDO** takes back the last COMPLETE or PROCESS of the sheet
  - the order picked under Auto cut is now kept with the sheet's cut path (also after Selected parts, or an order changed by hand); Inline cut's RESET uses it too
  - checked against misuse: a part behind the timeline cannot be picked (it says so); a click before SELECT only says to press SELECT; a pick left from a path another tool has changed since is dropped (it could crash COMPLETE); the numbers on the sheet are the real new places (a picked part with parts in its holes comes after them, and they show picked too); parts not processed (added or moved since) are named in the panel and left as they are
  - UNDO only while the path is still the one COMPLETE / PROCESS made: after Lead in / out, Break cut, Micro joint, Movement, Inline cut or Common pierce changed it, UNDO would have dropped that work too, so it is off. The picks of both ways also start fresh when another tool changes the path (they could point at other contours)
- Process → Manual cut: leaving the tool (another Process tool, or BACK to the sheets) clears the picks; switching tabs (another job, Home, Parts, Settings) keeps everything as it was: the picks, SELECT, the timeline and UNDO (they were lost there)
- Parts panel (Imported parts): the thumbnails show the parts' **marking** (trace) lines too, in grid and list view (a part with only marking, e.g. drilling points, showed as a bare outline)
- Date fields: the calendar's day numbers are centered in their cells, under the weekdays (they sat to the left, off today's and the chosen day's outline)
- Process → **Simulation** (and Path cut order): the sheet is look only. Ctrl+A then Delete deleted every part of the sheet there without a sign (the selection does not show in the playback); keys, dragging and the right-click menu do nothing there now, and a selection made with another tool is cleared
- Process → Auto cut, **path generation** (Left to right, Bottom to top, Right to left, Top to bottom), after the test jobs' notes:
  - **always the same way**: Left to right cuts each column from the bottom up, then the next column (it went up and down in turn); Bottom to top each row from left to right, then the next row up
  - **columns and rows come from the parts**: a column starts at the parts nearest the left edge and is as wide as the narrowest of them (at least the median part width); a part belongs to the column its **middle of material** lies in, so an L-shaped part counts where most of it is, not by its box. A 600 mm part a little higher than its row stays in its row (it went into the next one); a tall part does not pull the next row in
  - **parts lying in a bigger part's box are cut before it** (small parts in an L's corner, an L nested in another L); Big parts last (Machine → Cut order) now takes only the parts lying in the big part's box (it took every part touching it, out of their column) and cuts the big parts in the rule's order
  - a **common cut block** is ordered as one (its parts are not split between columns)
- Settings: **Shortcuts** (the manual nest keys) and the manual nest job parts list are now under **Personal** (Settings → Personal → Shortcuts), with the other personal preferences; the separate Shortcuts page is gone. Still kept in this browser; the keys set before stay as they were
- 3D Extractor → **Measure 2D**: click two things: points (corners, hole centers, middles) snap; a click on an edge or a bend line takes the line, on an arc or a hole its center. Point to point: straight (with X and Y); point to line: square to the line; two lines: the distance between them (not parallel: the shortest). The picked lines are highlighted
- 3D Extractor, flat pattern: the measured value stays readable when zoomed in (its white halo grew with the zoom and covered it)
- 3D Extractor → Bend marks: new **Down bends too (dashed marks)**: down bends get marks as well, dashed (the up bends' stay solid), shown in the flat pattern (brown) and sent to Import 2D and the Flat DXF as the up bends' marks (Trace / Open cut). Also in the unfold profiles
- 3D Extractor: the **Send to Import 2D** button in the part panel has an outline like the other buttons
- Nest report:
  - the **Job** in each page's head has the sheet's number after it: **TESTJOB_2** (the operator finds the program by it)
  - the first row of the sheet's table is now **Job file name**, then **Sheet No** (they were the other way round)
  - new **Add full page sheet view** box above each page with a sheet drawing: ticked, a page is added at the end of the report with a small head (machine, job_sheet) and the sheet drawn across the rest of the page; on a landscape A4 page for a sheet wider than tall, portrait for a taller one. Printed and counted like the other pages (Print pages, Print only changes); the ticks are kept for the job
- Sheet properties ([i]) of a nested sheet: **material and thickness can be changed when no part is on the sheet** (they never could, with no sign why). With parts on it they are locked, and say so: a padlock, grayed fields and a note ("Locked: 4 parts are nested on this sheet… Take them off to change them"). The gaps follow the new Technology row, and the old cut path and remnant go
- **Parts only on a sheet of their material and thickness** (it was possible with Manual nest → JOB PARTS → All parts):
  - All parts still shows the others, grayed out with their material and thickness; they cannot be dragged onto the sheet. A drop or a paste (Ctrl+V from another sheet) of such a part is refused with a message (e.g. "BLIND_FLANGE_DN200 is S355 15 mm, this sheet S355 10 mm")
  - A part already on a sheet that no longer matches it (changed to another thickness or material after nesting) glows red in Manual nest, with a note to take it off
  - Process → Auto cut and Post process refuse such a sheet and say which part it is: the sheet's Technology row (10 mm) is not the part's (15 mm), so its program would cut it wrong
- Settings → Machines → NC output → Program name: with **Letters and digits only**, new box **others become [ ]**: each space, _, -, . or other character becomes that letter (or digit), e.g. X: MIHA2280_1 → MIHA2280X1. Empty: left out as before. It goes with the machine file
- Process → **Remnant**: **Smallest edge** (mm) is now in the panel, right under TRIM / RECTANGULAR / SKELET (moved from Settings → Stock and remnants). Changing it works the remnant shown out again at once and is kept for the next sheets and jobs
- Stock: new **Default 4: 4000 × 2000** in **Add from** (Settings → Stock → Default sheets, material and size can be changed like the other three). A choice bigger than the job's machine can cut is grayed out in **Add from** ("too big for the machine"); settings saved before get Default 4 at 4000 × 2000
- Import 2D: **dimensions can be picked and deleted**: with no tool on, click a dimension (its line or its number; Ctrl + click for more) or take it in a window with the lines, then **Delete**. It turns green when picked. **Erase** also takes one by its number now (before only its thin line, hard to hit). Undo brings it back
- Process open, parts not processed yet: a selected part is highlighted (blue) and parts that overlap or are too close glow red, as without Process open
- Import 2D → **Markings**: the place snaps with a mark under the pointer (ends, middles, centers of circles and arcs, quadrants, intersections, and lines); it snapped before but showed nothing
- Import 2D, drawing tools (and Markings, Dimension, Offset, Move...): new snap **On a line**: within 1 mm of a line, an arc, a circle or an aid line the point goes onto it (hourglass mark, "On line"), when nothing else snaps there. Settings → Rules → Snapping while drawing: **On a line** (on unless unticked)
- Nest view rulers: the 0 is at the sheet's 0,0 corner: with 0,0 at the bottom the Y ruler counts up from the bottom edge, with 0,0 on the right the X ruler counts from the right edge (it was always top left)
- Nest view: new **aid lines from the rulers** (blue, dashed, as Import 2D's): click the X ruler (or drag from it) for a horizontal line, the Y ruler for a vertical one; it follows the pointer (onto a sheet, trim or part edge within a few pixels), click to place it, or type its distance from 0,0 + Enter. Press on a line to move it; right click on it (or Esc while moving it): gone. Kept per sheet while the job is open

## Build 18 Nov 2026 (`ffabd63`)

Fixes from the bug report of 18 Nov (points 3 and 14 work as designed; 13 matches what commercial nesting programs do):
- Process → Auto cut, **Cut internal** / **Trace** on a part already processed (Selected parts): its new holes or tracing now go right before that part's outline, not after it (the part was cut loose first)
- Post process, **HACO plasma**: F is written at every lead-in, as HACO's own postprocessor does (it was left out when the rapid kept the same direction); the small-hole speed is for holes only: open cuts, remnant cuts and common cut lines go at the cutting speed. Import the machine file again (`POST PROCESSOR/HACO-KOMPAKT-plasma.gnezdo-machine.zip`, or paste its postprocessor) to use it
- Hole compensation (Settings → Machines): a compensated hole keeps its size when its lead is edited, reset or deleted (Lead in / out), or broken (Break cut); it went back to the drawn size
- Process → **Inline cut**: Manual cut and Movement work again on that sheet; an inline outline's stretches no longer count as "outline before its hole" (the part falls out at its last stretch)
- A sheet's new size with a right or bottom 0,0 corner: **Common pierce** points move with the parts (the pierce mark and its group's leads stayed at the old place); a **remnant** worked out for the old size is dropped with a message (its cuts went missing from the NC without one)
- **Common pierce** and **Inline cut**: a part whose outline has a break cut, micro joints or inline stretches now counts as material: a common pierce's lead or an inline run-in no longer goes through it
- Inline cut, **Reset** / run again: tracing skipped in Auto cut (Skip trace lines, or unticked parts) stays skipped; on machines with tracing first (shortest), the tracing of the other parts keeps its order
- DXF stock sheets: a plain rectangle is a plain rectangle again (it came as a 32-point shaped sheet); shaped sheets lose the extra points along their straight edges
- **Simulation** pierces as the NC program does: after a micro joint as the Technology row's MJ restart says (none / pierce / quick), a quick pierce in a common pierce's hole pierced already; the remnant cuts are played at the end
- Generic ISO postprocessor (the template for a new machine): goes through Process → Movement's points, pierces as MJ restart / Inline cut say (codes to set marked), traces with marking codes (was beam on at the cutting feed), small-hole speed for holes only
- Settings → Machines → What it cuts → **Holes** unticked: no small-hole speed (every hole at the cutting speed) in the NC, Simulation and the reports (a laser keeps its E003 class); the unused lead rule "slot middle" is gone
- Report: with a cut path, the times are the cut path's (as Simulation plays it); without one the rapids are estimated from the machine's 0,0 corner (it was always bottom left)
- Process → Auto cut with Selected parts on one outline of a **Common pierce** group: the outline left alone goes back to its own lead (it kept the group's)
- Server version (Docker): the web image builds on Debian Node (node:22-slim) instead of Alpine, where the frontend build had started to fail (no change in GNEZDO itself)

## Build 18 Nov 2026 (`8086bc6`)

- 3D Extractor: new icons for **One face**, **Fixed face** and **Top side** (Fab's)
- Settings → Machines → machine: new **Hole compensation** (%): holes marked with the **Hole** tool in Import 2D are cut that size on that machine, e.g. 115 % on the plasma cuts them 15 % bigger (a Ø20 hole Ø23); 50 to 200 %, empty or 100 = as drawn. Other holes and the outline are cut as drawn, the kerf compensation stays as it is. It goes with the machine file
- 3D Extractor: new icons for **Measure 3D** and **Measure 2D** (Fab's); Flat distance is now called **Measure 2D**
- 3D Extractor: new icons for **Stitch** and **Add edge** (Fab's)
- Defaults: **Splines to polyline tolerance 0.1 mm** (was 0.01 mm; Settings → Rules → Import rules, also used for the 3D Extractor's short-line curves) and **K-factor 0.25** (was 0.44) in the 3D Extractor's Standard profile. A Standard profile still at the old 0.44 (never changed) takes 0.25; a K-factor set by hand, a K-factor table or another profile stays as it is
- 3D Extractor: curves of a flat pattern that came as many short lines (round corner reliefs across bends, cuts through a bend) are now **joined into lines and arcs** within the Splines to polyline tolerance (Settings → Rules → Import rules, default 0.1 mm), in what goes to Import 2D and in Flat DXF. The 150 × 150 box: 3,404 lines → 20 lines and 44 arcs, the same shape (at most 0.008 mm off), so the machine no longer runs thousands of tiny moves at the corners
- Import 2D, Geometry check: new check **No cutting outline**: a drawing whose lines are all tracing or open cut (nothing to cut the part out, e.g. a file of marking blocks) was shown as ready to process; it is now flagged and not processed
- Import 2D, Geometry check: **Contours cross each other** no longer flags the outline where two of its pieces meet at a sharp angle and rounding puts one end a hair (under 0.01 mm) past the other; a 3D Extractor flat pattern with corner reliefs on 75° bends (150 × 150 box) is now ready to process. A real crossing (a figure eight, a hole over the edge) is still found
- Import 2D, Process all with no project (and no default project): the hint under the button says to set the project, and the Project box is highlighted like Material and Thickness (was only a message after pressing it)
- Settings → Machines → Leads & cutting → Remnant cut: new **In line, from outside** (as Common cut's): where a remnant cut runs to the sheet edge it pierces at the **Gap in** and exits at the **Gap out** (Technology → Remnant cut), in line with the cut and with no lead of its own there; a negative gap is that far beyond the edge, off the plate (0: on the edge). Ends away from the sheet edge get an in-line lead

## Build 17 Nov 2026 (`c7bc609`)

- Import 2D → Manipulate: new **Linear pattern** and **Circular pattern** (Fab's icons). Pick what to copy (a line, an arc, a hole; Ctrl or a window for more; or pick it first, then the tool), then: **circular**: click the axis point, type the count (how many in all, the original included) + Enter: evenly round the full circle, or [Tab] an angle to spread them over less; **linear**: click the pick-up point, type count [Tab] distance (between neighbours) [Tab] angle + Enter, or click where the next one goes. A preview shows the copies; the originals stay; one Undo takes the copies back. A hole of an imported part is copied on its own (Move and Rotate still take the whole part)
- Process → **Process del**: new icon for its button (Fab's), and icons on the panel's buttons, now in this order: **Delete process**, **Delete all process** (was Delete process all), **Delete cut path**, **Delete remnant**, **Delete selected**
- Import 2D, drawing: the horizontal / vertical snap shows just **H** or **V** at the pointer (was Horizontal / Vertical)
- Import 2D → **MARKINGS** works: click where the marking goes (points snap); a panel beside it asks for **1. the marking** (U, V, cross +, cross ×, octagon with a slash; click, or keys 1 to 5), **2. an annotation** (optional, e.g. M8; Enter), **3. the size**: **SMALL** (half), **MEDIUM** (as drawn, 12 mm), **BIG** (twice); clicking the size places it. The marking is centered on the place, the annotation to its right, its letters following the size (7 mm at MEDIUM). Everything is traced (engraved) right away. A dashed preview shows it before it is placed; Esc or Back steps back, a right click drops it; the last marking and size are kept for the next one
- 3D Extractor, **wireframe**: edges hidden behind the part are drawn dashed (the visible ones solid)
- 3D Extractor, **Measure 3D**: new panel layout: 1. and 2. pick (corner coordinates X Y Z) with **CLEAR** beside them; the result (Distance, Offset, Angle…) in a big box; **ΔX ΔY ΔZ** (green, red, blue) in boxes of their own, ready to copy
- 3D Extractor, part by part: a **Send to Import 2D** button in the part's panel (under Name / Pieces) sends this part with its name, pieces and material and takes it off the 3D Extractor list; the next part in the list opens. The SEND TO IMPORT 2D tool on top still sends and keeps the part in the list. The STEP file's material is offered there only when it can be taken (a material of the Technology tables)
- Import 2D → Geometry check → Splines: new **To polyline** button: the splines become lines and arcs that follow them within a tolerance set in **Settings → Rules → Import rules → Splines to polyline** (0.001 to 1 mm, default 0.1 mm) (they can then be trimmed, extended and measured, and cut as clean lines and arcs; Undo brings the splines back). A spline is now also checked and saved along its drawn curve, not only straight through its fit points
- Drawing (Import 2D): the **dynamic input** (Length / Angle) sits on the other side of the last point from the pointer, so it no longer covers the line being drawn
- **Double click with the middle button (wheel)**: Fit, as the Fit button, in Import 2D, the nest / Process view and the 3D Extractor (3D view: the whole part again, turned as it is; flat pattern: Fit)
- Left rail: **Parts** moved up, right under New job
- Work parts: the **Material** and **Thickness** lists of the job part list (and the sheets' Material list) now offer everything the job's machine has in its Technology table, not only what parts in the database already use; Thickness lists the thicknesses the table has for that part's material. The database's values stay in the lists too
- Process → **Simulation** now plays **pre-pierce** as the laser runs it (laser sheets with Pre-pierce on, the sheet's own or its Technology row's): first a pass that only pierces every contour in the cut order (orange dots stay on the pierced holes until they are cut; the panel counts Pre-pierce 3 / 12), then marking and cutting without piercing again. Before, the Simulation left pre-pierce out, so with marking first it looked as if only the parts with marking were pre-pierced (the NC program and the laser were right)
- Special tools: the right panel is wider (460 px instead of 380), so the diagrams and forms have more room; the canvas takes what is left. The other screens' panels are unchanged
- **Special tools as plug-ins**: tools can now be added without a new GNEZDO build. A tool is a small folder (tool.json: the values it asks for; tool.js: the math; optional icon and diagram), added as a .gnezdo-tool.zip in the new **Settings → Special tools** (kept in GNEZDO's database; on the server only an admin adds them), or on the desktop dropped in the tools folder and read again with **Reload**. Its button sits in the Special tools strip beside the fittings; its form, parts and Send to Import 2D work as the fittings' do. Tools run in a locked sandbox in the browser (no network, no data, no page; stopped after 4 s). Guide and an example tool (Mounting plate) in SPECIAL TOOLS/
- LVD Axel machine file: technology tables corrected. Tech programs as on the machine (MS 1–2 mm 6021, 2.5–3 mm 6031, 4 mm 6041, 8 mm 6081; SS 1.2–2 mm 6321, 3 mm 6331), MS 8 mm E002 1250, MS 10 mm E002 1200 / E003 600, SS 4 mm E004 5000, hole and outline arc radii, outline gaps, 45° angled leads, remnant cut gap and lead-in filled in. Import it again (Settings → Machines → Import machine)
- Settings → Data → **Start fresh…** (desktop): like a new install without deleting any folder. A copy of the database goes to data\backups first, then all parts, jobs, projects, remnants, machines and settings are deleted and the screens forget what they remembered. Confirmed by typing DELETE
- The desktop window (GNEZDO's own Edge / Chrome) starts without browser add-ons: an antivirus add-on put in its profile could make the antivirus guard the whole data\browser folder, so it could not be deleted
- Test parts: one download, **GNEZDO TEST PARTS.zip** (folders TEST PARTS 2D: DXF, TEST PARTS 3D: STEP), linked on the front page; the old archives are gone

## Build 16 Nov 2026, 2 (`cf6d4f8`)

- Auto cut: **parts needed first**: process them with **Selected parts** (in the order clicked), then **Selected sheet** or **Multi sheet** for the rest: those parts now stay first, in that order, and only the rest of the sheet is processed, after them (from where the head ends). Before, processing the sheet started over and lost the order. A part moved since is processed again with the rest; to start over completely: Process del. Where the sheet is traced first (laser from 4 mm up, or as the Technology row says): each batch picked with Selected parts is traced first, then cut in the order picked; the rest of the sheet the same after them (its tracing, then its cutting)
- Technology, **laser**: the Cutting speeds are now the machine's four, to match its own technology tables one to one: **E001 Fast speed** (the old Speed), **E002 Medium speed** (new), **E003 Slow speed** (the old Small holes) and **E004 Trace speed** (new). Laser: "Middle up to" / "Little up to" are now **Medium (E002) up to** / **Slow (E003) up to**; the laser's "Small hole up to" is gone from the table (the two limits decide). A new speed not filled in counts as E001
- The time estimates (Nest report, Cost report, Simulation) on a laser now count each contour at the speed of the class the LVD output gives it: its longer side against the two limits, traces at E004. Before, every hole above the small size counted at the full speed, so most holes (E002 in the past programs) came out too fast
- LVD machine file (POST PROCESSOR): the MS and SS tables carry E002 and E004 speeds for every thickness (from the old tables, as E001 and E003 already were)
- LVD machine file, **MS**: E001 / E002 / E003 speeds from the machine's own technology table (mild steel, the default columns): 1 – 2 mm as 2 mm (6021), 2.5 – 3 mm as 3 mm (6031), 4 mm 6041, 5 mm 6050, 6 mm 6060, 8 mm 6081, 10 mm 6101, 12 mm 6120, 15 mm 6150. E004 (trace) as it was; 18 – 25 mm taken out (not cut). 5 mm E003 slow: 1100 (the table's 400 was an error)
- LVD machine file, **MS**: **pierce times** from the machine's pierce table (the same columns): Pierce = normal pierce (#117: 0.2 s at 1 – 2 mm … 10 s at 15 mm), new **Quick pierce** (#102: 0.1 … 1 s)
- LVD machine file, **SS**: E001 / E002 / E003 speeds and pierce times (normal #117, quick #102) from the machine's own stainless table (INOX304, the default columns): 1 mm 6310, 1.2 – 2 mm as 2 mm (6321), 3 mm 6331, 4 mm 6340, 5 mm 6350, 6 mm 6360, 8 mm 6380, 10 mm 6400, 15 mm 6450; new **12 mm** row (6420; leads, gaps and the rest as 10 mm). From 8 mm up the table has no quick pierce (0). E004 (trace) as it was
- LVD machine file: **hole (window) lead-out 0** at every thickness, MS and SS
- HACO machine file: speeds, pierce times and torch times from the HACO table for the **Hypertherm HPR130** power source (said in each technology's new Note): 80 A 2 – 10 mm, 130 A 12 – 35 mm; new **2.5 mm** row (80 A, 7980 mm/min; its other values as 3 mm); small holes at half the speed, as before; torch down / up **4 s** at every thickness (the job time and cost count pierce + torch for every contour); 6 mm 3045 mm/min; **rapid moves 14,000 mm/min** (was 15,000; also the default for a plasma machine with no rapid speed set)
- Technology: a **Note** per technology (what it is for, e.g. the power source it was made with), beside its name
- Technology (plasma and others, not laser): new column **Torch down / up** [s], the time the torch takes to go down and up again for every contour; the time estimates (Nest report, Cost report, Simulation) count it at every pierce and every trace
- Technology, laser: new column **Quick pierce** [s]: the Simulation counts it for an Inline cut stretch started with a quick pierce (before: no time at all)

## Build 16 Nov 2026 (`840fc56`)

- Bug check of the changes since the deep check:
  - Process del: **UNDO DELETE no longer puts an old cut path back over a newer one**: it brings a sheet's cut path or remnant back only while that sheet is as it was (same parts in the same places) and still has none (processed again since: "Nothing brought back"). Before, Auto cut again and then Undo delete replaced the new cut paths with the old ones
  - 3D Extractor, Stitch: a compensation that takes **more off a face than it is wide** (thickness or inner radius far too big) is now reported ("check the thickness"); before, the flat pattern folded over itself without a word
  - Import 2D: **Ctrl+A** (no tool on) picks every line, ready for Ctrl+C, Delete or a Manipulate tool; before, it selected the page's text
  - Special tools: a thickness typed half ("." or "0") is sent as none (the Import 2D properties' one), not as a broken value
- Process → Process del: new **Delete process all**: the cut path and the remnant of every sheet in one go (asked first); one UNDO DELETE brings them all back
- Import 2D: **Delete key** erases the lines picked (no tool on: click, Ctrl + click or a window, then Delete); Undo brings them back. In a text box it deletes text, as before
- 3D Extractor:
  - **Solid / wireframe** is its own button beside View (the cube; lit: wireframe); View keeps edge lines and colors. The View pop-up's **×** is bigger
  - the **arrows** in the Part and Flat pattern titles now make **that** pane bigger (they point the way it grows; the other one folds away to the side); made bigger, the button puts them side by side again
  - Stitch, Added edges: **Del** instead of Undo: click an added edge (green, red under the pointer) to delete just that one
  - Add edge: a corner or middle **hidden behind a face** is no longer snapped to (with the part turned, a corner on the sheet's other side, a few pixels off, could be taken: the edge ended up on the wrong side)
  - its count on the left rail is **blue**, as Import 2D's (it was grey)
  - **Flat pattern zoom**: mouse wheel (where the pointer is), **+ / −** and fit buttons (or double-click); drag to move it (right or middle button while measuring)
  - **Flat distance snaps** to corners, hole centers, middles of straight edges and the bend lines' ends and middles, and else to any point on a line (outline, bend line); the dimension keeps its size when zoomed
  - Stitch, Compensate: new **Direct**: the faces are the top side; on every **down** bend the thickness comes off both faces (2 × thickness at 90°; at other angles thickness × tan(angle / 2) each, the same at 90°). Up bends stay as they are
- **An open side panel follows the tab shown**: a 2D part shows Import 2D's panel, a 3D part the 3D Extractor's, a job Parts, the Jobs and Remnants screens their own; a screen without a panel of its own (Home, Settings, …) closes it. Before, the panel stayed as it was (Import 2D's over a job, …). A closed panel stays closed
- **Arrange: trapezoids pair (one turned 180°, interlocking) again**. Working out a part's best pair took longer than its share of Arrange's time when the part has holes (their many points), so it was dropped, started again from nothing at the next Arrange, and never finished: the 650 × 450 trapezoid plate was never paired. Pairs are now worked out on the outline alone (about twice as fast), get at least 1 s on the first Arrange (on top of the packing's time: that Arrange can take up to a second longer), and are remembered after that
- Import 2D: **new tool group Manipulate** (green): **Rotate** (moved in here; its point turned around is now green), **Mirror** and **Move**. All three pick the same way: a click, Ctrl + click or a window, Ctrl+A for the whole part, Enter / letting go of Ctrl / right click when done. **Lines from the file stay one block**: picking one of them picks them all, so an imported part is only mirrored or moved whole; lines drawn here go on their own
  - **Mirror**: after the picking, click the mirror axis: any straight line (also one of the part's own) or a straight aid line (dashed blue); the mirror image shows in green while the pointer is on a line. The original is replaced by its mirror image
  - **Move**: after the picking, click the pick-up point (snaps), then move by hand and click, or type **distance [Tab] angle + Enter** (0° = to the right, as for a line); the boxes show the live distance and angle in grey, the distance also stands next to the pointer
- Import 2D: new **Markings** button (purple cross, M8). Only the button for now: it does nothing yet
- Import 2D: **Ctrl+C / Ctrl+V**. Pick lines with no tool on (click, Ctrl + click, or a window: an annotation such as M6 in one drag), **Ctrl+C** copies them; **Ctrl+V** hangs the copy on the pointer (by its middle, snapping as the drawing tools do): every click places one more copy, Esc or a right click stops. The copy stays while the app is open, so it can also go into another part. A copy is as its original (an annotation stays traced). In a text box Ctrl+C / Ctrl+V copy and paste the text, as before
- **Special tools only make the fittings; Import 2D processes them** (as the 3D extractor's flat patterns):
  - no more **Properties** and **Process** in Special tools; the fitting's panel has **Name** (its parts are named after it, -A, -B, … where it has several; empty: the fitting's own name, as before), its **pieces**, **material** and **thickness** (a flange: its recommended thickness until another is chosen), as the 3D extractor's parts
  - **Send to Import 2D** puts the parts in the import list with their quantity, material and thickness (none: the Import 2D properties'); sent again, the part waiting there is replaced
- Import 2D: the **Properties** button is gone from the tool strip (it only opened the Import 2D side panel, as its icon on the left rail does)
- Import 2D: the six fitting buttons no longer show in its tool strip (they did nothing there)
- Import 2D: **an open tool group (Drawing, Dimension) closes** when any other button of the strip is pressed, and when a pop-up opens (PROCESS, Properties, …); before, it stayed open over the pop-up. Picking a tool inside the group keeps it open, as before
- Import 2D: the drawing tools' number boxes (dynamic input) no longer take the keyboard while a pop-up is open or another field is being typed in
- Import 2D: **only the middle mouse button pans the canvas**; a left- or right-button drag no longer moves the view (the right button still ends a line or a rotation's picking)
- Import 2D: **the number boxes show the live value in grey** while you draw: length and angle of a line, X and Y of a rectangle, a circle's diameter, a slot's distance, radius and angle, an offset's distance, the angle of an aid line or a rotation. Typed in, the box takes over as before
- Import 2D, **Offset**: the distance stands next to the pointer while you pick the side, as the size of a rectangle being drawn does (the typed value once one is typed)
- Import 2D, a part **drawn in Import 2D** (New part, also once named): the Geometry check no longer runs while it is being drawn (a half-drawn part is all open lines: red lines and balloons everywhere). A green **CHECK** button stands in the status's place; pressed, the part is checked and stays checked while its problems are fixed; taking a drawing tool again puts the check away. **PROCESS needs it**. Parts from files are checked all the time, as before
- Import 2D, **Arc**: the dashed preview now goes through the second point (it bulged to the other side)

## Build 15 Nov 2026 (`1aa39fc`)

- Two or more jobs open: **each job's tab comes back with the toolbar section it had** (Automatic nest, Manual nest, Process, …) **and the sheet it had open in Manual nest**. Before, switching tabs opened Manual nest in the other job too (an EDIT made in one job was replayed in the next tab), and the open sheet was shared between the jobs
- Removing parts from the job (Work parts): **a sheet left empty stays** (and its solution), to nest on again by hand; before it was deleted and had to be added again
- **Whole-app logic check** (every test drawing through import, nesting, Arrange, Auto cut, the Process tools, remnants, the NC program and both machine post processors; random click-throughs of every screen). Found and fixed:
  - **Auto cut: leads no longer pierce in a neighbouring part or off the sheet.** A lead longer than the room it had (a 7 mm lead-in with a 5 mm part gap, a part on the trim border) went into the part next to it: on the test sheets 13 % of the outlines. Each lead is now checked against every other part, the sheet edge and its own part: the start moves to the nearest place where the full lead fits, else the lead is shortened (75 %, 50 %, 35 %). Auto cut says how many leads it moved or shortened, and warns (red) about any that have no room at all
  - **Auto cut: a round outline or hole starts on the circle itself**, not on the straight piece between two of its points (a start up to 0.3 mm inside a 300 mm flange's edge)
  - **NC program: no flats on circles.** A full circle came out as two arcs and two short straight moves (a flat 0.06 mm deep on a 60 mm hole, 0.3 mm on a 300 mm circle); a circle or long arc is now arcs of equal length only
  - **Deleting a part no longer drops the cut path of the parts after it** (Manual nest, Process, removing a part from the job): a contour named its part by its place in the sheet's list, so every later part lost its path. The path now follows the parts
  - **Arrange gives up in time when the parts do not fit the sheet**: it searched to the end (10 to 45 s) before saying No room; now about 3 s
  - **Common cut** (Manual nest) moves only the parts it joins, where they are; before, the rest of the selection was arranged too, and all of it went to the 0,0 corner with that Arrange rule on
  - Parts in a common cut block, or sharing a line, are still flagged when one really lies in the other's material (before: only its first point was tested)
- Import 2D: new **Annotation** tool (after Dimension), as the text tool in Paint: drag a box (or click) and type; the text shows in the single-line annotation font, wraps at the box's width (Enter starts a new line) and the box grows with it. **Text height** (mm, remembered) is set in the bar above the box. Until it is placed, the box moves by its frame and resizes by its 8 handles (the text wraps again). Click outside the box, OK or another tool to place it, Esc or Cancel to drop it. Placed text becomes tracing lines (engraved), one Undo step
- **Common cut is a part's tick box, no more painting**: with Common cut ticked (import Properties, Geometry check or Part properties), every straight line of the part's outline may be shared with a neighbour and cut once; it shows blue in the importer. Holes and arcs are never common cut
  - the importer's **Common cut** tool now does the opposite: click a line (or drag a window) to **leave it out** (it is cut on its own, dashed); again to take it back. A Line colors color can do the same (**No common cut**)
  - lines painted common cut in parts saved before are no longer read: with the part ticked, its whole outline counts (leave out what must not be shared)
  - Rules → **Common cut ticked for new parts** (before: Common cut on every straight outline line) is off by default
- **Common cut** (Manual nest) is now an action, not an on / off switch: select parts and press it, and the copies of each part join into the tightest block (a row, a grid, or every other one turned 180°) sharing their marked lines. A note says which parts were not joined and why (no marked lines, only one selected, lines that cannot meet, may not turn 180°). Nothing stays switched on
  - Marked common cut lines are otherwise ordinary cut lines: **Fast**, **Thorough** and **Arrange** never join parts; **Custom** joins them only with its own Common cut box ticked
  - **Arrange** moves a joined block as one piece (a part picked brings its whole block); drag a part out of a block to take it out
  - Snapping marked lines together while dragging: only with the Common cut snapping key held (Shift unless changed in Settings → Shortcuts)
- Common cut: the copies can also be split evenly into blocks (8 copies of a part where 5 fit in a row: two rows of 4, not 5 + 3)
- Common cut, **chain** and **pair** blocks (Manual nest, Custom nest): the tightest block is taken, not the one with the longest shared lines. A trapezoid with every straight line marked (the import rule) now chains along its slanted sides, every other copy turned 180°, side by side; before, it turned about its long and short sides into a tall stack, or (2 copies) a pair joined on the long side that did not interlock. Triangles make chains too (copies in a row may meet at their base corners)
- Import 2D, Geometry check: **Save as remnant** (at the top): the drawing's outline (its biggest closed cutting contour, the closed ones inside it as holes) goes to the saved remnants, after the remnant dialog (name REM_<part>, material, thickness, pieces, note). For a remnant sketched on the New part canvas, or a damaged part whose good area can still take smaller parts
- Drawing icons: **Arc** centered; **Offset** with its new line in blue and the clicked point red; **Radius** and **Chamfer** in blue
- Import 2D: dimension numbers 60 % bigger
- DXF export with the aid lines and dimensions: a part's export has them by default (the menu's tick box switches them off), and **Export solution to DXF** now carries every part's aid lines (layer AID) and dimensions (layer DIM) too
- **Inline cut** no longer breaks arcs and circles into pieces: contours are split only at their corners; circles, slots and contours with rounded corners are cut whole (as before inline)
- Job, Manual nest: zoomed in, the sheet can be moved well past its edges (about a third of the view), so an edge no longer ends up squeezed against the ruler
- Process with a sheet open: parts not processed yet can be moved again (no tool on); processed parts stay where they are (Delete cut path to move them)
- Break cut: a lead is picked from about 10 mm around it, along its whole length (not only at the pierce point), and a balloon also on the balloon itself; break cut and micro joint balloons are twice as big
- Movement: the modes one under the other, bigger icons with their name and what they do beside them
- Common cut:
  - Custom with Common cut ticked often made no blocks: its trials kept the nest without blocks when it took the same sheets with a slightly shorter last sheet. Now the blocks are kept unless the nest without them takes fewer sheets
  - Manual nest: a dragged part snaps its marked line onto another part's (any part, not only copies of the same one)
  - parts joined into one block (a grid of squares) no longer show as overlapping where their corners meet
  - new **chain** blocks (Manual nest and Custom nest): every other copy turned 180°, sharing one marked line and then the other, so trapezoids and triangles make rows of any length (before: pairs only)
- Common pierce: **Lead-ins to the nearest corner** (on by default): each outline starts at its corner nearest the pierce point, a straight lead from the point. A grid of equal parts: SELECT them and JOIN, and the pierce goes where their corners meet
- Import 2D, **Rotate**: the lines that came with the file turn together. Click one of them (or window a few) and the whole part is picked, so it can no longer be pulled apart; lines drawn in Import 2D still turn on their own
- Import 2D tabs show **2D** (as 3D Extractor tabs show 3D)
- Drawing tool icons redrawn so they read better: **Arc** (three points), **Offset** (a line and its copy at a distance), **Radius** and **Chamfer** (the corner rounded or cut off in red)
- Special tools: each fitting has its own button on the strip (no group to open)
- The side rail: every section but Parts opens its own screen with its list. **Import 2D** opens the **New part** tab, an empty canvas (1000 × 700 mm, 0,0 at the lower left) to draw a part on; **3D Extractor** the part open last there, or its empty screen until a STEP file is dropped on its list; **Special tools**, **Jobs** and **Remnants** their screens. Pressed again on its own screen, a button closes the list (the screen stays). **New job** moved under Home
- **New part** (also a button in the Import 2D list, beside Folder and File): one at a time; the Import 2D button comes back to it until it is saved or named. **PROCESS** saves a finished part (the tab closes); **Save to list** (Geometry check, at the top) names a part not finished yet and puts it in the import list to wait (a name already waiting there is pointed out); its tab takes the name. Closing the New part tab with something drawn asks: Discard, Cancel, Add to the list or Process
- Files are taken only where they are dropped on a list (Import 2D: DXF, DWG, SVG, folders; 3D Extractor: STEP). Dropped anywhere else they are not taken: the list they belong on opens, with a note
- Job search and Remnants keep their results while you are on other screens: back on them, the list, the job picked and where the list was scrolled are there at once (read again in the background, so Sent / Cut are up to date)
- Import 2D: with no tool on, a drag picks with a window (left to right: lines fully inside; right to left: lines it touches; Ctrl adds to what is picked); the middle or right button moves the drawing. Dragging on the canvas no longer selects the page's text
- Side panels: long names in the lists (a machine, a material) no longer push the search boxes past the panel's edge; the Rotations and rules boxes in Import 2D's Properties stay in their column
- 3D Extractor, the part in 3D:
  - turning by dragging works again (it stopped after the first little turn); right or middle drag (or Shift + drag) moves it; the wheel zooms where the pointer is
  - **Face view** (new tool, or double-click a face): the view looks straight at a face
  - **View** options (button in the Part pane's title): **Solid** or **Wireframe**, **Edge lines** thickness, and face **Colors**: Unfold (as before), **STEP file** (the colors the file gives the part) or **Material** (a color set for each material). Kept for next time
  - Colors and materials are read from STEP files (styled items and material properties, as Fusion writes them; files from other programs that write them the same way too). A material the file names becomes the part's material when the Technology tables know it (or have no material tags); otherwise the panel shows what the file says, with **use it**
- **SPECIAL TOOLS** (new on the side rail, its own screen), first with **FITTINGS**: flat parts of sheet metal fittings made from their values, ported from the HVAC Fittings workbench for FreeCAD. The screen shows the values in boxes on a diagram (as the lead-in editor), the fitting's parts in a list, and the part picked in the list on the canvas. **PROCESS** saves the picked part like an imported drawing (its box in the list gets a check mark once saved); **Add to the import list** puts all its parts in the Import 2D list, waiting to be processed there (FIT ×pieces; the same part again replaces the one waiting). Material, thickness and project come from the Import 2D Properties. Every curve is arcs and lines within 0.01 mm (no splines); fold marks and X marks are tracing lines
  - **Elbow** (segmented): D, R, A, N middle sections; the seam always at the side. **Separate sections** (middle ×N, end ×2) or **Stacked in one rectangle**: every other section turned round, so they fit into one rectangle with open cuts between them. Fold marks (how many around, length, gap from the edge)
  - **Rect. → round** transition: A, B, E, F (the rectangle around the round's center), D, H, sections per quarter; **Combined**, **Short side**, **Long side** pieces; seam on the longer side; fold marks at the round edge
  - **Branch reducer**: a reducer D2 → D1 (H1 high; D1 = D2: a straight pipe) with a branch D3 at A, meeting the side at H2, L long. The hole and the branch's edge are their exact intersection; the reducer's seam runs through the hole, the branch's on its shortest line
  - **Flange**: 44 standard sizes (A80 … A820) or your own A, B, M, E, N; arc slots 25 mm long. **Divided** (over A100): three 120° sections, the first cut between two slots (one section ×3, or section A ×2 and B ×1)
  - **Threaded flange**: its own size table, thread M3 … M16 (tap drill shown); only the ring is cut, an X marks each hole to drill and tap; Combined or Divided
  - **Screw flight**: OD, ID, P, L, gap; the blank of one pitch (Ri, Ro, calculated and blank angle shown), ceil(L / P) pieces per screw

## Build 14 Nov 2026 (`ca1cfba`)

- 3D Extractor, Stitch: **Add edge** (new tool, also in the panel: Added edges · Add / Undo / Clear). Click two points of a flat face's outline: it is split along the line between them (green). Corners and the middles of edges snap; hold **Ctrl** for the second point square to the edge under the pointer. An added edge is a seam (cut), so a tube opens there; clicked along an existing edge (its two ends) that edge becomes a seam (red dashed; the same two points again: stitched again; Seams · Clear in the panel). A flange running all round a part, cut at its corners, becomes one piece per wall, each stitched to its own; the new edges are cut in the flat pattern (a corner gap). Across a face the line must run inside one flat face and not cross an edge added before. The edges are kept with the part; a face split by a change (and its pieces) is picked again

## Build 14 Nov 2026 (`e9646ee`)

- **Cut by sheet**: in Job search each sheet sent to the machine shows **Sent** or **Cut** on its tile. Pick a sheet and **Mark sheet N as cut** (again: **Sheet N not cut**), so a big job can be cut a few sheets at a time while others wait to be filled; the job is Cut when all its sheets are. **Mark all as cut** / **Not cut** do the whole job. Post processing waiting sheets again leaves the sheets already cut marked, when their parts did not change. The status API counts a part's pieces as cut from whichever job's sheet is cut
- **Status API** (server build, read only) for other apps (a BOM app, a workflow overview): which laser parts of an order are in GNEZDO, in a saved job, nested and sent to a machine, and which drawings of the order never got imported. An admin makes a key per app in the user menu → **Status API keys** (shown once, removable). `GET /api/v1/projects/{code}` lists the project's parts with their jobs, nested and sent pieces; `POST /api/v1/projects/{code}/check` takes the order's drawings (drawing, BOM position, pieces needed) and answers each one found or missing, with what is still to send. Part names are read as drawing_position_pieces (1234-56-78_P2_3kos); a mirrored ZR drawing is found under its base. See docs/STATUS-API.md
- **Mark as cut**: in Job search the operator marks a nested job as cut (**Not cut** takes it back); the job's status shows Cut and other apps see it through the status API, the job's sent pieces counting as cut
- **POST PROCESS** records what it sent: every NC program written (or downloaded) for a sheet of a saved job, with the pieces of each part on it; the same sheet written again replaces its record
- Import 2D, **grips**: with no tool on, a line, circle or arc drawn in Import 2D shows small blue grips (under the pointer or when picked). Drag a line's end to stretch it, its middle to move it; a circle's or arc's center to move it, a point on it to change its radius; an arc's end to lengthen or shorten it along its circle. Points snap while dragging (an end also horizontal / vertical); Ctrl+Z undoes. Lines from the file are locked in place (no grips); every tool still works on them
- Import 2D, **picking with no tool on**: click a line, an arc or a circle (Ctrl + click for more, Esc clears). Then **Aid line** turns them into aid lines: a line becomes a dashed piece, an arc or a circle a dashed arc or circle. Like other aid lines they are kept with the part, never cut, snap (ends, middles, centers, quadrants, crossings), Erase removes them, and they are exported with the "With dimensions and aid lines" box (layer AID)
- Import 2D, **Rotate** (new, beside Scale): click a line, an arc or a circle, or drag a window, to pick what to turn (hold **Ctrl** to pick more, then let go; Enter or a right click also ends the picking; **Ctrl+A**: the whole part). Then click the point to turn around (ends, middles and centers snap), and turn by hand (0° = to the right; whole degrees, caught within 3° of every 45°) or type the angle + Enter (+ counterclockwise, − clockwise). The result is previewed before it is placed. Esc steps back
- Import 2D, **Line**, **Aid line** and **Slot**: within 3° of horizontal or vertical the line snaps exactly horizontal or vertical (a dashed guide shows it). It can be turned off in Settings → Rules → Snapping while drawing ("Horizontal / vertical")
- Import 2D tool groups (**Drawing**, **Dimension**) stay open while you pick and use their tools, so all of them stay in view. Another group's button closes it, and so does a second click on its own button. Single tools on the strip, clicks on the canvas and Esc leave it open
- 3D Extractor, **Holes**: the flat pattern's round holes by size (Ø, how many). A size can be **Cut** or a **thread** (M2 … M24): a threaded hole is not cut; a small traced cross with its thread beside it (M8, single-line text) marks it for drilling and tapping after cutting. Holes the size of a tap drill (Ø6.8 → M8, Ø8.5 → M10 …, metric coarse) are set to their thread by themselves and marked "probably"; any size can be changed. Into Import 2D as tracing lines, into the flat DXF on layer THREAD
- Thread marks bigger: the cross 15 mm and its M# text 15 mm high by default; both sizes can be set in the Holes section
- Import 2D, **dynamic input** while drawing (as in AutoCAD): boxes next to the pointer, Tab to the next box, Enter applies, Esc steps back; a box left empty follows the pointer
  - **Line**: Length [Tab] Angle (a positive angle turns counterclockwise, a negative one clockwise)
  - **Rect.**: X [Tab] Y (signed); **Circle**: Ø
- New **DRAWING** tools, in the same icon style:
  - **Slot**: the center of one end, the center of the other, then a point for the radius; or the first center, then Distance [Tab] Radius [Tab] Angle. The dashed center line between the ends is kept, its middle snaps
  - **Aid line**: an endless dashed blue line through two points, or a point and a typed angle. Hold **Ctrl**: click a line, then a point or a parallel line, and the aid line goes half way between, parallel to the line
  - **Offset**: click a line, arc, circle or aid line, then click the side (points snap) or type the distance + Enter
  - **Radius**: click a corner where exactly two lines meet and type R; it can be no bigger than the shorter line allows
  - **Chamfer**: click a corner, then Distance 1 [Tab] Distance 2
- **Extend**, new mode: hold **Ctrl** and click two lines to join them at their crossing (both are extended or trimmed to it)
- Snapping: ends, middles, centers, **quadrants** of circles and arcs, crossings, **perpendicular** and **tangent** from the last point, each with its own mark. **Settings → Rules → Snapping while drawing** sets which ones are on
- **Dimensions and aid lines are kept with the part**: saved with it when processed and shown again (and working) only in Import 2D; Erase removes them. They are never cut or nested. Exporting a part (DXF / SVG) has a check box **With dimensions and aid lines** (layers DIM and AID)

## Build 14 Nov 2026 (`5c16b3a`)

- Bug check, 3D Extractor: big parts (many sampled curve points) no longer stop with a "call stack" error (bounding boxes, bend lengths, measures); a part named after a standard (DIN / ISO …) that unfolds as a bent or bigger sheet part stays sheet metal instead of hardware; washers whose circles come in halves are found as hardware; a STEP file that fails unexpectedly no longer leaves the list "reading…"
- Import 2D tools in groups: **DRAWING** (Line, Circle, Arc, Rect.) and **DIMENSION** (Length, Diameter, Radius, Angle). A group's button opens its tools below the strip (blue: drawing, red: dimension); while one of them is on, the button shows that tool. New drawing tools (cutting lines, ends of lines snap, Esc or right click starts again):
  - **Circle**: the center, then a point on it, or type its diameter (20 + Enter)
  - **Arc**: the start, a point it goes through, the end
  - **Rect.**: one corner, then the opposite one, or type width x height (200x100 + Enter: toward the pointer)
- Import 2D: the part's own nesting rules (a flat pattern from 3D: 180° only, no mirror) shown in the Geometry check panel instead of the list's
- **3D EXTRACTOR** (new on the side rail, first prototype): flat patterns out of STEP parts and assemblies, sent to Import (now called **IMPORT 2D**). Nothing is saved to the database from here.
  - STEP files (Folder, STEP files, or dropped anywhere in GNEZDO) are read in the browser. Every body is a part in the list, with its name and **quantity** (an assembly: how many times the part is placed in it), grouped as **Sheet metal, Surfaces, Tubes, Profiles, Other parts, Hardware**, with a search
  - **Hide hardware** (on by default): bolts, nuts, washers, pins and the like, found by their names (bolt, screw, nut, washer, DIN / ISO / EN numbers, M8x20 …) and their shape (small turned parts, small flat rings)
  - **Send sheet metal to Import 2D**: every sheet metal part not sent yet. A part opened: **SEND TO IMPORT 2D** (sent again: it replaces the one waiting in Import 2D). There the flat pattern has a 3D chip with its quantity, which is saved with the part; its thickness found, foil (no mirror) and grain (180° only) are used for that part instead of the list's Properties. The Import 2D bubble counts the parts waiting to be processed. **Open in 3D Extractor** goes back to the part
  - A part opened shows it in 3D (shaded: drag to turn, wheel to zoom) and its flat pattern side by side, with the panel on the right:
    - **Sheet metal**: thickness found, bends (up / down), flat size; **K-factor** (inner radius + K × thickness); a bend table (angle, UP / DOWN, inner radius, length). **FIXED FACE**: click a flat face to unfold from (else the biggest); **TOP SIDE**: click a face on the side that lies up on the machine (else the inside of most bends). The flat pattern is always laid top side up (mirrored when needed)
    - **STITCH** (manual, for surface models and parts drawn with sharp corners): click flat faces one next to the other (again: out); the first stays, each next one is laid flat across the edge it shares with one picked before. **Top side**: Turn over / Auto. **Compensate**: No (the faces as they are, default), or the faces are the sheet's **Top side** / **Bottom side**: each bend gets its allowance less its setbacks (thickness, inner radius, K-factor)
    - **Bend marks** on the top side, only on the UP bends: 20 mm long, starting 2 mm in from both ends (changeable), as **Trace** (default), Open cut or None. **Show angle and UP / DOWN** beside each bend (on screen, not engraved)
    - **Foil / finish on the top side**: never mirrored when nesting. **Grain** X / Y: a pattern with the grain along Y is turned 90° so it runs along the sheet (X); nesting only turns it 180°. Rotation steps now include **180°** (import, part properties, Process)
    - **DISTANCE**: two clicks on the flat pattern (corners, ends and hole centers snap); **FLAT DXF**: the flat pattern with the whole bend lines on layer BEND and the marks on BEND_MARK
    - **Profiles** (per customer or the shop standard, kept in this browser for now): a K-factor, K-factors by material and thickness, bend marks, angle labels, foil on by default. Profile → Edit…
  - **Name** and quantity before sending: at the top of a part's panel (Name, pieces), or in the list (the pencil on a row, or F2). A part already waiting in Import 2D is renamed there too
  - **ONE FACE**: click one flat face; its outline (with its holes) is the flat pattern as it is, ready to send (Stitch with that one face)
  - **MEASURE 3D**: click a flat face, a round face, an edge, a hole (inside it or on its edge) or a corner; then a second one. One: what it is (edge length, hole Ø, corner X Y Z). Two: the **offset between parallel faces** (a thickness, a slot, a step) or the angle between faces; **hole to hole** (axis to axis, or coaxial and how far along, the wall between them, both Ø); the distance of a corner, an edge, a hole's center or axis from a face; between edges (distance when parallel, else the angle); ΔX ΔY ΔZ. What the pointer is on lights up yellow, the picks orange. **FLAT DISTANCE** (was Distance) still measures the flat pattern
  - The part (3D) and the flat pattern fold away to the side: in each one's title, **fold away** (the other gets the whole room) or **only this one**; the folded one is a narrow strip, a click on it puts them side by side again. Kept for next time
  - **Material** per part, beside its pieces: from the Technology tables' materials (or typed); it goes to Import 2D with the part (used instead of the Properties' material, also in Process) and picks the profile's K-factor for that material. Empty: the Import 2D Properties' material
  - **Grain and foil travel with the part**: a flat pattern with a grain direction or foil / finish is saved with them (in its drawing). Process shows them as icons beside the part's size (grain: three lines along it; foil: a sheet with its foil peeling). Wherever the part's tracing lines are shown (parts beside a sheet, parts on the sheets), a grain part shows three brown dashed lines along its grain in its middle, turned with the part: only shown, never cut, traced or in the NC program. EDIT on a saved part keeps them
  - **Angle, UP**: Off / Shown / **Engraved**. Engraved: each bend's label (for example 60° UP) is traced on the part beside its bend line, in the middle, along it, with a single-line font (**Relief SingleLine**, SIL Open Font License, bundled with GNEZDO), **Text height** 6 mm by default (capitals; smaller on short bends so it fits). It goes to Import 2D as tracing lines and into the flat DXF (layer BEND_TEXT). Profiles keep the choice and the height
  - Not yet: unfolding tubes and profiles (they are only sorted), Parasolid

## Build 13 Nov 2026 (`bae6e3b`)

- Laser Technology tables have a new column, **Laser · Trace shortest** (1 = on). It sets, per thickness, whether AUTO CUT traces first over the whole sheet in the order of the shortest rapids. A row with no value set is on from 4 mm up. On a laser, Settings → Machines → Cut order now points to this column instead of its checkbox; other machines keep the checkbox
- Settings → Machines has a **Rapid speed** (mm/min) for the time estimates in the Nest report and the Simulation. Empty: 15,000 mm/min on a plasma (measured: 2 m in 8 s), 20,000 mm/min on the others (before this, 20,000 for every machine)
- HACO plasma machine file: 25 mm pierce time 4 s (measured; it was 1.8 s), rapid speed 15,000 mm/min
- Post process → **RESTART HELP** (on / off, a sheet open; shown when Settings → Machines → NC output → **Restart help in Post process** is ticked): click a contour on the sheet and the panel shows where the program restarts it, worked out from the program as it is written now. LVD laser: the counters to set, **#530** (the part counter: its placement in the main program, N100 GOTO[#530+100]) and **#529** (the contour counter in that part's program, GOTO[#529*10]), also #529 = 1 for the part from its start and where else the part is placed (its marking, contours cut elsewhere in the order). HACO plasma (no counters, incremental): the block N of the contour's rapid to its pierce point and the pierce point from 0,0, to restart there only with the control's own block restart. The postprocessors return these with their text; the machine files have the box ticked. A machine set up before needs its postprocessor loaded again (Settings → Machines → NC output → Replace) and the box ticked
- Process → **Common pierce**: one pierce hole in the scrap for several parts' outlines. The first outline pierces it, the others start in it with a quick pierce (LVD M98P8037; Simulation: no pierce time). Each part keeps its own lead-in next to the outline (**Lead-in kept**, default 2 mm, all of it when shorter) and its own lead-out; an arc from the pierce point runs into the lead-in, tangent (a straight line when in line, or when the arc would go through a part), and must stay in the scrap. **SELECT** (on / off) parts, then **JOIN**: the pierce point in the middle between their lead-ins. **PLACE** (on / off): click a point in the scrap; every outline whose lead-in starts within the **radius** (default 15 mm) joins. **Lead-ins: Any side / Left / Right**: only the outlines whose lead-in starts left (or right) of the pierce point join. **Apply a break cut**: the joined outlines get the lead type with a gap like theirs (corner → corner in, gap out; perpendicular → with gap; corner at an angle → angled with gap) and the default gap (the Technology table's outline gap when negative, else −5 mm). **MOVE**: click a pierce point (CP balloon), then where it goes. **DELETE** (on / off): click a pierce point; its outlines get their own leads back. A group is cut one outline after another from the one nearest the machine's 0,0, where the last of them was, so their holes are cut before. Holes keep their own pierces; Lead in / out, Break cut, Micro joint and Inline cut leave joined outlines alone
- Process → **Inline cut** (a flying cut, for grids of parts on thin sheet): the parts' contours are cut in passes across the sheet instead of contour by contour. First every pass along X, the head running one way and back on the next pass (snake), then every pass along Y (or Y first). A contour is cut in stretches: a new one where it turns more than 45° from the pass, so arcs go with it too. Stretches that lie within the **corridor width** across the pass (default 3 mm) and do not overlap go in one pass. A contour with a stretch wider than the corridor is cut as before: holes before the passes, outlines after them, so a part never drops before its holes. SELECT parts (none: every part of the sheet), X first / Y first, corridor width, **run-in** on outlines (default 2 mm, in line with the pass on the scrap side, none where it would be in a part; holes none), **pierce** Quick (default) / Normal / None, INLINE CUT, RESET (back to the automatic cut). NC: each stretch is a cut of its own with that pierce (LVD: quick M98P8037, normal M98P8036), G42 where a stretch runs against its contour's direction, the E code of the whole contour; on the LVD all the passes are one subprogram, INLINE CUT. Simulation: no pierce time for quick and none
- Technology tables: a **For materials** column, the technology's material tags on every thickness. Untick a tag where that material is not stocked or not cut in that thickness: the thickness is then left out of that material's thickness lists (import, part properties, sheet properties). The row's values still cut a sheet of it. Changeable with Unlock all, the row's padlock or the column's own padlock. The CSV export has it as Thickness for materials
- LVD laser machine file: two technology tables, **MS** (tags MS, Mn12, HARDOX) and **SS** (tags SS, ALU, Zn), instead of MS mild steel, St37-2, SS stainless and AL aluminum
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

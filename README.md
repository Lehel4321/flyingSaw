# Flying Saw Simulator

A browser tool for sizing a flying saw. Enter the line, cut and drive data and it tells you whether the
cycle fits into the time one part takes to pass, what limits it, and how to fix it. It also animates the
carriage, blade and material in real time.

## Get it

Three ways to run it, all the same program:

| File | What it is |
| --- | --- |
| `FlyingSaw-Setup.exe` | Windows installer (about 1.5 MB). Installs for your user only, no administrator rights needed. Adds a Start menu entry, an optional desktop shortcut and an uninstaller under *Settings → Apps*. |
| `FlyingSaw.exe` | The program itself (about 3 MB), no installation: copy it anywhere and double-click it. |
| `FlyingSaw.html` | Everything in one HTML file (about 250 KB). Opens in any browser on Windows, Mac, Linux or a phone, also offline. |

Get them from the [Releases](../../releases) page, or build them yourself (see *Building*).

The exe shows the simulator in its own window using Microsoft Edge WebView2, which is part of
Windows 10 and 11. On a PC without WebView2 it opens the same page in your web browser instead.
Windows may warn about an unknown publisher the first time, because the exe is not code-signed:
click *More info → Run anyway*.

Your machine data is remembered between runs. The program and the HTML file both keep it on your
computer; nothing is sent anywhere.

## What it shows

- **Verdict** with a check per limit: line speed, cycle time, carriage travel, cutting feed and, when you
  enter motor ratings, peak and RMS motor torque.
- **Key figures**: minimum cutting feed, time per part, cycle time and reserve, max. time synchronized,
  carriage stroke, max. line speed with your setup, shortest part at your line speed, motor torque.
- **Where the time goes**: a timeline of one cycle (accelerate, settle, approach, cut, retract,
  decelerate, return, wait) against the part time, plus a table with every phase in ms.
- **Side view animation** with real-time and slow-motion playback, a scrub slider and step keys.
  Cut parts are labelled with their real length, so an overrun shows up as longer parts.
- **Charts** for carriage speed, blade depth and carriage motor torque. Hover for a readout and click or
  drag to scrub the animation.
- **Export**: copy or download the sampled motion profile as CSV (time, position, speed, acceleration,
  motor rpm, torque, blade position, phase).
- **Projects**: *Export project* saves all machine data to a `.json` file (with a normal *Save as*
  dialog in the Windows program, Chrome and Edge; a download elsewhere), *Import project* opens one
  again. `Ctrl+S` and `Ctrl+O` do the same, and you can also drop a project file onto the window.
  Fields missing from an older project file get their defaults.
- **Sharing**: every change is saved in the browser and in the page link, so *Copy link* shares the exact
  setup when the page is hosted online (the exe and the HTML file have no shareable link, so the button is
  hidden there; send a project file instead). *Reset to defaults* brings back the example values.

Keyboard: `Space` play / pause, `←` `→` step through the cycle (`Shift` for bigger steps).

## Model

- Every move is a time-optimal rest-to-rest profile. With the jerk limit at 0 it is a trapezoid (same
  acceleration up and down). With a jerk limit it becomes a 7-segment S-curve.
- Max linear speed = motor rpm ÷ gear ratio × travel per output revolution ÷ 60. An optional speed
  limit in mm/s per axis lowers it further (0 = no extra limit).
- The carriage starts when the mark is one ramp distance behind it, so mark and blade line up exactly
  when line speed is reached. While synchronized, the saw axis makes three moves: approach at the
  approach speed, cut at the cutting feed, retract over the full stroke at the retract speed. Each is
  capped at the saw axis max speed; approach and retract speed 0 mean "as fast as the axis can". The carriage decelerates once the blade is fully up,
  then returns home and waits for the next mark.
- Motor torque = mass × acceleration × lead ÷ (2π × gear ratio), divided by the efficiency while
  motoring and multiplied by it while braking, plus motor and gearbox inertia × angular acceleration.
  RMS is taken over the full part time.

Not included: friction and cutting forces, saw axis torque, PLC scan time, cam-table blending between
moves and servo following error. Leave some reserve.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page markup |
| `styles.css` | Styles, light and dark theme |
| `motion.js` | Motion maths, no DOM (also loadable from Node) |
| `app.js` | Inputs, verdict, timeline, animation and charts |
| `project.js` | Project file format (export / import), no DOM |
| `fonts/` | Barlow fonts (SIL Open Font License), so nothing loads from the internet |
| `assets/` | App icon (`icon.svg` is the source, `icon-small.svg` the simplified 16–32 px version) |
| `tests/` | Unit tests for the maths and the project files |
| `build.py` | Builds the single HTML file, the exe and the installer into `dist/` |
| `desktop/` | The Windows program (Go): a window that shows the single HTML file |
| `installer/FlyingSaw.nsi` | The installer (NSIS) |

## Development

```sh
npm test      # runs the unit tests and builds dist/FlyingSaw.html to check it is self-contained (Node 18+, Python 3)
npm start     # serves the folder on http://localhost:8000 (optional, index.html also works from disk)
```

The tests include the original single-file calculator's model as a reference, so the new maths is
checked to give identical results whenever the jerk limits are off.

## Building

```sh
python3 build.py html        # dist/FlyingSaw.html, needs only Python 3
python3 build.py exe         # also dist/FlyingSaw.exe, needs Go 1.24+
python3 build.py             # also dist/FlyingSaw-Setup.exe, needs Go and NSIS 3
```

This works on Windows, Linux or macOS; the exe is always built for 64-bit Windows. On Windows install
[Go](https://go.dev/dl/) and [NSIS](https://nsis.sourceforge.io/Download) and run `python build.py`.
The version number comes from `package.json`.

GitHub Actions builds all three files on every push and starts the exe and the installer on a Windows
machine to check them; the files are attached to the run. Pushing a tag such as `v1.0.0` also publishes
them as a release.

## Hosting on GitHub Pages

Settings → Pages → *Deploy from a branch* → `main` / root. The tool is static, so nothing else is
needed.

# Storage Case Builder

Design a 3D-printable storage case on your phone, without CAD. Set the size, pick a layout, drag the dividers where you want them, add a lid, and download STL files ready to slice and print.

**Use it:** https://pjw3211.github.io/storage-case/ (live once the website is switched on, see below)

![The storage case builder on a phone](public/preview.png)

## What it does now

1. **Size.** Type the width, depth and height, or drag the round orange handles on the box.
2. **Inside.** Every divider is a separate piece. Start from a layout (one pocket up to a 4 × 3 grid) if you like, then drag any divider anywhere: it lines up with other dividers, and its ends snap to the walls and to dividers they meet. Tap a divider to drag its end dots (longer or shorter), turn it 90°, stretch it wall to wall, lower it for finger access, or delete it.
3. **Walls.** Sliders for wall, floor and divider thickness and corner radius.
4. **Trays.** Add up to three lift-out trays that stack inside the box, each with its own height and dividers. Tap Box or Tray 1, 2, 3 to choose which one you're laying out. The bottom tray sits on a ledge round the inside walls, and the box's own dividers stop below the trays.
5. **Lid.** None, or a lift-off lid with a lip that sits inside the walls; dividers and trays stop below the lip. The lid and trays show beside the box, the way up they print.
6. **Download.** One STL per part (box, lid, each tray), each laid flat on the bed.

Units switch between millimetres and inches at the top right. Your design is saved in the browser.

The print rules (wall 0.8–5 mm, pockets at least 5 mm wide, sizes up to 300 × 300 × 250 mm) keep every design printable.

## Coming next

Mounting hardware presets and custom holes, stand-in objects to check fit, 3MF download and printer bed checks. The full plan is in the [version 1 spec](https://claude.ai/artifact/Tf282aTvgj7t2fVYiMJ5nk).

## One-time setup (owner only)

To switch the website on: in this repository go to **Settings → Pages**, and under **Build and deployment → Source** choose **GitHub Actions**. After that, every change to `main` updates the site automatically.

## For developers

Requires Node 22.

    npm install
    npm run dev        # local site at http://localhost:5173
    npm test           # the design rules and the exact solids for every layout
    npm run test:e2e   # opens the app on a phone-sized screen, drags dividers and handles, downloads the STL

| Folder | Contents |
| --- | --- |
| `index.html`, `src/main.js` | The app: the panel of controls, saving, downloads |
| `src/design.js` | A design as plain data (mm) and the print rules: limits, grids, moving and adding dividers |
| `src/view.js` | The three.js view: the built case, draggable dividers and resize handles |
| `src/cad/` | Exact solid engine (OpenCascade via [replicad](https://replicad.xyz), in a web worker): `case.js` builds the box and lid, `exports.js` the meshes and STL. Millimetres, Z up, front faces -Y |
| `tests/`, `e2e/` | Tests for the rules and solids, browser tests for the app |

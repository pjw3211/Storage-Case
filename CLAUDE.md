# Notes for Claude

- Owner (Pjw) does not program. Explain things in plain language; do the coding yourself.
- Spec: https://claude.ai/artifact/Tf282aTvgj7t2fVYiMJ5nk. Built the same way as pjw3211/Mid-Century-Workshop (Vite, three.js, replicad in a worker, GitHub Pages).
- Phone first: every control must work by touch. The view draws dividers and handles itself (src/view.js) so they move instantly; the engine only rebuilds the shell and lid.
- All sizes are millimetres inside the app; inches are only for display.
- Every change to a design goes through `normalize()` in src/design.js so the print rules always hold. New options need tests in tests/ (rules and solids) and, for anything you drag or tap, in e2e/.
- Run `npm test` and `npm run test:e2e` before pushing. Locally, set `CHROMIUM_PATH` if Chromium is preinstalled, and run `npm run build` first since Playwright reuses a running preview.

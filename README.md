# Freda Ops Cockpit Beta 0.2.39

Clean full package with POS-stable sync plus Uber/Frieda external-sales fallback display.

## Core rule

POS sync is unchanged from the stable V36/V34 path. Do not regress reporting.site browser POS sync while improving Uber, Frieda/Square, WhatsApp or priority messages.

## What changed in 0.2.39

- Keeps the proven POS browser sync path.
- Loads uploaded import cache automatically on first summary after a fresh deploy.
- Parses Uber workbook as backup/history for fallback, without treating it as live unless explicitly enabled.
- Displays Uber theoretical fallback when online/uploaded selected-day values are missing.
- Applies the Uber 1.35 uplift conversion for estimated units.
- Displays Frieda/Square WTD, MTD and last-month comparison.
- Displays Frieda/Square theoretical fallback when actual values are missing.
- Keeps WhatsApp upload limit at 200 MB.

## Render settings

```text
Root Directory: server
Build Command: npm install --no-audit --no-fund && npx playwright install chromium
Start Command: node server.js
Health Check Path: /health
```

Use Node 20.19.0.


## Beta 0.2.39 POS split-sync hotfix

V38 keeps the V37 external fallback display, but changes the POS buttons to call the proven one-store browser endpoint sequentially from the UI. This avoids one long Render request returning a 502 while still saving each successful store/date immediately.

- Sync selected POS day only: 3 small calls, one per store.
- Sync current + last days: selected date, WTD previous dates, and last four same-weekday benchmark dates, split by store/date.
- Uber/Frieda fallback remains display-only and does not modify POS sync.

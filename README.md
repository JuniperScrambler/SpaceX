# SpaceX Tracker

A mobile-first PWA dashboard for SpaceX launch schedules, recent cadence, and fleet trends.

## Highlights

- Next-launch countdown with Japanese local-time display
- Changes since the previous live data refresh
- Upcoming seven-day schedule and recent launch results
- Searchable launch history with favorites
- Optional favorite reminders when the installed PWA is opened or refreshed
- Cached and sample-data states shown clearly in the header

On iPhone, notifications require installing the PWA to the Home Screen. Reminders are checked when the app is opened or refreshed; background push delivery requires a separate push service.

## Live Checks

- Launch data: The Space Devs Launch Library 2
- Offline support: Service Worker cache
- Install support: Web app manifest
- Deployment target: GitHub Pages

## Local Preview

```sh
python3 -m http.server 4174
```

Then open `http://localhost:4174/#home`.

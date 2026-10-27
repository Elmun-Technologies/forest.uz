import { install, type TrackerApi } from './core';

/** Browser entry served as `/t.js`: installs once per page. */
const w = window as Window & typeof globalThis & { __forestTracker?: TrackerApi };
if (!w.__forestTracker) w.__forestTracker = install(w);

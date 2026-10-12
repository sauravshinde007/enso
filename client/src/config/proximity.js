// client/src/config/proximity.js
// Single source of truth for proximity audio/video distances (world pixels).
// Change these to change the proximity range everywhere (connect, disconnect, volume, minimap).

// Players closer than this get connected
export const PROXIMITY_RADIUS = 150;

// Once connected, players stay connected until they are farther than this.
// Slightly larger than PROXIMITY_RADIUS so standing on the edge doesn't flicker.
export const PROXIMITY_EXIT_RADIUS = 180;

// How often nearby players are re-evaluated and reported to the server
export const PROXIMITY_UPDATE_MS = 500;

// Media is kept this long after someone leaves range (returning within it is seamless)
export const PROXIMITY_LEAVE_GRACE_MS = 800;

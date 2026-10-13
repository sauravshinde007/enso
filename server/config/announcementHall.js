// server/config/announcementHall.js
// The open hall on the right side of map2.tmj. Keep in sync with client/src/config/announcementHall.js
export const ANNOUNCEMENT_HALL = { x: 1376, y: 416, width: 640, height: 544 };

export const isInHall = (p) =>
  !!p &&
  typeof p.x === "number" &&
  p.x >= ANNOUNCEMENT_HALL.x &&
  p.x <= ANNOUNCEMENT_HALL.x + ANNOUNCEMENT_HALL.width &&
  p.y >= ANNOUNCEMENT_HALL.y &&
  p.y <= ANNOUNCEMENT_HALL.y + ANNOUNCEMENT_HALL.height;

// Reminder sent this many minutes before an announcement starts
export const ANNOUNCEMENT_REMINDER_MINUTES = 10;
export const MAX_ANNOUNCEMENT_MINUTES = 240;

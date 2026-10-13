// client/src/config/announcementHall.js
// The open hall on the right side of map2.tmj. Keep HALL in sync with server/config/announcementHall.js
export const ANNOUNCEMENT_HALL = { x: 1376, y: 416, width: 640, height: 544 };

// Where the stage is built (top-center of the hall, against the wooden wall)
export const STAGE = {
  centerX: 1696,
  platform: { x: 1566, y: 424, width: 260, height: 84 },
  banner: { x: 1576, y: 338, width: 240, height: 66 }, // on the wall above the stage
  speakerSpot: { x: 1696, y: 486 },
};

export const isInHall = (x, y) =>
  x >= ANNOUNCEMENT_HALL.x &&
  x <= ANNOUNCEMENT_HALL.x + ANNOUNCEMENT_HALL.width &&
  y >= ANNOUNCEMENT_HALL.y &&
  y <= ANNOUNCEMENT_HALL.y + ANNOUNCEMENT_HALL.height;

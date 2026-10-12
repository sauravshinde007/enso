// server/services/livekitService.js
import { AccessToken } from "livekit-server-sdk";

// Every player joins this single SFU room. Who hears/sees whom is decided by
// selective subscription on the client (driven by server proximity updates),
// so moving around never requires leaving/joining rooms.
export const PROXIMITY_ROOM = process.env.LIVEKIT_PROXIMITY_ROOM || "metaverse-proximity";

export const getLivekitUrl = () => process.env.LIVEKIT_URL || "ws://localhost:7880";

/**
 * Token for the proximity room.
 * @param {string} identity - socket.id (lets clients map participants to players directly)
 * @param {string} name - username, shown as the participant name
 */
export const createProximityToken = async (identity, name) => {
  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY || "devkey",
    process.env.LIVEKIT_API_SECRET || "secret",
    { identity, name, ttl: "12h" }
  );

  at.addGrant({
    roomJoin: true,
    room: PROXIMITY_ROOM,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  });

  return at.toJwt();
};

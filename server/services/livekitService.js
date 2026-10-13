// server/services/livekitService.js
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

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
export const createProximityToken = async (identity, name, { canPublish = true } = {}) => {
  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY || "devkey",
    process.env.LIVEKIT_API_SECRET || "secret",
    { identity, name, ttl: "12h" }
  );

  at.addGrant({
    roomJoin: true,
    room: PROXIMITY_ROOM,
    canPublish,
    canSubscribe: true,
    canPublishData: false,
  });

  return at.toJwt();
};

let roomService = null;
const getRoomService = () => {
  if (!roomService) {
    const host = getLivekitUrl().replace(/^ws(s?):\/\//, "http$1://");
    roomService = new RoomServiceClient(host, process.env.LIVEKIT_API_KEY || "devkey", process.env.LIVEKIT_API_SECRET || "secret");
  }
  return roomService;
};

/**
 * Server-enforced mute: with canPublish=false LiveKit unpublishes the participant's
 * mic/camera and rejects new publishes. Used for the audience during a live announcement.
 * @returns {Promise<boolean>} true if applied (false e.g. when the participant hasn't joined yet)
 */
export const setProximityCanPublish = async (identity, canPublish) => {
  try {
    await getRoomService().updateParticipant(PROXIMITY_ROOM, identity, undefined, {
      canPublish,
      canSubscribe: true,
      canPublishData: false,
    });
    return true;
  } catch (err) {
    if (!/not found|does not exist|404/i.test(String(err?.message))) {
      console.error(`LiveKit permission update failed for ${identity}:`, err.message);
    }
    return false;
  }
};

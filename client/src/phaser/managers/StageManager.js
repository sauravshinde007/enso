// client/src/phaser/managers/StageManager.js
// Announcement Hall: builds a stage (with a construction animation) as soon as an announcement
// is declared, lights it up while live, removes it when nothing is scheduled, and reports
// whether the local player is inside the hall.
import { ANNOUNCEMENT_HALL, STAGE, isInHall } from "../../config/announcementHall";

const fmtTime = (d) => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDay = (d) => {
    const date = new Date(d);
    const today = new Date();
    return date.toDateString() === today.toDateString()
        ? "Today"
        : date.toLocaleDateString([], { day: "numeric", month: "short" });
};
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export default class StageManager {
    constructor(scene) {
        this.scene = scene;
        this.state = { live: null, upcoming: [] };
        this.stageFor = null;   // announcement id the stage is built for
        this.pieces = [];       // stage game objects
        this.liveFx = [];       // spotlights / ON AIR (only while live)
        this.titleText = null;
        this.subText = null;
        this.inHall = false;

        this.onState = (e) => this.setState(e.detail);
    }

    create() {
        this.drawHallSign();
        window.addEventListener("announcement-state", this.onState);
        // State may have arrived before the scene existed
        if (window.__announcementState) this.setState(window.__announcementState);

        this.scene.events.once("shutdown", () => this.destroy());
        this.scene.events.once("destroy", () => this.destroy());
    }

    destroy() {
        window.removeEventListener("announcement-state", this.onState);
    }

    // Permanent plaque so people can find the hall
    drawHallSign() {
        const x = ANNOUNCEMENT_HALL.x + 24;
        const y = 352;
        const g = this.scene.add.graphics().setDepth(2);
        g.fillStyle(0x000000, 0.25).fillRect(x + 2, y + 3, 120, 34);
        g.fillStyle(0x1e1b4b, 1).fillRect(x, y, 120, 34);
        g.lineStyle(2, 0xfbbf24, 1).strokeRect(x, y, 120, 34);
        this.scene.add.text(x + 60, y + 11, "ANNOUNCEMENT", { fontFamily: "monospace", fontSize: "9px", color: "#fde68a" })
            .setOrigin(0.5).setDepth(2).setResolution(3);
        this.scene.add.text(x + 60, y + 24, "HALL", { fontFamily: "monospace", fontSize: "9px", color: "#fde68a" })
            .setOrigin(0.5).setDepth(2).setResolution(3);
    }

    setState(state) {
        this.state = state || { live: null, upcoming: [] };
        const target = this.state.live || this.state.upcoming?.[0] || null;

        if (!target) {
            this.teardownStage();
            return;
        }
        if (this.stageFor !== target._id) {
            this.teardownStage(true);
            this.buildStage();
            this.stageFor = target._id;
        }
        this.updateBanner(target, !!this.state.live);
        this.setLive(!!this.state.live);
    }

    // ---------- Stage construction ----------

    buildStage() {
        const s = this.scene;
        const { platform: P, banner: B } = STAGE;
        const parts = [];

        // Banner on the wall
        const banner = s.add.graphics().setDepth(2);
        banner.fillStyle(0x000000, 0.3).fillRect(B.x + 3, B.y + 4, B.width, B.height);
        banner.fillStyle(0x1e1b4b, 1).fillRect(B.x, B.y, B.width, B.height);
        banner.lineStyle(3, 0xfbbf24, 1).strokeRect(B.x, B.y, B.width, B.height);
        banner.fillStyle(0xfbbf24, 1).fillRect(B.x + 8, B.y + 20, B.width - 16, 1);
        parts.push(banner);

        const header = s.add.text(B.x + B.width / 2, B.y + 11, "ANNOUNCEMENT", {
            fontFamily: "monospace", fontSize: "9px", color: "#fde68a",
        }).setOrigin(0.5).setDepth(2).setResolution(3);
        this.titleText = s.add.text(B.x + B.width / 2, B.y + 34, "", {
            fontFamily: "monospace", fontSize: "11px", color: "#ffffff", fontStyle: "bold",
        }).setOrigin(0.5).setDepth(2).setResolution(3);
        this.subText = s.add.text(B.x + B.width / 2, B.y + 51, "", {
            fontFamily: "monospace", fontSize: "8px", color: "#c7d2fe",
        }).setOrigin(0.5).setDepth(2).setResolution(3);
        parts.push(header, this.titleText, this.subText);

        // Platform
        const platform = s.add.graphics().setDepth(1.5);
        platform.fillStyle(0x000000, 0.3).fillRect(P.x + 4, P.y + 6, P.width, P.height + 16);
        platform.fillStyle(0xa16207, 1).fillRect(P.x, P.y, P.width, P.height);
        platform.fillStyle(0x854d0e, 1);
        for (let py = P.y + 12; py < P.y + P.height; py += 12) platform.fillRect(P.x, py, P.width, 1);
        platform.fillStyle(0x713f12, 1).fillRect(P.x, P.y + P.height, P.width, 16);       // front face
        platform.fillStyle(0xb91c1c, 1).fillRect(P.x, P.y + P.height, P.width, 4);        // red trim
        platform.fillStyle(0xfbbf24, 1);
        for (let px = P.x + 10; px < P.x + P.width; px += 26) platform.fillCircle(px, P.y + P.height + 10, 1.5);
        parts.push(platform);

        // Steps
        const steps = s.add.graphics().setDepth(1.5);
        steps.fillStyle(0x854d0e, 1).fillRect(STAGE.centerX - 22, P.y + P.height + 16, 44, 8);
        steps.fillStyle(0x713f12, 1).fillRect(STAGE.centerX - 26, P.y + P.height + 24, 52, 8);
        parts.push(steps);

        // Speaker boxes
        const boxes = s.add.graphics().setDepth(2);
        [P.x + 6, P.x + P.width - 24].forEach((bx) => {
            boxes.fillStyle(0x18181b, 1).fillRect(bx, P.y + 8, 18, 34);
            boxes.fillStyle(0x3f3f46, 1).fillCircle(bx + 9, P.y + 18, 5).fillCircle(bx + 9, P.y + 33, 4);
        });
        parts.push(boxes);

        // Podium + mic
        const podium = s.add.graphics().setDepth(2);
        const px = STAGE.centerX - 13;
        const py = P.y + 18;
        podium.fillStyle(0x27272a, 1).fillRect(px, py, 26, 30);
        podium.fillStyle(0x3f3f46, 1).fillRect(px - 3, py - 3, 32, 5);
        podium.fillStyle(0xfbbf24, 1).fillCircle(px + 13, py + 15, 4);
        podium.lineStyle(2, 0x71717a, 1).lineBetween(px + 13, py - 3, px + 13, py - 12);
        podium.fillStyle(0x52525b, 1).fillCircle(px + 13, py - 14, 3);
        parts.push(podium);

        // Audience mats
        const mats = s.add.graphics().setDepth(1);
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 8; col++) {
                const mx = 1528 + col * 44;
                const my = 584 + row * 56;
                mats.fillStyle(0x6366f1, 0.35).fillRoundedRect(mx, my, 26, 14, 4);
            }
        }
        parts.push(mats);

        // Construction animation: pieces drop in one after another
        parts.forEach((obj, i) => {
            const finalY = obj.y;
            obj.setAlpha(0);
            obj.y = finalY - 14;
            s.tweens.add({
                targets: obj,
                alpha: 1,
                y: finalY,
                duration: 380,
                delay: i * 110,
                ease: "Back.Out",
            });
        });
        this.pieces = parts;

        // A little "hammer" puff over the stage while it's being built
        const puff = s.add.text(STAGE.centerX, P.y + P.height / 2, "STAGE READY", {
            fontFamily: "monospace", fontSize: "10px", color: "#fde68a", backgroundColor: "#1e1b4bcc", padding: { x: 4, y: 2 },
        }).setOrigin(0.5).setDepth(6).setAlpha(0).setResolution(3);
        s.tweens.add({
            targets: puff, alpha: 1, y: puff.y - 20, delay: parts.length * 110, duration: 500,
            yoyo: true, hold: 900, onComplete: () => puff.destroy(),
        });
    }

    updateBanner(a, live) {
        if (!this.titleText) return;
        this.titleText.setText(truncate(a.title, 30));
        this.subText.setText(
            live
                ? `LIVE · ${truncate(a.speakerName, 14)} · until ${fmtTime(a.endTime)}`
                : `${truncate(a.speakerName, 14)} · ${fmtDay(a.startTime)} ${fmtTime(a.startTime)}-${fmtTime(a.endTime)}`
        );
    }

    setLive(live) {
        if (live && this.liveFx.length === 0) {
            const s = this.scene;
            const { banner: B, platform: P } = STAGE;

            const beams = s.add.graphics().setDepth(4).setBlendMode("ADD");
            beams.fillStyle(0xfde68a, 0.12);
            beams.fillTriangle(B.x + 20, B.y + B.height, STAGE.centerX - 46, P.y + P.height, STAGE.centerX + 6, P.y + P.height);
            beams.fillTriangle(B.x + B.width - 20, B.y + B.height, STAGE.centerX + 46, P.y + P.height, STAGE.centerX - 6, P.y + P.height);
            s.tweens.add({ targets: beams, alpha: 0.45, duration: 1200, yoyo: true, repeat: -1, ease: "Sine.InOut" });

            const onAir = s.add.graphics().setDepth(2);
            onAir.fillStyle(0xdc2626, 1).fillRoundedRect(B.x + B.width - 50, B.y + 5, 42, 12, 3);
            const onAirText = s.add.text(B.x + B.width - 29, B.y + 11, "ON AIR", {
                fontFamily: "monospace", fontSize: "8px", color: "#ffffff", fontStyle: "bold",
            }).setOrigin(0.5).setDepth(2).setResolution(3);
            s.tweens.add({ targets: [onAir, onAirText], alpha: 0.35, duration: 700, yoyo: true, repeat: -1 });

            this.liveFx = [beams, onAir, onAirText];
        } else if (!live && this.liveFx.length) {
            this.liveFx.forEach((o) => { this.scene.tweens.killTweensOf(o); o.destroy(); });
            this.liveFx = [];
        }
    }

    teardownStage(immediate = false) {
        this.setLive(false);
        const pieces = this.pieces;
        this.pieces = [];
        this.titleText = null;
        this.subText = null;
        this.stageFor = null;
        pieces.forEach((obj) => {
            this.scene.tweens.killTweensOf(obj);
            if (immediate) {
                obj.destroy();
            } else {
                this.scene.tweens.add({ targets: obj, alpha: 0, duration: 400, onComplete: () => obj.destroy() });
            }
        });
    }

    // ---------- Presence / audio helpers ----------

    update(player) {
        if (!player) return;
        const inHall = isInHall(player.x, player.y);
        if (inHall !== this.inHall) {
            this.inHall = inHall;
            window.__inAnnouncementHall = inHall;
            window.dispatchEvent(new CustomEvent("hall-presence", { detail: { inHall } }));
        }
    }

    /** True if `socketId` is the live speaker and we're listening in the hall -> play at full volume */
    isBroadcastFrom(socketId) {
        const live = this.state.live;
        if (!live || !this.inHall) return false;
        const username = this.scene.playerManager?.playerUsernames.get(socketId);
        return username === live.speakerName;
    }
}


import Phaser from "phaser";
import socketService from "../../services/socketService";
import Pathfinder from "../utils/Pathfinder";

export default class PlayerManager {
    constructor(scene, inputManager, mapManager) {
        this.scene = scene;
        this.inputManager = inputManager;
        this.mapManager = mapManager;

        this.player = null; // Local player sprite
        this.playerUsernameText = null;

        this.players = {}; // Remote player containers
        this.playerUsernames = new Map(); // id -> username

        this.movement = { up: false, down: false, left: false, right: false };
        this.lastDirection = "down";
        this.currentAnimation = "idle-down";

        // Joystick
        this.joystickBase = null;
        this.joystickThumb = null;
        this.joystickActive = false;
        this.joystickDirection = { up: false, down: false, left: false, right: false };

        this.currentZoneId = null;

        // Interaction UI
        this.interactionText = null;
        // Interaction UI
        this.interactionText = null;
        this.currentInteractable = null;

        this.isInMeeting = false;
        this.isUsingComputer = false;
        this.isAutoWalking = false;

        // Events
        this.scene.events.on("gameInput", (input) => this.handleGameInput(input));
        window.addEventListener("meeting-status-change", (e) => {
            this.isInMeeting = e.detail.active;
            console.log("Meeting status changed. Active:", this.isInMeeting);
        });

        window.addEventListener("close-computer", () => {
            this.isUsingComputer = false;
            socketService.emitWorking(false);
            if (this.player) {
                this.setWorkingStatus(this.player, false, true);
            }
            console.log("🖥️ Computer interaction closed");
        });

        // Teleport Event Listener
        window.addEventListener("teleport-player", (e) => {
            if (!this.player) return;
            const { zoneId } = e.detail;
            const zone = this.mapManager.restrictedZones.find(z => z.id === zoneId);
            if (zone) {
                this.scene.tweens.killTweensOf(this.player);
                this.player.x = zone.x + zone.width / 2;
                this.player.y = zone.y + zone.height / 2 + 10; // offset slightly down
                // Brief glow effect on teleport
                const fx = this.player.preFX.addGlow(0x00ffff, 4, 0, false, 0.1, 10);
                this.scene.time.delayedCall(1000, () => {
                    if (this.player && this.player.preFX) this.player.preFX.remove(fx);
                });
            }
        });

        // Fast travel to assigned desk
        window.addEventListener("walk-to-desk", () => {
            if (!this.player) return;

            if (!this.assignedComputerId) {
                this.showAccessDenied("No Desk Assigned", true);
                return;
            }

            const computer = this.mapManager.interactables.find(obj => {
                const compId = String(obj.id || `computer_${obj.x}_${obj.y}`);
                return compId === String(this.assignedComputerId);
            });

            if (computer) {
                this.scene.tweens.killTweensOf(this.player);
                
                const targetX = computer.x + computer.width / 2;
                const targetY = computer.y + computer.height / 2;

                // Stop active manual movement
                this.movement = { up: false, down: false, left: false, right: false };
                this.player.body.setVelocity(0);

                // Initialize Pathfinder strictly caching static map elements
                if (!this.pathfinder) {
                    this.pathfinder = new Pathfinder(this.mapManager);
                }

                // Retrieve A* sequence arrays avoiding colliders gracefully
                const path = this.pathfinder.findPath(this.player.x, this.player.y, targetX, targetY);

                if (path && path.length > 0) {
                    this.followPathSequence(path);
                } else {
                    this.showAccessDenied("No valid path to desk found", true);
                }
            } else {
                this.showAccessDenied("Desk not found on Map", true);
            }
        });

        // Poll for dynamic room locks (every 5 seconds)
        this.lockedZonesInterval = setInterval(async () => {
            const token = localStorage.getItem("token");
            if (!token) return;
            const serverUrl = import.meta.env.VITE_SOCKET_SERVER_URL || 'http://localhost:3001';
            try {
                const res = await fetch(`${serverUrl}/api/meeting/locked-zones`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json();
                if (data.blockedZones) {
                    this.mapManager.dynamicBlockedZones = data.blockedZones;
                    this.mapManager.updateZoneVisuals(this.player ? this.player.role : 'employee');
                }
            } catch (err) { }
        }, 5000);
    }

    followPathSequence(path) {
        this.isAutoWalking = true;
        this.player.body.checkCollision.none = true;
        this.scene.tweens.killTweensOf(this.player);

        let pathIndex = 0;
        
        const walkToNextNode = () => {
            // Give user control to override gracefully
            let isMovingManually = this.movement.left || this.movement.right || this.movement.up || this.movement.down;
            if (isMovingManually || !this.isAutoWalking) {
                this.isAutoWalking = false;
                this.player.body.checkCollision.none = false;
                return;
            }

            if (pathIndex >= path.length) {
                this.isAutoWalking = false;
                this.player.body.checkCollision.none = false;
                this.stopAnimation();
                
                const fx = this.player.preFX.addGlow(0x00ffff, 4, 0, false, 0.1, 10);
                this.scene.time.delayedCall(1200, () => {
                    if (this.player && this.player.preFX) this.player.preFX.remove(fx);
                });
                return;
            }

            const target = path[pathIndex];
            const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, target.x, target.y);
            const duration = (distance / 200) * 1000;

            this.scene.tweens.add({
                targets: this.player,
                x: target.x,
                y: target.y,
                duration: duration,
                ease: 'Linear',
                onUpdate: () => {
                    const dx = target.x - this.player.x;
                    const dy = target.y - this.player.y;
                    
                    if (Math.abs(dx) > Math.abs(dy)) {
                        this.currentAnimation = dx > 0 ? "walk-right" : "walk-left";
                        this.lastDirection = dx > 0 ? "right" : "left";
                    } else if (Math.abs(dy) > Math.abs(dx)) {
                        this.currentAnimation = dy > 0 ? "walk-down" : "walk-up";
                        this.lastDirection = dy > 0 ? "down" : "up";
                    }
                    this.player.anims.play(this.currentAnimation, true);

                    if (this.scene.cameraManager) {
                        this.scene.cameraManager.checkResumeFollow(1, 1);
                    }
                },
                onComplete: () => {
                    pathIndex++;
                    walkToNextNode();
                }
            });
        };

        walkToNextNode();
    }

    createAnimations() {
        const anims = this.scene.anims;
        // Idle
        anims.create({ key: "idle-right", frames: anims.generateFrameNumbers("ash", { start: 0, end: 5 }), repeat: -1, frameRate: 15 });
        anims.create({ key: "idle-up", frames: anims.generateFrameNumbers("ash", { start: 6, end: 11 }), repeat: -1, frameRate: 15 });
        anims.create({ key: "idle-left", frames: anims.generateFrameNumbers("ash", { start: 12, end: 17 }), repeat: -1, frameRate: 15 });
        anims.create({ key: "idle-down", frames: anims.generateFrameNumbers("ash", { start: 18, end: 23 }), repeat: -1, frameRate: 15 });
        // Walk
        anims.create({ key: "walk-right", frames: anims.generateFrameNumbers("ash", { start: 24, end: 29 }), frameRate: 10, repeat: -1 });
        anims.create({ key: "walk-up", frames: anims.generateFrameNumbers("ash", { start: 30, end: 35 }), frameRate: 10, repeat: -1 });
        anims.create({ key: "walk-left", frames: anims.generateFrameNumbers("ash", { start: 36, end: 41 }), frameRate: 10, repeat: -1 });
        anims.create({ key: "walk-down", frames: anims.generateFrameNumbers("ash", { start: 42, end: 47 }), frameRate: 15, repeat: -1 });

        anims.create({ key: "sit-down", frames: [{ key: "ash", frame: 48 }], frameRate: 1 });
        anims.create({ key: "sit-left", frames: [{ key: "ash", frame: 49 }], frameRate: 1 });
        anims.create({ key: "sit-right", frames: [{ key: "ash", frame: 50 }], frameRate: 1 });
        anims.create({ key: "sit-up", frames: [{ key: "ash", frame: 51 }], frameRate: 1 });
    }

    createLocalPlayer(x, y, username) {

        this.player = this.scene.physics.add.sprite(x, y, "ash");

        // Glow
        const localGlow = this.player.preFX.addGlow(0xffffff, 4, 0, false, 0.1, 10);
        localGlow.setActive(false);
        this.player.setInteractive();
        this.player.on('pointerover', () => localGlow.setActive(true));
        this.player.on('pointerout', () => localGlow.setActive(false));

        this.player.setDepth(5);
        this.player.setCollideWorldBounds(true);

        // Colliders
        if (this.mapManager.layers.walls) this.scene.physics.add.collider(this.player, this.mapManager.layers.walls);
        if (this.mapManager.layers.props) this.scene.physics.add.collider(this.player, this.mapManager.layers.props);

        // Username text
        this.playerUsernameText = this.scene.add
            .text(x, y - 30, "You", {
                fontFamily: 'Inter',
                fontSize: "14px", fill: "#90EE90", fontStyle: "bold",
                stroke: "#000000", strokeThickness: 3,
            })
            .setOrigin(0.5)
            .setResolution(2)
            .setDepth(6);

        this.createMobileJoystick();
    }

    addOtherPlayer(id, data) {
        if (this.players[id]) this.players[id].destroy();

        // Create a wrapper object that mimics a Phaser object with x/y properties
        const remotePlayer = {
            scene: this.scene,
            _x: data.x,
            _y: data.y,
            sprite: this.scene.add.sprite(data.x, data.y, "ash"),
            nameText: this.scene.add.text(data.x, data.y - 30, data.username, {
                fontFamily: 'Inter',
                fontSize: "14px", fill: "#ffffff", fontStyle: "bold",
                stroke: "#000000", strokeThickness: 3,
            }).setOrigin(0.5).setResolution(2),
            workingText: null,

            get x() { return this._x; },
            set x(val) {
                this._x = val;
                this.sprite.x = val;
                this.nameText.x = val;
                if (this.workingText) this.workingText.x = val;
            },

            get y() { return this._y; },
            set y(val) {
                this._y = val;
                this.sprite.y = val;
                this.nameText.y = val - 30;
                if (this.workingText) this.workingText.y = val - 48;
            },

            destroy() {
                this.sprite.destroy();
                this.nameText.destroy();
                if (this.workingText) this.workingText.destroy();
            }
        };

        // Glow
        const remoteGlow = remotePlayer.sprite.preFX.addGlow(0xffffff, 4, 0, false, 0.1, 10);
        remoteGlow.setActive(false);
        remotePlayer.sprite.setInteractive();
        remotePlayer.sprite.on('pointerover', () => remoteGlow.setActive(true));
        remotePlayer.sprite.on('pointerout', () => remoteGlow.setActive(false));

        remotePlayer.sprite.setDepth(5);
        remotePlayer.nameText.setDepth(6);
        
        if (data.anim) remotePlayer.sprite.anims.play(data.anim, true);
        else remotePlayer.sprite.setFrame(18);

        this.players[id] = remotePlayer;
        this.playerUsernames.set(id, data.username);

        if (data.isWorking) {
            this.setWorkingStatus(remotePlayer, true, false);
        }
    }

    removePlayer(id) {
        if (this.players[id]) {
            this.players[id].destroy();
            delete this.players[id];
            this.playerUsernames.delete(id);
        }
    }

    moveRemotePlayer(id, pos, anim) {
        const remotePlayer = this.players[id];
        if (remotePlayer) {
            this.scene.tweens.killTweensOf(remotePlayer); // Prevent overlaps from building up!
            this.scene.tweens.add({
                targets: remotePlayer,
                x: pos.x,
                y: pos.y,
                duration: 120,
                ease: "Linear",
            });
            if (anim && remotePlayer.sprite.anims) remotePlayer.sprite.anims.play(anim, true);
        }
    }

    handleGameInput(input) {
        const { type, action } = input;
        const isDown = type === "keydown";

        switch (action) {
            case "MOVE_UP": this.movement.up = isDown; break;
            case "MOVE_DOWN": this.movement.down = isDown; break;
            case "MOVE_LEFT": this.movement.left = isDown; break;
            case "MOVE_RIGHT": this.movement.right = isDown; break;
            case "INTERACT":
                if (isDown) {
                    console.log("Player interaction");
                    this.handleInteraction();
                }
                break;
        }
    }

    handleInteraction() {
        if (!this.player) return;
        const interactable = this.currentInteractable; // Use tracked interactable from update loop

        if (interactable) {
            console.log("Interact with:", interactable);

            // 1. Chairs in Meeting Rooms -> Trigger Meeting
            if (interactable.type === 'chair') {
                const chairCenterX = interactable.x + interactable.width / 2;
                const chairCenterY = interactable.y + interactable.height / 2 - 10;

                // Check if chair is occupied by another player
                let isOccupied = false;
                for (let id in this.players) {
                    const p = this.players[id];
                    if (Phaser.Math.Distance.Between(chairCenterX, chairCenterY, p.x, p.y) < 15) {
                        isOccupied = true;
                        break;
                    }
                }

                if (isOccupied) {
                    const toast = this.scene.add.text(this.player.x, this.player.y - 60, `Seat taken`, {
                        fontFamily: 'Inter', fontSize: '14px', fill: '#ff4444',
                        backgroundColor: '#000000aa', padding: { x: 5, y: 5 }
                    }).setOrigin(0.5).setDepth(100);
                    this.scene.tweens.add({ targets: toast, y: toast.y - 30, alpha: 0, duration: 1500, onComplete: () => toast.destroy() });
                    return;
                }

                // Determine facing direction from custom property "dir" or "direction" set in Tiled
                // If not set, default to 'up' or 'down' based on chair position?
                // Tiled Property: "dir" : "up" | "down" | "left" | "right"
                const dirProp = interactable.rawProperties && interactable.rawProperties.find(p => p.name === "dir");
                const direction = dirProp ? dirProp.value : "down";

                // Play Sitting Animation
                if (this.player && this.player.anims) {
                    this.player.anims.play(`sit-${direction}`, true);
                    this.player.body.setVelocity(0); // Stop movement
                    this.currentAnimation = `sit-${direction}`; // Lock animation
                }

                // Align position to center of chair
                this.player.x = interactable.x + interactable.width / 2;
                this.player.y = interactable.y + interactable.height / 2 - 10; // Offset slightly for visual depth

                // Ensure we are logically in a meeting room zone
                if (this.currentZoneId && this.currentZoneId.startsWith('meeting_room')) {
                    window.dispatchEvent(new CustomEvent('enter-meeting-zone', {
                        detail: {
                            zoneId: this.currentZoneId,
                            zoneName: "Meeting Room"
                        }
                    }));
                }
            }

            // 2. Computers -> Trigger Computer UI
            else if (interactable.type === 'computer') {
                console.log("🖥️ Computer interaction triggered");

                const computerId = String(interactable.id || `computer_${interactable.x}_${interactable.y}`);

                // Desk ownership check
                if (!this.assignedComputerId) {
                    this.showAccessDenied("Access Denied: No Desk Assigned", true);
                    return;
                }

                if (String(this.assignedComputerId) !== computerId) {
                    this.showAccessDenied("Access Denied: Not Your Desk", true);
                    return;
                }

                // Determine facing direction from custom property "dir"
                const dirProp = interactable.rawProperties && interactable.rawProperties.find(p => p.name === "dir");
                const computerDir = dirProp ? dirProp.value : "down";

                let playerFacing = "up";
                if (computerDir === "down") playerFacing = "up";
                else if (computerDir === "up") playerFacing = "down";
                else if (computerDir === "left") playerFacing = "right";
                else if (computerDir === "right") playerFacing = "left";

                this.currentAnimation = `idle-${playerFacing}`;
                this.lastDirection = playerFacing;
                this.player.anims.play(this.currentAnimation, true);
                this.player.body.setVelocity(0);

                this.isUsingComputer = true;
                socketService.emitWorking(true);
                this.setWorkingStatus(this.player, true, true);
                window.dispatchEvent(new CustomEvent('open-computer', { 
                    detail: { computerId } 
                }));
            }
        }
    }

    update(myRole) {
        if (!this.player || !this.player.body) return;

        // Chat Focus check
        if (this.inputManager.chatFocused || this.isUsingComputer) {
            this.player.body.setVelocity(0);
            return;
        }

        // RBAC Check
        const access = this.mapManager.checkZoneAccess(this.player, myRole);
        this.mapManager.updateImmersion(access.zone);

        if (!access.allowed && access.zone) {
            const zone = access.zone;
            const centerX = zone.x + zone.width / 2;
            const centerY = zone.y + zone.height / 2;
            const angle = Phaser.Math.Angle.Between(centerX, centerY, this.player.x, this.player.y);
            this.player.x += Math.cos(angle) * 5;
            this.player.y += Math.sin(angle) * 5;
            this.showAccessDenied(zone.name, access.isReserved);
        } else {
            // Access allowed. Check if zone changed.
            const newZoneId = access.zone ? access.zone.id : null;

            if (newZoneId !== this.currentZoneId) {
                // Leaving previous zone
                if (this.currentZoneId && this.currentZoneId.startsWith('meeting_room')) {
                    window.dispatchEvent(new CustomEvent('leave-meeting-zone', { detail: { zoneId: this.currentZoneId } }));
                }

                // Entering new zone logic removed - wait for Interaction
                this.currentZoneId = newZoneId;
            }
        }

        // Movement
        const speed = 200;
        this.player.body.setVelocity(0);

        let dx = 0;
        let dy = 0;

        if (this.movement.left) dx = -1;
        else if (this.movement.right) dx = 1;
        if (this.movement.up) dy = -1;
        else if (this.movement.down) dy = 1;

        this.player.body.setVelocityX(dx * speed);
        this.player.body.setVelocityY(dy * speed);
        this.player.body.velocity.normalize().scale(speed);

        // Resume Camera Follow if moving
        if (dx !== 0 || dy !== 0) {
            this.scene.cameraManager.checkResumeFollow(dx, dy);
        }

        // Animation
        if (this.currentAnimation.startsWith('sit-')) {
            // If dragging joystick or pressing keys, break out of sit
            if (this.player.body.velocity.x !== 0 || this.player.body.velocity.y !== 0) {
                // Moving, so let normal logic take over
            } else {
                // Still sitting, do not override
                return;
            }
        }

        // Cancel AutoWalk if player presses manual movement key
        let isMovingManually = this.movement.left || this.movement.right || this.movement.up || this.movement.down;
        if (this.isAutoWalking && isMovingManually) {
            this.isAutoWalking = false;
            this.player.body.checkCollision.none = false;
            this.scene.tweens.killTweensOf(this.player);
        }

        if (!this.isAutoWalking) {
            if (this.player.body.velocity.x < 0) {
                this.currentAnimation = "walk-left";
                this.lastDirection = "left";
            } else if (this.player.body.velocity.x > 0) {
                this.currentAnimation = "walk-right";
                this.lastDirection = "right";
            } else if (this.player.body.velocity.y < 0) {
                this.currentAnimation = "walk-up";
                this.lastDirection = "up";
            } else if (this.player.body.velocity.y > 0) {
                this.currentAnimation = "walk-down";
                this.lastDirection = "down";
            } else {
                this.currentAnimation = `idle-${this.lastDirection}`;
            }

            this.player.anims.play(this.currentAnimation, true);
        }

        // Calculate time for throttling
        const now = Date.now();

        // Update text position
        if (this.playerUsernameText) {
            this.playerUsernameText.setPosition(this.player.x, this.player.y - 30);
        }

        // Limit Minimap Updates (10fps is enough)
        if (!this.lastMinimapUpdate || now - this.lastMinimapUpdate > 100) {
            // 📡 Dispatch Minimap Data
            const otherPlayers = Object.keys(this.players).map(id => ({
                id,
                x: this.players[id].x,
                y: this.players[id].y
            }));

            window.dispatchEvent(new CustomEvent('minimap-update', {
                detail: {
                    me: { x: this.player.x, y: this.player.y },
                    others: otherPlayers
                }
            }));
            this.lastMinimapUpdate = now;
        }

        // Limit Interaction UI Updates (10fps is enough)
        if (!this.lastInteractionUpdate || now - this.lastInteractionUpdate > 100) {
            this.updateInteractionUI();
            this.lastInteractionUpdate = now;
        }
    }



    updateInteractionUI() {
        if (!this.player) return;

        // Check constantly for nearby interaction
        const interactable = this.mapManager.getNearestInteractable(this.player.x, this.player.y);

        // Show/Hide prompt
        if (interactable) {
            if (!this.interactionText) {
                this.interactionText = this.scene.add.text(0, 0, "Press E to Interact", {
                    fontFamily: 'Inter',
                    fontSize: '12px',
                    backgroundColor: '#000000aa',
                    padding: { x: 6, y: 4 },
                    fill: '#ffffff'
                }).setOrigin(0.5).setDepth(200).setResolution(2);
            }

            // Position above player (or object?)
            // Let's position it above the object to attract attention
            this.interactionText.setPosition(interactable.x + interactable.width / 2, interactable.y - 20);
            this.interactionText.setVisible(true);
            this.currentInteractable = interactable;
        } else {
            if (this.interactionText) {
                this.interactionText.setVisible(false);
            }
            this.currentInteractable = null;
        }
    }

    stopAnimation() {
        this.movement = { up: false, down: false, left: false, right: false };
        const idleAnim = `idle-${this.lastDirection}`;
        if (this.currentAnimation !== idleAnim) {
            this.currentAnimation = idleAnim;
            this.player.anims.play(this.currentAnimation, true);
        }
    }

    showAccessDenied(zoneName, isReserved = false) {
        if (this._lastWarning && Date.now() - this._lastWarning < 1000) return;
        this._lastWarning = Date.now();

        const msg = isReserved ? `🔒 ${zoneName} is Reserved` : `🔒 Access to ${zoneName} Denied`;

        const toast = this.scene.add.text(this.player.x, this.player.y - 60, msg, {
            fontFamily: 'Inter',
            fontSize: '16px', fontStyle: 'bold',
            fill: '#ff0000', stroke: '#ffffff', strokeThickness: 4,
            backgroundColor: '#00000088',
            padding: { x: 10, y: 5 }
        }).setOrigin(0.5).setDepth(100).setResolution(2);

        this.scene.tweens.add({
            targets: toast,
            y: toast.y - 50,
            alpha: 0,
            duration: 1500,
            onComplete: () => toast.destroy()
        });
    }

    showReaction(targetSprite, emoji) {
        if (!targetSprite) return;
        const x = targetSprite.x;
        const y = targetSprite.y - 50;

        const emojiText = this.scene.add.text(x, y, emoji, {
            fontFamily: 'Inter', fontSize: "32px",
        }).setOrigin(0.5).setDepth(100).setResolution(2);

        this.scene.tweens.add({
            targets: emojiText,
            y: y - 40,
            alpha: 0,
            duration: 2000,
            ease: "Power1",
            onComplete: () => emojiText.destroy()
        });
    }

    setWorkingStatus(entity, isWorking, isLocalPlayer) {
        if (!entity) return;

        if (isWorking) {
            if (!entity.workingText) {
                const text = this.scene.add.text(entity.x, entity.y - 48, "Working...", {
                    fontFamily: 'Inter',
                    fontSize: "10px", fill: "#60a5fa", fontStyle: "bold",
                    backgroundColor: "#000000cc", padding: { x: 5, y: 3 }
                }).setOrigin(0.5).setResolution(2).setDepth(100);

                entity.workingText = text;
            }
            entity.workingText.setVisible(true);

            this.scene.tweens.add({
                targets: entity.workingText,
                alpha: 0.5,
                yoyo: true,
                repeat: -1,
                duration: 800
            });
        } else {
            if (entity.workingText) {
                this.scene.tweens.killTweensOf(entity.workingText);
                entity.workingText.destroy();
                entity.workingText = null;
            }
        }
    }

    // --- Mobile Joystick ---
    isMobileDevice() {
        const device = this.scene.sys.game.device;
        const smallScreen = window.innerWidth <= 768;
        return !device.os.desktop || smallScreen;
    }

    createMobileJoystick() {
        if (!this.isMobileDevice()) return;

        const radius = 50;
        const thumbRadius = 25;
        this.joystickBase = this.scene.add.circle(0, 0, radius, 0x000000, 0.25).setScrollFactor(0).setDepth(1000).setVisible(false);
        this.joystickThumb = this.scene.add.circle(0, 0, thumbRadius, 0xffffff, 0.7).setScrollFactor(0).setDepth(1001).setVisible(false);

        this.scene.input.on("pointerdown", (pointer) => {
            if (!this.isMobileDevice() || this.inputManager.chatFocused) return;
            if (pointer.x > this.scene.cameras.main.width / 2) return;

            this.joystickActive = true;
            this.joystickBase.setPosition(pointer.x, pointer.y).setVisible(true);
            this.joystickThumb.setPosition(pointer.x, pointer.y).setVisible(true);
            this.updateJoystick(pointer);
        });

        this.scene.input.on("pointermove", (pointer) => {
            if (this.joystickActive) this.updateJoystick(pointer);
        });

        this.scene.input.on("pointerup", () => {
            if (this.joystickActive) {
                this.joystickActive = false;
                this.joystickBase.setVisible(false);
                this.joystickThumb.setVisible(false);
                this.applyJoystickDir({ up: false, down: false, left: false, right: false });
            }
        });
    }

    updateJoystick(pointer) {
        const baseX = this.joystickBase.x;
        const baseY = this.joystickBase.y;
        const dx = pointer.x - baseX;
        const dy = pointer.y - baseY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = 60;

        let offsetX = dx, offsetY = dy;
        if (dist > maxDist) {
            const scale = maxDist / dist;
            offsetX = dx * scale;
            offsetY = dy * scale;
        }
        this.joystickThumb.setPosition(baseX + offsetX, baseY + offsetY);

        const deadZone = 10;
        if (dist < deadZone) {
            this.applyJoystickDir({ up: false, down: false, left: false, right: false });
            return;
        }

        const dir = { up: false, down: false, left: false, right: false };
        if (Math.abs(dx) > Math.abs(dy)) {
            if (dx < -deadZone) dir.left = true;
            else if (dx > deadZone) dir.right = true;
        } else {
            if (dy < -deadZone) dir.up = true;
            else if (dy > deadZone) dir.down = true;
        }
        this.applyJoystickDir(dir);
    }

    applyJoystickDir(newDir) {
        const prev = this.joystickDirection;
        const emit = (type, action) => {
            this.handleGameInput({ type, action });
        };

        if (newDir.up && !prev.up) emit("keydown", "MOVE_UP");
        if (!newDir.up && prev.up) emit("keyup", "MOVE_UP");
        if (newDir.down && !prev.down) emit("keydown", "MOVE_DOWN");
        if (!newDir.down && prev.down) emit("keyup", "MOVE_DOWN");
        if (newDir.left && !prev.left) emit("keydown", "MOVE_LEFT");
        if (!newDir.left && prev.left) emit("keyup", "MOVE_LEFT");
        if (newDir.right && !prev.right) emit("keydown", "MOVE_RIGHT");
        if (!newDir.right && prev.right) emit("keyup", "MOVE_RIGHT");

        this.joystickDirection = newDir;
    }
}

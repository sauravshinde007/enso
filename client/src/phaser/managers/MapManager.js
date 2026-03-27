
import Phaser from "phaser";

export default class MapManager {
    constructor(scene) {
        this.scene = scene;
        this.map = null;
        this.layers = {};
        this.restrictedZones = []; // { id, x, y, width, height, name }
        this.roomAccessRules = {};
        this.dynamicBlockedZones = [];
        this.zoneGraphics = null;

        // Bounds
        this.width = 0;
        this.height = 0;

        // Spawn Point (Default to previous hardcoded value if missing)
        this.spawnPoint = { x: 1162, y: 1199 };

        // Immersion Effect
        this.immersionGraphics = null;
        this.currentImmersionZoneId = null;

        this.interactables = []; // { x, y, type, id, properties }
    }

    create() {
        this.map = this.scene.make.tilemap({ key: "office-map" });

        // Tilesets
        const roomTileset = this.map.addTilesetImage("Room_Builder_free_32x32", "room-tiles");
        const interiorTileset = this.map.addTilesetImage("Interiors_free_32x32", "interior-tiles");
        const officeTileset = this.map.addTilesetImage("Modern_Office_Black_Shadow", "office-tiles");
        const roomfloorTileset = this.map.addTilesetImage("Room_Builder_Floors", "room-floor");
        const allTilesets = [interiorTileset, roomTileset, officeTileset, roomfloorTileset];

        // Layers - Safely attempt to create them (returns null if missing in Tiled)
        this.layers.ground = this.map.createLayer("Ground", allTilesets, 0, 0);
        this.layers.walls = this.map.createLayer("Wall", allTilesets, 0, 0);
        this.layers.propsDown0 = this.map.createLayer("PropsDown0", allTilesets, 0, 0); //down facing props
        this.layers.propsDown1 = this.map.createLayer("PropsDown1", allTilesets, 0, 0); //up facing props
        this.layers.propsDown2 = this.map.createLayer("PropsDown2", allTilesets, 0, 0);
        this.layers.propsUp0 = this.map.createLayer("PropsUp0", allTilesets, 0, 0);
        this.layers.propsUp1 = this.map.createLayer("PropsUp1", allTilesets, 0, 0);
        this.layers.propsUp2 = this.map.createLayer("PropsUp2", allTilesets, 0, 0);

        //All props down layer have depth below 5
        //Player at level 5
        //All props up layer have depth above 5

        // Depth & Collisions - Only handle if layer exists
        if (this.layers.ground) this.layers.ground.setDepth(0);

        if (this.layers.walls) {
            this.layers.walls.setDepth(1);
            this.layers.walls.setCollisionByProperty({ collides: true });
        }

        if (this.layers.propsDown0) {
            this.layers.propsDown0.setDepth(2);
            this.layers.propsDown0.setCollisionByProperty({ collides: true });
        }

        if (this.layers.propsDown1) {
            this.layers.propsDown1.setDepth(3);
            this.layers.propsDown1.setCollisionByProperty({ collides: true });
        }

        if (this.layers.propsDown2) {
            this.layers.propsDown2.setDepth(4);
            this.layers.propsDown2.setCollisionByProperty({ collides: true });
        }

        if (this.layers.propsUp0) {
            this.layers.propsUp0.setDepth(6);
            this.layers.propsUp0.setCollisionByProperty({ collides: true });
        }

        if (this.layers.propsUp1) {
            this.layers.propsUp1.setDepth(7);
            this.layers.propsUp1.setCollisionByProperty({ collides: true });
        }

        if (this.layers.propsUp2) {
            this.layers.propsUp2.setDepth(8);
            this.layers.propsUp2.setCollisionByProperty({ collides: true });
        }

        // World bounds
        this.width = this.map.widthInPixels;
        this.height = this.map.heightInPixels;

        this.scene.physics.world.setBounds(0, 0, this.width, this.height);

        // Dispatch map size to React for UI Minimap
        window.dispatchEvent(new CustomEvent('map-init', {
            detail: { width: this.width, height: this.height }
        }));

        // Initialize RBAC Zones
        this.createRestrictedZones();
        this.createInteractables();
        this.findSpawnPoint();
    }

    registerRaycaster(raycasterPlugin) {
        if (raycasterPlugin) {
            const collisionLayers = [
                this.layers.walls,
                this.layers.props,
                this.layers.props1,
                this.layers.props2,
                this.layers.props3,
                this.layers.props4,
            ].filter(layer => layer != null); // Only include existing layers

            raycasterPlugin.mapGameObjects(collisionLayers, true);
            console.log("✅ Raycaster mapped to collision layers", collisionLayers.length);
        }
    }

    findSpawnPoint() {
        console.log("🔍 Searching for Spawn Point...");

        // Debug: Log all object layers found
        if (this.map.objects) {
            const layerNames = Object.keys(this.map.objects);
            console.log("📂 Available Object Layers:", layerNames);
        }

        const spawnLayer = this.map.getObjectLayer("Spawn");

        if (!spawnLayer) {
            console.warn("⚠️ 'Spawn' Object Layer NOT found in map. Did you name it exactly 'Spawn'?");
            return;
        }

        console.log("✅ 'Spawn' Layer found. Objects inside:", spawnLayer.objects);

        if (spawnLayer.objects) {
            const spawnObj = spawnLayer.objects.find(obj => obj.name === "SpawnPoint");
            if (spawnObj) {
                this.spawnPoint = { x: spawnObj.x, y: spawnObj.y };
                console.log("📍 Spawn point found at:", this.spawnPoint);
            } else {
                console.warn("⚠️ Layer 'Spawn' exists but no object named 'SpawnPoint' found inside it.");
            }
        }
    }

    // 🔒 RBAC Methods
    createRestrictedZones() {
        // 1. Try to load from Tiled Map Object Layer
        const zoneLayer = this.map.getObjectLayer("Zones");
        this.restrictedZones = []; // Reset

        if (zoneLayer && zoneLayer.objects) {
            console.log("🗺️ Loading Restricted Zones from Tiled Map...");

            zoneLayer.objects.forEach((obj) => {
                // Tiled objects usually have properties array. We look for 'zoneId' custom property.
                const idProp = obj.properties && obj.properties.find(p => p.name === "zoneId");
                const zoneId = idProp ? idProp.value : obj.name;

                // Also look for a 'name' property for display
                const nameProp = obj.properties && obj.properties.find(p => p.name === "zoneName");
                const zoneName = nameProp ? nameProp.value : (obj.name || zoneId);

                this.restrictedZones.push({
                    id: zoneId,
                    x: obj.x,
                    y: obj.y,
                    width: obj.width,
                    height: obj.height,
                    name: zoneName,
                });
            });
            console.log("✅ Loaded Zones:", this.restrictedZones);
        }

        // Draw them
        this.zoneGraphics = this.scene.add.graphics();
        this.zoneGraphics.setDepth(0); // On ground
        this.updateZoneVisuals();

        // Create text labels for zones
        this.restrictedZones.forEach(zone => {
            const text = this.scene.add.text(zone.x + zone.width / 2, zone.y - 10, zone.name, {
                fontFamily: 'Inter',
                fontSize: '12px', fill: '#ffffff', backgroundColor: '#000000aa'
            })
                .setOrigin(0.5)
                .setResolution(2);

            text.setDepth(10);
        });
    }

    updateZoneVisuals(myRole = 'employee') {
        if (!this.zoneGraphics) return;
        this.zoneGraphics.clear();

        this.restrictedZones.forEach(zone => {
            const allowedRoles = this.roomAccessRules[zone.id] || [];
            
            // Fallback to prefix match if no exact match
            let finalRoles = allowedRoles;
            if (finalRoles.length === 0) {
                const baseId = Object.keys(this.roomAccessRules).find(ruleId => zone.id.startsWith(ruleId));
                if (baseId) finalRoles = this.roomAccessRules[baseId];
            }

            const isReservedBlocked = this.dynamicBlockedZones.includes(zone.id);
            const canRoleAccess = finalRoles.length === 0 || finalRoles.includes(myRole);
            const canAccess = canRoleAccess && !isReservedBlocked;

            const color = canAccess ? 0x00ff00 : 0xff0000;
            const alpha = 0.3;

            this.zoneGraphics.fillStyle(color, alpha);
            this.zoneGraphics.fillRect(zone.x, zone.y, zone.width, zone.height);

            // Border
            this.zoneGraphics.lineStyle(2, color, 1);
            this.zoneGraphics.strokeRect(zone.x, zone.y, zone.width, zone.height);
        });
    }

    setRoomAccessRules(rules, myRole) {
        this.roomAccessRules = rules;
        this.updateZoneVisuals(myRole);
    }

    // Returns true if player is allowed, false if denied (and handles bounce/warning)
    checkZoneAccess(player, myRole) {
        if (!player) return true;

        const px = player.x;
        const py = player.y;

        for (const zone of this.restrictedZones) {
            const inZone = (px > zone.x && px < zone.x + zone.width &&
                py > zone.y && py < zone.y + zone.height);

            if (inZone) {
                // Determine if specifically blocked by a scheduled meeting reservation
                if (this.dynamicBlockedZones.includes(zone.id)) {
                    return { allowed: false, zone, isReserved: true };
                }

                let allowedRoles = this.roomAccessRules[zone.id];

                // Fallback to prefix match if no exact match (e.g. meeting_room_1 -> meeting_room)
                if (!allowedRoles) {
                    const baseId = Object.keys(this.roomAccessRules).find(ruleId => zone.id.startsWith(ruleId));
                    if (baseId) {
                        allowedRoles = this.roomAccessRules[baseId];
                    }
                }

                allowedRoles = allowedRoles || [];
                const canAccess = allowedRoles.includes(myRole);

                if (!canAccess) {
                    return { allowed: false, zone, isReserved: false };
                }
                return { allowed: true, zone };
            }
        }
        return { allowed: true };
    }

    createInteractables() {
        const interactLayer = this.map.getObjectLayer("Interactables");
        this.interactables = [];

        if (interactLayer && interactLayer.objects) {
            interactLayer.objects.forEach((obj) => {
                // Determine type from custom property OR fallback to name OR fallback to 'generic'
                const typeProp = obj.properties && obj.properties.find(p => p.name === "type");
                const type = typeProp ? typeProp.value : (obj.name || "generic");

                // Get ID - useful for associating specific meeting rooms
                const idProp = obj.properties && obj.properties.find(p => p.name === "id");
                const id = idProp ? idProp.value : obj.id;

                this.interactables.push({
                    x: obj.x,
                    y: obj.y,
                    width: obj.width || 32,
                    height: obj.height || 32,
                    type: type.toLowerCase(),
                    id: id,
                    rawProperties: obj.properties || []
                });
            });
            console.log("✅ Loaded Interactables:", this.interactables);
        } else {
            console.log("ℹ️ No 'Interactables' layer found in map.");
        }
    }

    getNearestInteractable(x, y, maxDistance = 50) {
        let nearest = null;
        let minDist = maxDistance;

        for (const item of this.interactables) {
            // Check distance to center of object
            const centerX = item.x + item.width / 2;
            const centerY = item.y + item.height / 2;
            const dist = Phaser.Math.Distance.Between(x, y, centerX, centerY);

            if (dist < minDist) {
                minDist = dist;
                nearest = item;
            }
        }
        return nearest;
    }

    updateImmersion(zone) {
        if (!this.immersionGraphics) {
            this.immersionGraphics = this.scene.add.graphics();
            this.immersionGraphics.setDepth(100);
        }

        // 1. If no zone or zone is common_area, clear effect
        if (!zone || zone.id === 'common_area' || zone.id.startsWith('common_area')) {
            if (this.currentImmersionZoneId) {
                this.scene.tweens.add({
                    targets: this.immersionGraphics,
                    alpha: 0,
                    duration: 300,
                    onComplete: () => {
                        this.immersionGraphics.clear();
                        this.currentImmersionZoneId = null;
                        this.immersionGraphics.alpha = 1;
                    }
                });
            }
            return;
        }

        // 2. If already in this zone, do nothing
        if (this.currentImmersionZoneId === zone.id) return;

        this.currentImmersionZoneId = zone.id;

        // 3. Draw the darkness around the zone
        this.immersionGraphics.clear();
        this.immersionGraphics.alpha = 0;
        this.immersionGraphics.fillStyle(0x000000, 0.60); // 85% opacity black

        // Top Rect
        this.immersionGraphics.fillRect(0, 0, this.width, zone.y);
        // Bottom Rect
        this.immersionGraphics.fillRect(0, zone.y + zone.height, this.width, this.height - (zone.y + zone.height));
        // Left Rect
        this.immersionGraphics.fillRect(0, zone.y, zone.x, zone.height);
        // Right Rect
        this.immersionGraphics.fillRect(zone.x + zone.width, zone.y, this.width - (zone.x + zone.width), zone.height);

        // Fade In
        this.scene.tweens.add({
            targets: this.immersionGraphics,
            alpha: 1,
            duration: 500
        });
    }
}

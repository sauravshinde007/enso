// client/src/phaser/utils/Pathfinder.js
export default class Pathfinder {
    constructor(mapManager) {
        this.mapManager = mapManager;
        this.tileSize = 32; // Assuming 32x32 tiles
        this.grid = [];
        this.width = mapManager.map.width;
        this.height = mapManager.map.height;
        this.buildGrid();
    }

    buildGrid() {
        // Initialize an empty grid
        for (let y = 0; y < this.height; y++) {
            this.grid[y] = [];
            for (let x = 0; x < this.width; x++) {
                this.grid[y][x] = 0; // 0 is walkable
            }
        }

        // Identify all possible collision layers built by Tiled MapManager
        const collisionLayers = [
            this.mapManager.layers.walls,
            this.mapManager.layers.propsDown0,
            this.mapManager.layers.propsDown1,
            this.mapManager.layers.propsDown2,
            this.mapManager.layers.propsUp0,
            this.mapManager.layers.propsUp1,
            this.mapManager.layers.propsUp2,
        ].filter(B => B);

        // Mark obstacles inside the grid array
        collisionLayers.forEach(layer => {
            const tiles = layer.getTilesWithin(0, 0, this.width, this.height);
            tiles.forEach(tile => {
                if (tile && tile.properties && tile.properties.collides) {
                    this.grid[tile.y][tile.x] = 1; // 1 means structurally solid wall
                }
            });
        });
    }

    findPath(startPx, startPy, endPx, endPy) {
        const startX = Math.floor(startPx / this.tileSize);
        const startY = Math.floor(startPy / this.tileSize);
        let endX = Math.floor(endPx / this.tileSize);
        let endY = Math.floor(endPy / this.tileSize);

        // Validate goal exists. If targeting a desk (which has collision), we find nearest walkable tile around it.
        if (this.grid[endY] && this.grid[endY][endX] === 1) {
            const nearest = this.getNearestWalkable(endX, endY);
            if (nearest) {
                endX = nearest.x;
                endY = nearest.y;
            } else {
                 return []; // Target is totally boxed in
            }
        }

        const openList = [];
        const closedList = new Set();
        const cameFrom = new Map();

        const gScore = new Map();
        const fScore = new Map();

        const startKey = `${startX},${startY}`;
        openList.push({ x: startX, y: startY });
        gScore.set(startKey, 0);
        fScore.set(startKey, this.heuristic(startX, startY, endX, endY));

        while (openList.length > 0) {
            // Priority Queue extraction
            openList.sort((a, b) => fScore.get(`${a.x},${a.y}`) - fScore.get(`${b.x},${b.y}`));
            const current = openList.shift();
            const currentKey = `${current.x},${current.y}`;

            if (current.x === endX && current.y === endY) {
                return this.reconstructPath(cameFrom, current);
            }

            closedList.add(currentKey);

            const neighbors = this.getNeighbors(current.x, current.y);
            for (const neighbor of neighbors) {
                const neighborKey = `${neighbor.x},${neighbor.y}`;
                if (closedList.has(neighborKey)) continue;

                const tentative_gScore = gScore.get(currentKey) + 1; // Path cost

                if (!openList.some(n => n.x === neighbor.x && n.y === neighbor.y)) {
                    openList.push(neighbor);
                } else if (tentative_gScore >= gScore.get(neighborKey)) {
                    continue;
                }

                cameFrom.set(neighborKey, current);
                gScore.set(neighborKey, tentative_gScore);
                fScore.set(neighborKey, tentative_gScore + this.heuristic(neighbor.x, neighbor.y, endX, endY));
            }
        }
        return []; // No path found
    }

    getNeighbors(x, y) {
        const neighbors = [];
        // Strictly horizontal & vertical pathing for realistic human sprite movement (Manhattan style)
        const dirs = [
            { dx: 0, dy: -1 }, { dx: 0, dy: 1 },
            { dx: -1, dy: 0 }, { dx: 1, dy: 0 }
        ];

        for (const dir of dirs) {
            const nx = x + dir.dx;
            const ny = y + dir.dy;
            if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
                if (this.grid[ny][nx] === 0) {
                    neighbors.push({ x: nx, y: ny });
                }
            }
        }
        return neighbors;
    }

    getNearestWalkable(x, y) {
        // Expand search radius around target (for entering interactive proximities of solid desks)
        const dirs = [
            { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
            { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
            { dx: 0, dy: 2 }, { dx: 0, dy: -2 },
        ];
        for (const dir of dirs) {
            const nx = x + dir.dx;
            const ny = y + dir.dy;
            if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
                if (this.grid[ny][nx] === 0) {
                    return { x: nx, y: ny };
                }
            }
        }
        return null;
    }

    heuristic(x1, y1, x2, y2) {
        return Math.abs(x1 - x2) + Math.abs(y1 - y2); // Manhattan distance
    }

    reconstructPath(cameFrom, current) {
        const path = [current];
        let currentKey = `${current.x},${current.y}`;
        while (cameFrom.has(currentKey)) {
            current = cameFrom.get(currentKey);
            currentKey = `${current.x},${current.y}`;
            path.unshift(current);
        }
        
        // Convert map tile array back to center-pixel bounds for Phaser coordinate mapping
        return path.map(p => ({
            x: p.x * this.tileSize + this.tileSize / 2,
            y: p.y * this.tileSize + this.tileSize / 2 + 10 // Shift down slightly for visual 2.5D floor effect
        }));
    }
}

'use strict';
// =============================================================================
//  Xonix — 3-Stage Video Reveal Game
// =============================================================================

// ─── DOM References ───────────────────────────────────────────────────────────
const canvas        = document.getElementById('game-canvas');
const ctx           = canvas.getContext('2d', { willReadFrequently: true });
const statsText     = document.getElementById('revealed-text');
const levelBadge    = document.getElementById('level-badge');
const overlayScreen = document.getElementById('overlay-screen');
const overlayTitle  = document.getElementById('overlay-title');
const overlayDesc   = document.getElementById('overlay-desc');
const restartBtn    = document.getElementById('restart-btn');

const settingEnemies    = document.getElementById('setting-enemies');
const settingSpeed      = document.getElementById('setting-speed');
const speedDisplay      = document.getElementById('speed-display');
const settingImg        = document.getElementById('setting-img');
const btnStart          = document.getElementById('start-btn');
const btnShare          = document.getElementById('share-btn');
const shareUrlInput     = document.getElementById('share-url');
const imageUnderlay     = document.getElementById('image-underlay');

const configImgSourceRadios = document.getElementsByName('img-source');
const urlInputGroup         = document.getElementById('url-input-group');
const uploadInputGroup      = document.getElementById('upload-input-group');
const settingUpload         = document.getElementById('setting-upload');

const settingObscuration  = document.getElementById('setting-obscuration');
const obscurationDisplay  = document.getElementById('obscuration-display');

const sourceVideo    = document.getElementById('source-video');
const rewardVideo    = document.getElementById('reward-video');
const levelOverlay   = document.getElementById('level-overlay');
const levelOverTitle = document.getElementById('level-overlay-title');
const levelOverDesc  = document.getElementById('level-overlay-desc');
const levelOverIcon  = document.getElementById('level-overlay-icon');
const levelFill      = document.getElementById('level-progress-fill');
const extractOverlay = document.getElementById('extract-overlay');
const extractMsg     = document.getElementById('extract-msg');

// ─── Settings ─────────────────────────────────────────────────────────────────
let CURRENT_ENEMY_COUNT = 3;
let CURRENT_ENEMY_SPEED = 2.5;
let CURRENT_OBSCURATION = 15;
let UPLOADED_FILE = null;   // raw File object for video upload

settingSpeed.addEventListener('input', e => { speedDisplay.innerText = e.target.value; });
settingObscuration.addEventListener('input', e => { obscurationDisplay.innerText = e.target.value + 'px'; });

configImgSourceRadios.forEach(r => r.addEventListener('change', e => {
    if (e.target.value === 'url') {
        urlInputGroup.classList.remove('hidden');
        uploadInputGroup.classList.add('hidden');
    } else {
        urlInputGroup.classList.add('hidden');
        uploadInputGroup.classList.remove('hidden');
    }
}));

settingUpload.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    UPLOADED_FILE = file;
});

// ─── Cloud status indicator ───────────────────────────────────────────────────
const _cloudStatus = (() => {
    const el = document.createElement('p');
    el.id = 'cloud-status';
    el.style.cssText = 'font-size:12px;color:#8b949e;margin:0;min-height:18px;text-align:center;';
    document.addEventListener('DOMContentLoaded', () => {
        const panel = document.getElementById('settings-panel');
        if (panel) panel.appendChild(el);
    });
    return {
        set(msg, loading = false) {
            el.innerHTML = loading ? `<span style="opacity:.7">⏳ ${msg}</span>` : msg;
        },
        clear() { el.textContent = ''; },
    };
})();

// ─── Canvas / Grid constants ──────────────────────────────────────────────────
const WIDTH     = canvas.width;    // 800
const HEIGHT    = canvas.height;   // 600
const TILE_SIZE = 5;
const COLS      = Math.floor(WIDTH  / TILE_SIZE); // 160
const ROWS      = Math.floor(HEIGHT / TILE_SIZE); // 120

let maskCanvas = document.createElement('canvas');
maskCanvas.width  = WIDTH;
maskCanvas.height = HEIGHT;
let maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });

// Grid states
const STATE_REVEALED = 0;
const STATE_MASKED   = 1;
const STATE_TRAIL    = 2;

// ─── Game State ───────────────────────────────────────────────────────────────
let grid       = [];
let player     = null;
let enemies    = [];
let lastTime   = 0;
let isGameOver = false;
let isWin      = false;
let inputDir   = { x: 0, y: 0 };
let gameLoopId = null;

// ─── Level System ─────────────────────────────────────────────────────────────
const WIN_PERCENTAGE    = 80;
let   totalLevels       = 3;    // 1 for images, 3 for videos — set at game-start
let   currentLevel      = 1;
let   levelBackgrounds  = [];   // array of HTMLImageElement, one per level
let   activeMediaUrl    = '';   // permanent URL for the active media
let   currentMediaType  = 'image'; // 'image' | 'video'

// ─── Media type helpers ────────────────────────────────────────────────────────
/** Returns true if a URL / MIME string looks like a video. */
function _isVideo(urlOrMime) {
    if (!urlOrMime) return false;
    // MIME type from File.type
    if (urlOrMime.startsWith('video/')) return true;
    // URL extension
    return /\.(mp4|webm|ogg|mov|avi|mkv)(\?|$)/i.test(urlOrMime);
}

/** Returns true if a URL / MIME string looks like an image. */
function _isImage(urlOrMime) {
    if (!urlOrMime) return false;
    if (urlOrMime.startsWith('image/')) return true;
    return /\.(jpe?g|png|gif|webp|avif|svg)(\?|$)/i.test(urlOrMime);
}

/**
 * Compatibility shim — code that previously used currentVideoUrl.
 * @deprecated use activeMediaUrl
 */
const currentVideoUrl = { get value() { return activeMediaUrl; } };

// =============================================================================
//  Movement — "Brake" logic
// =============================================================================
function applyDirectionCommand(dx, dy) {
    if ((inputDir.x !== 0 || inputDir.y !== 0) &&
        dx === -inputDir.x && dy === -inputDir.y) {
        inputDir = { x: 0, y: 0 };
    } else {
        inputDir = { x: dx, y: dy };
    }
}

// =============================================================================
//  Entity Classes
// =============================================================================
class Player {
    constructor() {
        this.gx = Math.floor(COLS / 2);
        this.gy = 0;
        this.timer = 0;
        this.moveInterval = 25;
        this.hasTrail = false;
        this.trailPath = [];
    }

    reset() {
        this.gx = Math.floor(COLS / 2);
        this.gy = 0;
        this.hasTrail = false;
        this.trailPath = [];
        inputDir = { x: 0, y: 0 };
    }

    update(dt) {
        this.timer += dt;
        if (this.timer >= this.moveInterval) {
            this.timer = 0;
            if (inputDir.x !== 0 || inputDir.y !== 0) {
                const prevX = this.gx;
                const prevY = this.gy;
                let nx = Math.max(0, Math.min(COLS - 1, this.gx + inputDir.x));
                let ny = Math.max(0, Math.min(ROWS - 1, this.gy + inputDir.y));
                this.gx = nx;
                this.gy = ny;

                const cellState = grid[this.gy][this.gx];
                if (cellState === STATE_MASKED) {
                    this.hasTrail = true;
                    grid[this.gy][this.gx] = STATE_TRAIL;
                    this.trailPath.push({ x: this.gx, y: this.gy });
                } else if (cellState === STATE_TRAIL && this.hasTrail) {
                    if (prevX !== this.gx || prevY !== this.gy) {
                        triggerGameOver('You crossed your own trail!');
                    }
                } else if (cellState === STATE_REVEALED && this.hasTrail) {
                    this.hasTrail = false;
                    this.trailPath = [];
                    inputDir = { x: 0, y: 0 };
                    completeCut();
                }
            }
        }
    }

    draw(ctx) {
        ctx.fillStyle = '#00FFDD';
        ctx.fillRect(this.gx * TILE_SIZE - 1, this.gy * TILE_SIZE - 1, TILE_SIZE + 2, TILE_SIZE + 2);
    }
}

class Enemy {
    constructor() {
        // Spawn in the inner masked area
        this.x = (2 + Math.floor(Math.random() * (COLS - 4))) * TILE_SIZE + TILE_SIZE / 2;
        this.y = (2 + Math.floor(Math.random() * (ROWS - 4))) * TILE_SIZE + TILE_SIZE / 2;
        this.radius = 5;
        const angle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(angle) * CURRENT_ENEMY_SPEED;
        this.vy = Math.sin(angle) * CURRENT_ENEMY_SPEED;
    }

    update() {
        if (isGameOver || isWin) return;
        const floodDirs = [[-1,0],[1,0],[0,-1],[0,1]];

        let bouncedX = false, bouncedY = false;

        const nextX = this.x + this.vx;
        const nextY = this.y + this.vy;
        const col   = Math.floor(nextX / TILE_SIZE);
        const row   = Math.floor(nextY / TILE_SIZE);

        const inBounds = col >= 0 && col < COLS && row >= 0 && row < ROWS;
        const cell = inBounds ? grid[row][col] : STATE_REVEALED;

        if (!inBounds || cell === STATE_REVEALED) {
            // Try x-axis bounce
            const col2  = Math.floor((this.x + this.vx) / TILE_SIZE);
            const row2  = Math.floor(this.y            / TILE_SIZE);
            const cell2 = (col2 >= 0 && col2 < COLS && row2 >= 0 && row2 < ROWS) ? grid[row2][col2] : STATE_REVEALED;
            if (cell2 === STATE_REVEALED || col2 < 0 || col2 >= COLS) {
                this.vx = -this.vx;
                bouncedX = true;
            }
            // Try y-axis bounce
            const col3  = Math.floor(this.x            / TILE_SIZE);
            const row3  = Math.floor((this.y + this.vy) / TILE_SIZE);
            const cell3 = (col3 >= 0 && col3 < COLS && row3 >= 0 && row3 < ROWS) ? grid[row3][col3] : STATE_REVEALED;
            if (cell3 === STATE_REVEALED || row3 < 0 || row3 >= ROWS) {
                this.vy = -this.vy;
                bouncedY = true;
            }
            if (!bouncedX && !bouncedY) {
                this.vx = -this.vx;
                this.vy = -this.vy;
            }
        }

        this.x += this.vx;
        this.y += this.vy;

        // Clamp
        this.x = Math.max(this.radius, Math.min(WIDTH  - this.radius, this.x));
        this.y = Math.max(this.radius, Math.min(HEIGHT - this.radius, this.y));

        // Collision detection with trail / revealed edge
        const ex = Math.floor(this.x / TILE_SIZE);
        const ey = Math.floor(this.y / TILE_SIZE);
        for (const [dx, dy] of floodDirs) {
            const nx = ex + dx, ny = ey + dy;
            if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) {
                if (grid[ny][nx] === STATE_TRAIL) {
                    triggerGameOver('An enemy touched your trail!');
                }
            }
        }
    }

    draw(ctx) {
        ctx.fillStyle = '#FF4500';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

// =============================================================================
//  Mask Cutting / Flood Fill
// =============================================================================
function _punchHolesIntoMask(cells) {
    maskCtx.save();
    maskCtx.globalCompositeOperation = 'destination-out';
    maskCtx.fillStyle = 'rgba(0,0,0,1)';
    for (const { x, y } of cells) {
        maskCtx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
    maskCtx.restore();
}

function completeCut() {
    // Step 1: Collect trail cells, convert to MASKED for flood-fill
    const trailCells = [];
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (grid[y][x] === STATE_TRAIL) {
                trailCells.push({ x, y });
                grid[y][x] = STATE_MASKED;
            }
        }
    }

    // Step 2: BFS flood-fill from each enemy
    const STATE_REACHABLE = 3;
    const queue     = [];
    const floodDirs = [[-1,0],[1,0],[0,-1],[0,1]];

    for (const e of enemies) {
        const ex = Math.floor(e.x / TILE_SIZE);
        const ey = Math.floor(e.y / TILE_SIZE);
        if (ex < 0 || ex >= COLS || ey < 0 || ey >= ROWS) continue;
        if (grid[ey][ex] === STATE_MASKED) {
            grid[ey][ex] = STATE_REACHABLE;
            queue.push({ x: ex, y: ey });
        } else {
            for (const [dx, dy] of floodDirs) {
                const nx = ex + dx, ny = ey + dy;
                if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && grid[ny][nx] === STATE_MASKED) {
                    grid[ny][nx] = STATE_REACHABLE;
                    queue.push({ x: nx, y: ny });
                    break;
                }
            }
        }
    }

    while (queue.length > 0) {
        const curr = queue.shift();
        for (const [dx, dy] of floodDirs) {
            const nx = curr.x + dx, ny = curr.y + dy;
            if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && grid[ny][nx] === STATE_MASKED) {
                grid[ny][nx] = STATE_REACHABLE;
                queue.push({ x: nx, y: ny });
            }
        }
    }

    // Step 3: Resolve — collect newly revealed
    const newlyRevealed = [];
    let revealedCount = 0;

    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (grid[y][x] === STATE_MASKED) {
                grid[y][x] = STATE_REVEALED;
                newlyRevealed.push({ x, y });
            } else if (grid[y][x] === STATE_REACHABLE) {
                grid[y][x] = STATE_MASKED;
            }
        }
    }
    for (const tc of trailCells) {
        grid[tc.y][tc.x] = STATE_REVEALED;
        newlyRevealed.push(tc);
    }

    // Step 4: Burn holes into maskCanvas permanently
    _punchHolesIntoMask(newlyRevealed);

    // Step 5: Count & update HUD
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (grid[y][x] === STATE_REVEALED) revealedCount++;
        }
    }
    const percentage = (revealedCount / (COLS * ROWS)) * 100;
    statsText.innerText = `Revealed: ${Math.floor(percentage)}%`;

    // Step 6: Win check
    if (percentage >= WIN_PERCENTAGE) {
        triggerWin();
        return;
    }

    // Step 7: Immediate sync redraw
    drawRevealedCells();
    if (player) player.draw(ctx);
    enemies.forEach(e => e.draw(ctx));
}

// =============================================================================
//  Rendering
// =============================================================================
function _buildMaskFromImage(img) {
    // Start fresh
    maskCtx.clearRect(0, 0, WIDTH, HEIGHT);

    // Option: lighter filter so it doesn't crash iOS hardware acceleration
    maskCtx.filter = 'blur(10px) grayscale(50%)';

    const imgRatio    = img.width / img.height;
    const canvasRatio = WIDTH / HEIGHT;
    let drawW, drawH, drawX, drawY;
    if (imgRatio > canvasRatio) {
        drawH = HEIGHT; drawW = HEIGHT * imgRatio;
        drawX = (WIDTH - drawW) / 2; drawY = 0;
    } else {
        drawW = WIDTH; drawH = WIDTH / imgRatio;
        drawX = 0; drawY = (HEIGHT - drawH) / 2;
    }
    const margin = CURRENT_OBSCURATION;
    
    // 1. Draw the base image (it might silently fail on mobile, which is why we need step 3)
    maskCtx.drawImage(img, drawX - margin, drawY - margin, drawW + margin * 2, drawH + margin * 2);

    // 2. Temporarily disable filters
    maskCtx.filter = 'none';

    // 3. Draw a very dark, nearly opaque rectangle over the entire mask to guarantee it's hidden
    maskCtx.fillStyle = 'rgba(10, 10, 10, 0.96)';
    maskCtx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawRevealedCells() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.drawImage(maskCanvas, 0, 0);

    ctx.fillStyle = '#00FFDD';
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (grid[y][x] === STATE_TRAIL) {
                ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            }
        }
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, WIDTH, HEIGHT);
}

// =============================================================================
//  Game Loop
// =============================================================================
function update(dt) {
    if (isGameOver || isWin) return;
    player.update(dt);
    if (!isGameOver) enemies.forEach(e => e.update());
}

function render() {
    drawRevealedCells();
    if (player) player.draw(ctx);
    if (!isWin) enemies.forEach(e => e.draw(ctx));
}

function gameLoop(time) {
    const dt = Math.min(time - lastTime, 100);
    lastTime = time;
    update(dt);
    render();
    if (!isGameOver && !isWin) {
        gameLoopId = requestAnimationFrame(gameLoop);
    } else if (isGameOver || isWin) {
        render(); // final frame
    }
}

// =============================================================================
//  Game State Control
// =============================================================================
function _showDeathTransition(reason, onComplete) {
    levelOverIcon.textContent  = '💀';
    levelOverTitle.textContent = 'Ouch! Try again.';
    levelOverDesc.textContent  = reason;

    levelFill.style.width = '0%';
    levelOverlay.classList.remove('hidden');

    requestAnimationFrame(() => {
        requestAnimationFrame(() => { levelFill.style.width = '100%'; });
    });

    setTimeout(() => {
        levelOverlay.classList.add('hidden');
        onComplete();
    }, 2400); // 2s transition + buffer
}

function triggerGameOver(reason) {
    if (isGameOver || isWin) return;
    isGameOver = true;
    if (gameLoopId) { cancelAnimationFrame(gameLoopId); gameLoopId = null; }
    
    _showDeathTransition(reason, () => {
        _startLevelWithFrame(levelBackgrounds[currentLevel - 1]);
    });
}

/**
 * Called when the player clears WIN_PERCENTAGE of the current level.
 * Handles both inter-level transitions and the Grand Finale.
 */
function triggerWin() {
    if (isGameOver || isWin) return;
    isWin = true;
    if (gameLoopId) { cancelAnimationFrame(gameLoopId); gameLoopId = null; }

    // Fully reveal the current level frame
    maskCtx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    if (currentLevel < totalLevels) {
        // ── Advance to next level ─────────────────────────────────────────────
        const nextLevel = currentLevel + 1;
        _showLevelTransition(nextLevel, () => {
            currentLevel = nextLevel;
            _startLevelWithFrame(levelBackgrounds[currentLevel - 1]);
        });
    } else {
        // ── Grand Finale ──────────────────────────────────────────────────────
        _triggerGrandFinale();
    }
}

// =============================================================================
//  Level Transition UI
// =============================================================================
function _showLevelTransition(nextLevel, onComplete) {
    // Icon per level
    const icons = ['', '🎬', '🔥', '🏆'];
    levelOverIcon.textContent  = icons[nextLevel] || '⭐';
    levelOverTitle.textContent = `Level ${nextLevel}`;
    levelOverDesc.textContent  = nextLevel === totalLevels
        ? 'Final level — unlock the full video!'
        : 'Great cut! Next frame incoming…';

    levelFill.style.width = '0%';
    levelOverlay.classList.remove('hidden');

    // Animate the progress bar fill, then hide and start next level
    requestAnimationFrame(() => {
        requestAnimationFrame(() => { levelFill.style.width = '100%'; });
    });

    setTimeout(() => {
        levelOverlay.classList.add('hidden');
        onComplete();
    }, 2400); // matches the 2s CSS transition + 0.4s buffer
}

// =============================================================================
//  Grand Finale
// =============================================================================
function _triggerGrandFinale() {
    if (currentMediaType === 'video') {
        // ── Video mode: hide canvas, play the full video as reward ───────────
        statsText.innerText    = '🎉 You unlocked the full video!';
        levelBadge.textContent = '🏆 Complete';

        canvas.style.display         = 'none';
        imageUnderlay.style.display  = 'none';

        rewardVideo.classList.remove('hidden');
        rewardVideo.play().catch(() => {/* autoplay may be blocked — controls handle it */});
    } else {
        // ── Image mode: simply reveal the full image (clear fog) ─────────────
        statsText.innerText    = 'Revealed: 100% — You Win! 🎉';
        levelBadge.textContent = '🏆 Complete';
        // maskCanvas already cleared by triggerWin(); canvas is transparent → underlay shows
    }
}

// =============================================================================
//  startGameCore — resets grid and starts loop
// =============================================================================
function startGameCore() {
    isGameOver = false;
    isWin      = false;
    inputDir   = { x: 0, y: 0 };

    // Reset grid
    grid = [];
    for (let y = 0; y < ROWS; y++) {
        const row = [];
        for (let x = 0; x < COLS; x++) {
            row.push(x < 2 || x >= COLS - 2 || y < 2 || y >= ROWS - 2
                ? STATE_REVEALED : STATE_MASKED);
        }
        grid.push(row);
    }

    // Punch initial border into maskCanvas
    const initRevealed = [];
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (grid[y][x] === STATE_REVEALED) initRevealed.push({ x, y });
        }
    }
    _punchHolesIntoMask(initRevealed);

    if (player) {
        player.reset();
    } else {
        player = new Player();
    }

    // Keep enemies between levels (same difficulty); recreate only on fresh start
    if (enemies.length === 0) {
        for (let i = 0; i < CURRENT_ENEMY_COUNT; i++) enemies.push(new Enemy());
    } else {
        // Reset enemy positions but keep count/speed
        enemies = [];
        for (let i = 0; i < CURRENT_ENEMY_COUNT; i++) enemies.push(new Enemy());
    }

    statsText.innerText    = 'Revealed: 0%';
    levelBadge.textContent = totalLevels > 1
        ? `Level ${currentLevel} / ${totalLevels}`
        : 'Image Reveal';

    // Explicitly draw the initial MASKED state to the screen BEFORE the game loop starts
    // This prevents the underlying frame from being visible during initialization delays on mobile
    drawRevealedCells();

    lastTime   = performance.now();
    if (gameLoopId) cancelAnimationFrame(gameLoopId);
    gameLoopId = requestAnimationFrame(gameLoop);
}

// =============================================================================
//  _startLevelWithFrame — builds the mask from an HTMLImageElement and starts
// =============================================================================
function _startLevelWithFrame(img) {
    if (!img) { console.error('No frame image for level', currentLevel); return; }

    // Update underlay CSS
    imageUnderlay.style.backgroundImage = `url('${img.src}')`;
    imageUnderlay.style.display = '';

    // Rebuild the fog mask for this level's frame
    _buildMaskFromImage(img);

    startGameCore();
}

// =============================================================================
//  VIDEO FRAME EXTRACTION ENGINE
// =============================================================================
/**
 * Seek the source video to `time` seconds and resolve with an HTMLImageElement
 * containing the frame.  Uses the `seeked` event to guarantee the frame is ready
 * before drawing — avoids black/blank frame bugs.
 */
function _extractFrameAtTime(video, time) {
    return new Promise((resolve, reject) => {
        const onSeeked = () => {
            video.removeEventListener('seeked', onSeeked);
            // Draw current video frame to an offscreen canvas, export as data URI
            const offscreen = document.createElement('canvas');
            offscreen.width  = WIDTH;
            offscreen.height = HEIGHT;
            const offCtx = offscreen.getContext('2d');

            // Cover-fit the video frame into the canvas
            const vAspect = video.videoWidth / video.videoHeight;
            const cAspect = WIDTH / HEIGHT;
            let dW, dH, dX, dY;
            if (vAspect > cAspect) {
                dH = HEIGHT; dW = HEIGHT * vAspect;
                dX = (WIDTH - dW) / 2; dY = 0;
            } else {
                dW = WIDTH; dH = WIDTH / vAspect;
                dX = 0; dY = (HEIGHT - dH) / 2;
            }
            offCtx.drawImage(video, dX, dY, dW, dH);

            const dataUri = offscreen.toDataURL('image/jpeg', 0.85);
            const img     = new Image();
            img.onload  = () => resolve(img);
            img.onerror = ()  => reject(new Error(`Frame load failed at ${time}s`));
            img.src = dataUri;
        };

        video.addEventListener('seeked', onSeeked, { once: true });
        video.currentTime = time;
    });
}

/**
 * Load `videoUrl` into the hidden source-video element, wait for metadata,
 * then extract frames at 10%, 50%, and 90% of the duration.
 * Shows the extraction overlay with progress messages.
 * Resolves with an array of 3 HTMLImageElements.
 */
async function _extractVideoFrames(videoUrl) {
    // Guard: a missing URL here is always a caller bug
    if (!videoUrl) {
        return Promise.reject(new Error(
            '_extractVideoFrames called with undefined URL. ' +
            'Ensure the media URL is resolved before calling this function.'
        ));
    }

    return new Promise((resolve, reject) => {
        extractOverlay.classList.remove('hidden');
        extractMsg.textContent = 'Loading video…';

        // ── Fix: blob: / data: URLs must NOT have crossorigin attribute ────────
        // Setting crossorigin='anonymous' on a blob: URL causes a CORS error
        // because the browser treats the Blob as a different origin.
        if (videoUrl.startsWith('blob:') || videoUrl.startsWith('data:')) {
            sourceVideo.removeAttribute('crossorigin');
        } else {
            sourceVideo.setAttribute('crossorigin', 'anonymous');
        }

        // Fully reset the element before loading a new source
        sourceVideo.pause();
        sourceVideo.removeAttribute('src');
        sourceVideo.load();

        sourceVideo.preload = 'auto';
        sourceVideo.src     = videoUrl;
        sourceVideo.load();

        const onMeta = async () => {
            sourceVideo.removeEventListener('loadedmetadata', onMeta);
            sourceVideo.removeEventListener('error', onErr);

            const dur = sourceVideo.duration;
            if (!dur || !isFinite(dur)) {
                extractOverlay.classList.add('hidden');
                reject(new Error('Could not determine video duration.'));
                return;
            }

            const timestamps = [0.10, 0.50, 0.90].map(p => p * dur);
            const frames     = [];

            try {
                for (let i = 0; i < timestamps.length; i++) {
                    extractMsg.textContent =
                        `Extracting frame ${i + 1} of ${timestamps.length}…`;
                    const frame = await _extractFrameAtTime(sourceVideo, timestamps[i]);
                    frames.push(frame);
                }
                extractOverlay.classList.add('hidden');
                resolve(frames);
            } catch (err) {
                extractOverlay.classList.add('hidden');
                reject(err);
            }
        };

        const onErr = () => {
            sourceVideo.removeEventListener('loadedmetadata', onMeta);
            sourceVideo.removeEventListener('error', onErr);
            extractOverlay.classList.add('hidden');
            reject(new Error('Failed to load video. Check the URL or file format.'));
        };

        sourceVideo.addEventListener('loadedmetadata', onMeta, { once: true });
        sourceVideo.addEventListener('error', onErr,           { once: true });
    });
}

// =============================================================================
//  setupAndStartGame — called by Start button
// =============================================================================
async function setupAndStartGame() {
    isGameOver = false;
    isWin      = false;
    overlayScreen.classList.add('hidden');

    CURRENT_ENEMY_COUNT = parseInt(settingEnemies.value,   10) || 3;
    CURRENT_ENEMY_SPEED = parseFloat(settingSpeed.value)       || 2.5;
    CURRENT_OBSCURATION = parseInt(settingObscuration.value, 10) || 15;

    // Reset to level 1 on every fresh start
    currentLevel     = 1;
    levelBackgrounds = [];
    enemies          = [];

    // Reset video / canvas state
    rewardVideo.classList.add('hidden');
    rewardVideo.src = '';
    canvas.style.display        = '';
    imageUnderlay.style.display = '';

    const sourceType = document.querySelector('input[name="img-source"]:checked').value;

    if (sourceType === 'upload') {
        if (!UPLOADED_FILE) { alert('Please select an image or video file first.'); return; }

        // ── Detect media type from the file's MIME type ───────────────────────
        const fileMediaType = _isVideo(UPLOADED_FILE.type) ? 'video' : 'image';

        // ── Create a local blob: URL so the game starts immediately ──────────
        // The blob URL is only valid for this browser session; it does NOT need
        // crossorigin="anonymous" (that attribute causes a DOMException on blob:).
        // Cloud upload runs in parallel and generates the shareable Supabase URL.
        const localBlobUrl = URL.createObjectURL(UPLOADED_FILE);
        activeMediaUrl     = localBlobUrl;
        currentMediaType   = fileMediaType;

        // Start the game right away with the local blob URL
        _initGame(localBlobUrl, fileMediaType);    // ← no await; game starts immediately

        // Upload to Supabase in the background so the share button works later
        _cloudStatus.set('Uploading to cloud…', true);
        (async () => {
            try {
                const form = new FormData();
                form.append('image',       UPLOADED_FILE);
                form.append('enemies',     settingEnemies.value);
                form.append('speed',       settingSpeed.value);
                form.append('obscuration', settingObscuration.value);

                const res  = await fetch('/api/save-game', { method: 'POST', body: form });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error || 'Upload failed.');

                // Swap the blob URL for the permanent Supabase URL so share works
                activeMediaUrl = json.imageUrl;
                _cloudStatus.set(`✅ Ready to share! ID: <b>${json.shortId}</b>`);
            } catch (err) {
                console.warn('[Background upload]', err);
                _cloudStatus.set(`⚠️ Cloud save failed: ${err.message} — game still works locally.`);
            }
        })();

    } else {
        // ── URL mode ──────────────────────────────────────────────────────────
        const rawUrl = settingImg.value.trim();
        if (!rawUrl) { alert('Please enter an image or video URL.'); return; }

        activeMediaUrl   = rawUrl;
        currentMediaType = _isVideo(rawUrl) ? 'video' : 'image';
        _cloudStatus.clear();

        if (!activeMediaUrl) {
            alert('Could not resolve a media URL. Please check your input.');
            return;
        }

        await _initGame(activeMediaUrl, currentMediaType);
    }
}

/**
 * Universal game initialiser.
 * - IMAGE: loads directly, 1 level, win = full reveal.
 * - VIDEO: extracts 3 frames, 3 levels, win = full video playback.
 */
async function _initGame(mediaUrl, mediaType) {
    // Guard: catch callers passing undefined/null before any async work
    if (!mediaUrl) {
        console.error('[_initGame] mediaUrl is undefined or empty. Check the caller.');
        alert('No media URL provided. Please enter a URL or upload a file.');
        return;
    }

    currentLevel     = 1;
    levelBackgrounds = [];
    currentMediaType = mediaType;
    activeMediaUrl   = mediaUrl;

    // IMMEDIATELY set the reward video source at game initialization
    if (activeMediaUrl.startsWith('blob:') || activeMediaUrl.startsWith('data:')) {
        rewardVideo.removeAttribute('crossorigin');
    } else {
        rewardVideo.setAttribute('crossorigin', 'anonymous');
    }
    rewardVideo.src = activeMediaUrl;

    if (mediaType === 'video') {
        // ── Video path: extract 3 frames then start 3-level game ─────────────
        totalLevels = 3;
        try {
            levelBackgrounds = await _extractVideoFrames(mediaUrl);
            _startLevelWithFrame(levelBackgrounds[0]);
        } catch (err) {
            console.error('[Frame extraction]', err);
            alert(`Could not extract video frames: ${err.message}`);
        }
    } else {
        // ── Image path: load image directly, single level ─────────────────────
        totalLevels = 1;
        extractOverlay.classList.remove('hidden');
        extractMsg.textContent = 'Loading image…';

        const img = new Image();
        // Only set crossorigin for http(s) URLs; blob:/data: don't need it
        if (mediaUrl.startsWith('http')) img.crossOrigin = 'anonymous';

        img.onload = () => {
            extractOverlay.classList.add('hidden');
            levelBackgrounds = [img];
            _startLevelWithFrame(img);
        };
        img.onerror = () => {
            extractOverlay.classList.add('hidden');
            alert('Could not load image. Check the URL.');
        };
        img.src = mediaUrl;
    }
}

// =============================================================================
//  Share button
// =============================================================================
btnStart.addEventListener('click', setupAndStartGame);
restartBtn.addEventListener('click', setupAndStartGame);

btnShare.addEventListener('click', async () => {
    const sourceType = document.querySelector('input[name="img-source"]:checked').value;

    _cloudStatus.set('Saving to Cloud…', true);
    btnShare.disabled = true;

    try {
        let res, json;

        if (sourceType === 'upload' && UPLOADED_FILE) {
            const form = new FormData();
            form.append('image',       UPLOADED_FILE);
            form.append('enemies',      settingEnemies.value);
            form.append('speed',        settingSpeed.value);
            form.append('obscuration',  settingObscuration.value);
            res  = await fetch('/api/save-game', { method: 'POST', body: form });
            json = await res.json();
        } else {
            const videoUrl = settingImg.value.trim();
            if (!videoUrl) { _cloudStatus.set('❌ Please enter a video URL.'); return; }
            res  = await fetch('/api/save-game', {
                method : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body   : JSON.stringify({
                    imageUrl    : videoUrl,
                    enemies     : settingEnemies.value,
                    speed       : settingSpeed.value,
                    obscuration : settingObscuration.value,
                }),
            });
            json = await res.json();
        }

        if (!res.ok) throw new Error(json.error || 'Server error.');

        const shareUrl = `${window.location.origin}/?id=${json.shortId}`;
        shareUrlInput.value = shareUrl;
        shareUrlInput.select();
        try {
            await navigator.clipboard.writeText(shareUrl);
            _cloudStatus.set(`✅ Link copied! ID: <b>${json.shortId}</b>`);
        } catch (_) {
            document.execCommand('copy');
            _cloudStatus.set(`✅ Saved! ID: <b>${json.shortId}</b> — copy the URL above.`);
        }
    } catch (err) {
        console.error('[Share]', err);
        _cloudStatus.set(`❌ ${err.message}`);
    } finally {
        btnShare.disabled = false;
    }
});

// =============================================================================
//  Mode Detection & Player Mode Activation
// =============================================================================
function _activatePlayerMode() {
    document.body.classList.add('player-mode');
}

// ─── Mobile Settings Drawer ──────────────────────────────────────────────────
(function initSettingsDrawer() {
    const toggleBtn = document.getElementById('settings-toggle');
    const closeBtn  = document.getElementById('settings-close');
    const backdrop  = document.getElementById('settings-backdrop');
    const panel     = document.getElementById('settings-panel');

    function openSettings()  { panel.classList.add('show'); backdrop.classList.add('show'); document.body.style.overflow = 'hidden'; }
    function closeSettings() { panel.classList.remove('show'); backdrop.classList.remove('show'); document.body.style.overflow = ''; }

    toggleBtn.addEventListener('click', openSettings);
    closeBtn .addEventListener('click', closeSettings);
    backdrop .addEventListener('click', closeSettings);
})();

// ─── Touch / Swipe controls ───────────────────────────────────────────────────
(function initTouchControls() {
    const DEAD_ZONE = 12;
    let touchStartX = 0, touchStartY = 0, touchActive = false, lastCmd = null;

    canvas.addEventListener('touchstart', e => {
        e.preventDefault();
        const t = e.touches[0];
        touchStartX = t.clientX; touchStartY = t.clientY; touchActive = true; lastCmd = null;
    }, { passive: false });

    canvas.addEventListener('touchmove', e => {
        e.preventDefault();
        if (!touchActive) return;
        const t = e.touches[0];
        const dx = t.clientX - touchStartX;
        const dy = t.clientY - touchStartY;
        if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;

        let cmd;
        if (Math.abs(dx) > Math.abs(dy)) cmd = dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
        else                              cmd = dy > 0 ? { x: 0, y: 1 } : { x:  0, y: -1 };

        if (!lastCmd || lastCmd.x !== cmd.x || lastCmd.y !== cmd.y) {
            lastCmd = cmd;
            applyDirectionCommand(cmd.x, cmd.y);
            touchStartX = t.clientX; touchStartY = t.clientY;
        }
    }, { passive: false });

    canvas.addEventListener('touchend',    e => { e.preventDefault(); touchActive = false; }, { passive: false });
    canvas.addEventListener('touchcancel', e => { e.preventDefault(); touchActive = false; }, { passive: false });
})();

// ─── Keyboard controls ────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
    const map = {
        ArrowUp: [0,-1], ArrowDown: [0,1], ArrowLeft: [-1,0], ArrowRight: [1,0],
        w: [0,-1], s: [0,1], a: [-1,0], d: [1,0],
        W: [0,-1], S: [0,1], A: [-1,0], D: [1,0],
    };
    const dir = map[e.key];
    if (dir) { e.preventDefault(); applyDirectionCommand(dir[0], dir[1]); }
});

// =============================================================================
//  DOMContentLoaded — URL parameter routing
// =============================================================================
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);

    if (params.has('id')) {
        // Player Mode — fetch config from backend, then start multi-level game
        _activatePlayerMode();
        _cloudStatus.set('Loading game…', true);

        fetch(`/api/get-game/${encodeURIComponent(params.get('id'))}`)
            .then(r => r.json())
            .then(async data => {
                if (data.error) throw new Error(data.error);
                settingEnemies.value     = data.enemies;
                settingSpeed.value       = data.speed;
                settingObscuration.value = data.obscuration;
                settingImg.value         = data.imageUrl;

                CURRENT_ENEMY_COUNT = parseInt(data.enemies,     10) || 3;
                CURRENT_ENEMY_SPEED = parseFloat(data.speed)         || 2.5;
                CURRENT_OBSCURATION = parseInt(data.obscuration, 10) || 15;

                // Detect media type from the returned URL (server may also send data.mediaType)
                const mtype = data.mediaType ||
                    (_isVideo(data.imageUrl) ? 'video' : 'image');

                _cloudStatus.clear();
                await _initGame(data.imageUrl, mtype);
            })
            .catch(err => {
                console.error('[Load game by ID]', err);
                _cloudStatus.set(`❌ Could not load: ${err.message}`);
                _showIdleScreen();
            });

    } else if (params.has('state')) {
        // Legacy base64 Player Mode
        _activatePlayerMode();
        try {
            const decoded = decodeURIComponent(atob(params.get('state')));
            const sepIdx  = [0,1,2].reduce((acc, _, i) => {
                acc.push(decoded.indexOf('|', i === 0 ? 0 : acc[i-1] + 1));
                return acc;
            }, []);
            if (sepIdx[2] !== -1) {
                settingEnemies.value     = decoded.substring(0, sepIdx[0]);
                settingSpeed.value       = decoded.substring(sepIdx[0]+1, sepIdx[1]);
                settingObscuration.value = decoded.substring(sepIdx[1]+1, sepIdx[2]);
                const mediaUrl           = decoded.substring(sepIdx[2]+1);

                CURRENT_ENEMY_COUNT = parseInt(settingEnemies.value,     10) || 3;
                CURRENT_ENEMY_SPEED = parseFloat(settingSpeed.value)         || 2.5;
                CURRENT_OBSCURATION = parseInt(settingObscuration.value, 10) || 15;

                const mtype = _isVideo(mediaUrl) ? 'video' : 'image';
                _initGame(mediaUrl, mtype);
            }
        } catch (err) {
            console.error('Legacy state parse error:', err);
            _showIdleScreen();
        }

    } else {
        _showIdleScreen();
    }
});

function _showIdleScreen() {
    ctx.fillStyle = 'rgba(22, 27, 34, 0.95)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('Upload or enter an image / video URL, then click Start', WIDTH / 2, HEIGHT / 2 - 14);
    ctx.fillStyle = '#58a6ff';
    ctx.font = '14px Inter';
    ctx.fillText('Images: 1-level reveal   │   Videos: 3-level reveal + full playback', WIDTH / 2, HEIGHT / 2 + 16);
}

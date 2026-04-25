'use strict';

require('dotenv').config();

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const { createClient } = require('@supabase/supabase-js');

// nanoid v5+ is ESM-only; we ship a tiny synchronous wrapper using the
// crypto module so we stay in CommonJS without needing a dynamic import.
const { randomBytes } = require('crypto');
const nanoid = (size = 10) =>
    randomBytes(size)
        .toString('base64url')   // URL-safe base64 (no +, /, =)
        .slice(0, size);

// ─── Supabase client (server-side, uses service-role key) ────────────────────
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY   // never expose this to the browser
);

const STORAGE_BUCKET = process.env.SUPABASE_BUCKET || 'xonix-images';
const GAMES_TABLE    = 'games';

// ─── Express setup ────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies (for future use)
app.use(express.json());

// Serve the game's static frontend files from the project root
app.use(express.static(path.join(__dirname)));

// ─── Multer — keep file in memory so we can pipe it to Supabase Storage ──────
const upload = multer({
    storage: multer.memoryStorage(),
    limits : { fileSize: 200 * 1024 * 1024 }, // 200 MB — videos can be large
    fileFilter(_req, file, cb) {
        const ok = file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/');
        if (!ok) return cb(new Error('Only image or video files are allowed'));
        cb(null, true);
    },
});

// ─── POST /api/save-game ─────────────────────────────────────────────────────
// Accepts multipart/form-data with:
//   - image      : File  (optional — omit when using an external URL)
//   - imageUrl   : string (optional — use when the user chose "URL" source)
//   - enemies    : number
//   - speed      : number
//   - obscuration: number
//
// Returns: { shortId, shareUrl }
app.post('/api/save-game', upload.single('image'), async (req, res) => {
    try {
        const { enemies, speed, obscuration, imageUrl: externalUrl } = req.body;

        // ── Validate required settings ────────────────────────────────────────
        const enemyCount  = parseInt(enemies,     10);
        const enemySpeed  = parseFloat(speed);
        const obscurationV = parseFloat(obscuration);

        if (isNaN(enemyCount) || isNaN(enemySpeed) || isNaN(obscurationV)) {
            return res.status(400).json({ error: 'Missing or invalid game settings.' });
        }

        // ── Resolve final image URL ───────────────────────────────────────────
        let finalImageUrl = externalUrl || null;

        if (req.file) {
            // User uploaded a local file → push to Supabase Storage
            const ext        = req.file.mimetype.split('/')[1] || 'jpg';
            const objectPath = `uploads/${Date.now()}-${nanoid(8)}.${ext}`;

            const { error: uploadError } = await supabase.storage
                .from(STORAGE_BUCKET)
                .upload(objectPath, req.file.buffer, {
                    contentType : req.file.mimetype,   // e.g. video/mp4 or image/jpeg
                    cacheControl: '31536000',           // 1 year — immutable uploads
                    upsert      : false,
                });

            if (uploadError) throw uploadError;

            // Get the public URL for the uploaded object
            const { data: { publicUrl } } = supabase.storage
                .from(STORAGE_BUCKET)
                .getPublicUrl(objectPath);

            finalImageUrl = publicUrl;
        }

        if (!finalImageUrl) {
            return res.status(400).json({ error: 'Provide either an image file or an imageUrl.' });
        }

        // ── Derive media type ──────────────────────────────────────────────────
        // Prefer the MIME type from an uploaded file; fall back to URL extension.
        let mediaType = 'image'; // default to image
        if (req.file) {
            mediaType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
        } else if (externalUrl) {
            mediaType = /\.(mp4|webm|ogg|mov|avi|mkv)(\?|$)/i.test(externalUrl) ? 'video' : 'image';
        }

        // ── Persist to the `games` table ──────────────────────────────────────
        const shortId = nanoid(10);

        const { error: dbError } = await supabase
            .from(GAMES_TABLE)
            .insert({
                short_id   : shortId,
                enemy_count: enemyCount,
                enemy_speed: enemySpeed,
                obscuration: obscurationV,
                image_url  : finalImageUrl,
                media_type : mediaType,   // 'image' | 'video'
            });

        if (dbError) throw dbError;

        const shareUrl = `${req.protocol}://${req.get('host')}/?id=${shortId}`;
        return res.status(201).json({ shortId, shareUrl });

    } catch (err) {
        console.error('[POST /api/save-game]', err);
        return res.status(500).json({ error: err.message || 'Internal server error.' });
    }
});

// ─── GET /api/get-game/:id ────────────────────────────────────────────────────
// Returns the game settings for the given shortId.
app.get('/api/get-game/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from(GAMES_TABLE)
            .select('short_id, enemy_count, enemy_speed, obscuration, image_url, media_type, created_at')
            .eq('short_id', id)
            .single();

        if (error || !data) {
            return res.status(404).json({ error: 'Game not found.' });
        }

        return res.json({
            shortId    : data.short_id,
            enemies    : data.enemy_count,
            speed      : data.enemy_speed,
            obscuration: data.obscuration,
            imageUrl   : data.image_url,
            mediaType  : data.media_type || 'image', // backwards-compat: old rows lack this field
            createdAt  : data.created_at,
        });

    } catch (err) {
        console.error('[GET /api/get-game/:id]', err);
        return res.status(500).json({ error: err.message || 'Internal server error.' });
    }
});

// ─── Catch-all: serve index.html for any non-API route ───────────────────────
// This lets the frontend handle the ?id= routing client-side.
app.get(/(.*)/, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n🎮  Xonix server running → http://localhost:${PORT}\n`);
});

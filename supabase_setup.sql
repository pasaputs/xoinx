-- ============================================================
--  Xonix — Supabase Database Setup
--  Run this once in the Supabase SQL Editor
-- ============================================================

-- 1. Create the games table
CREATE TABLE IF NOT EXISTS public.games (
    id          BIGSERIAL PRIMARY KEY,
    short_id    TEXT        NOT NULL UNIQUE,
    enemy_count INTEGER     NOT NULL DEFAULT 3,
    enemy_speed FLOAT       NOT NULL DEFAULT 2.5,
    obscuration FLOAT       NOT NULL DEFAULT 15,
    image_url   TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup by short_id (used by GET /api/get-game/:id)
CREATE INDEX IF NOT EXISTS games_short_id_idx ON public.games (short_id);

-- 2. Row Level Security
--    The Express server uses the service_role key which bypasses RLS,
--    so we enable RLS but grant no public policies — the browser never
--    talks to Supabase directly.
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

-- 3. Storage bucket
--    Create the bucket manually in Supabase Dashboard → Storage, OR run:
INSERT INTO storage.buckets (id, name, public)
VALUES ('xonix-images', 'xonix-images', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Allow public reads from the bucket (images need to be publicly accessible)
CREATE POLICY "Public read xonix-images"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'xonix-images');

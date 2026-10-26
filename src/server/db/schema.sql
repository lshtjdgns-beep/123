CREATE TABLE IF NOT EXISTS naver_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blog_id TEXT NOT NULL,
  storage_state_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_validated_at TEXT,
  valid INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('news', 'blog')),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  excerpt TEXT,
  published_at TEXT,
  scraped_at TEXT NOT NULL DEFAULT (datetime('now')),
  raw_json_path TEXT
);
CREATE INDEX IF NOT EXISTS idx_sources_keyword ON sources(keyword);

CREATE TABLE IF NOT EXISTS style_profiles (
  id TEXT PRIMARY KEY,
  blog_id TEXT NOT NULL,
  profile_json_path TEXT NOT NULL,
  summary TEXT,
  built_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','collecting','generating','sourcing_images','ready','failed')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  error TEXT,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  keyword TEXT NOT NULL,
  title TEXT NOT NULL,
  body_html TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','edited','published','discarded')) DEFAULT 'draft',
  style_profile_id TEXT REFERENCES style_profiles(id),
  source_ids_json TEXT NOT NULL DEFAULT '[]',
  image_ids_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  places_json TEXT NOT NULL DEFAULT '[]',
  business_name TEXT,
  report_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_drafts_run ON drafts(run_id);

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES drafts(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('stock','ai')),
  source_ref TEXT,
  processed_path TEXT NOT NULL,
  license_info TEXT,
  slot_index INTEGER NOT NULL DEFAULT -1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_images_draft ON images(draft_id);

CREATE TABLE IF NOT EXISTS published_posts (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES drafts(id),
  naver_post_url TEXT,
  published_at TEXT NOT NULL DEFAULT (datetime('now')),
  success INTEGER NOT NULL,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

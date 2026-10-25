/**
 * 数据库 schema 与迁移。
 * 独立于 node:sqlite 的加载方式（生产用静态导入，测试用 createRequire），
 * 避免两处 schema 漂移。
 */

export const SCHEMA_VERSION = 15

/** node:sqlite DatabaseSync 的结构性子集（测试可用替身满足） */
export interface SchemaExecutor {
  exec(sql: string): void
  prepare(sql: string): { get(...params: unknown[]): unknown }
}

export function applySchema(db: SchemaExecutor): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (row.user_version >= SCHEMA_VERSION) return

  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      path       TEXT PRIMARY KEY,
      title      TEXT NOT NULL DEFAULT '',
      tags       TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- trigram 分词：支持中英文任意位置子串匹配（>=3 字符）
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      path    UNINDEXED,
      title,
      content,
      tokenize = 'trigram'
    );

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  if (row.user_version < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS calendars (
        id           TEXT PRIMARY KEY,
        url          TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        color        TEXT NOT NULL DEFAULT '#7c6cf0',
        source       TEXT NOT NULL DEFAULT 'caldav',
        ctag         TEXT,
        synced_at    TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        uid              TEXT NOT NULL,
        calendar_id      TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
        title            TEXT NOT NULL DEFAULT '',
        description      TEXT NOT NULL DEFAULT '',
        location         TEXT NOT NULL DEFAULT '',
        -- 定时事件：ISO UTC 字符串；全天事件：YYYY-MM-DD
        start_at         TEXT NOT NULL,
        end_at           TEXT NOT NULL,
        all_day          INTEGER NOT NULL DEFAULT 0,
        rrule            TEXT,
        reminder_minutes INTEGER,
        reminder_fired   INTEGER NOT NULL DEFAULT 0,
        source           TEXT NOT NULL DEFAULT 'caldav',
        url              TEXT,
        etag             TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        PRIMARY KEY (calendar_id, uid)
      );

      CREATE INDEX IF NOT EXISTS idx_events_range
        ON events(start_at, end_at);

      CREATE TABLE IF NOT EXISTS reminders_fired (
        key      TEXT PRIMARY KEY,
        fired_at TEXT NOT NULL
      );
    `)
  }

  if (row.user_version < 3) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id           TEXT PRIMARY KEY,
        title        TEXT NOT NULL,
        notes        TEXT NOT NULL DEFAULT '',
        -- 截止：ISO UTC（带时间）或 YYYY-MM-DD（全天）或 NULL（无截止）
        due_at       TEXT,
        all_day      INTEGER NOT NULL DEFAULT 0,
        priority     INTEGER NOT NULL DEFAULT 0,
        status       TEXT NOT NULL DEFAULT 'todo',
        tags         TEXT NOT NULL DEFAULT '[]',
        note_path    TEXT,
        -- 转为日程后关联的日历事件 id（calendarId::uid）
        event_id     TEXT,
        created_at   TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status_due
        ON tasks(status, due_at);
    `)
  }

  if (row.user_version < 4) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        role       TEXT NOT NULL,
        content    TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `)
  }

  if (row.user_version < 5) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS links (
        source_path  TEXT NOT NULL,
        target_title TEXT NOT NULL,
        target_path  TEXT,
        kind         TEXT NOT NULL DEFAULT 'link',
        PRIMARY KEY (source_path, target_title, kind)
      );

      CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_path);
    `)
  }

  if (row.user_version < 6) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS note_props (
        path       TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        value_type TEXT NOT NULL,
        PRIMARY KEY (path, key)
      );

      CREATE INDEX IF NOT EXISTS idx_note_props_kv ON note_props(key, value);
    `)
  }

  if (row.user_version < 7) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS note_chunks (
        path        TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        text        TEXT NOT NULL,
        vector      BLOB NOT NULL,
        dim         INTEGER NOT NULL,
        model       TEXT NOT NULL,
        PRIMARY KEY (path, chunk_index)
      );

      CREATE INDEX IF NOT EXISTS idx_note_chunks_path ON note_chunks(path);
    `)
  }

  if (row.user_version < 15) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS semantic_docs (
        path       TEXT PRIMARY KEY,
        hash       TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
  }

  if (row.user_version < 14) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        calendar_id  TEXT    NOT NULL,
        uid          TEXT    NOT NULL,
        title        TEXT    NOT NULL,
        notes        TEXT    NOT NULL DEFAULT '',
        due_at       TEXT,
        priority     INTEGER NOT NULL DEFAULT 0,
        completed    INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT,
        url          TEXT,
        etag         TEXT,
        updated_at   TEXT    NOT NULL,
        PRIMARY KEY (calendar_id, uid)
      );

      CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(completed, due_at);
    `)
  }

  if (row.user_version < 13) {
    // 历史遗留：写向 VTODO 集合失败的事件没有 url/etag，却标着 caldav
    db.exec(`
      UPDATE events
         SET source = 'local'
       WHERE source = 'caldav' AND (url IS NULL OR url = '');
    `)
  }

  if (row.user_version < 12) {
    db.exec(`
      ALTER TABLE calendars ADD COLUMN components TEXT NOT NULL DEFAULT '["VEVENT"]';
    `)
  }

  if (row.user_version < 11) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS retrieval_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT    NOT NULL DEFAULT 'desktop',
        channel    TEXT    NOT NULL DEFAULT 'local',
        query      TEXT    NOT NULL,
        terms      TEXT    NOT NULL DEFAULT '[]',
        hits       TEXT    NOT NULL DEFAULT '[]',
        sources    TEXT    NOT NULL DEFAULT '[]',
        latency_ms INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_retrieval_log_created ON retrieval_log(created_at);
    `)
  }

  if (row.user_version < 10) {
    db.exec(`
      ALTER TABLE ai_messages ADD COLUMN session_id TEXT NOT NULL DEFAULT 'desktop';
      CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_messages(session_id, id);

      CREATE TABLE IF NOT EXISTS channel_bindings (
        channel    TEXT    NOT NULL,
        user_id    TEXT    NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (channel, user_id)
      );
    `)
  }

  if (row.user_version < 9) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS channel_dedup (
        channel        TEXT    NOT NULL,
        channel_msg_id TEXT    NOT NULL,
        processed_at   INTEGER NOT NULL,
        PRIMARY KEY (channel, channel_msg_id)
      );
    `)
  }

  if (row.user_version < 8) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        path       TEXT PRIMARY KEY,
        ext        TEXT NOT NULL,
        title      TEXT NOT NULL,
        text       TEXT NOT NULL,
        chars      INTEGER NOT NULL,
        mtime      TEXT NOT NULL,
        indexed_at TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        path UNINDEXED, title, text, tokenize = 'trigram'
      );
    `)
  }

  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
}

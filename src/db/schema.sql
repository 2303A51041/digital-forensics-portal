-- Digital Forensics Portal schema (SQLite).
-- Cases, evidence and users are never deleted, and hashes, custody events and
-- logs cannot be altered. Triggers enforce this below the application layer.

CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name      TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('Admin','Forensic Investigator','Case Manager','Auditor')),
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  token_version  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  last_login_at  TEXT
);

CREATE TABLE IF NOT EXISTS cases (
  id           INTEGER PRIMARY KEY,
  case_number  TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  case_type    TEXT NOT NULL,
  priority     TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low','Medium','High','Critical')),
  status       TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','On Hold','Closed')),
  created_by   INTEGER NOT NULL REFERENCES users(id),
  opened_at    TEXT NOT NULL,
  due_date     TEXT,
  closed_at    TEXT,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);

CREATE TABLE IF NOT EXISTS case_assignments (
  case_id       INTEGER NOT NULL REFERENCES cases(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  role_on_case  TEXT NOT NULL DEFAULT 'Support' CHECK (role_on_case IN ('Lead','Support')),
  assigned_by   INTEGER NOT NULL REFERENCES users(id),
  assigned_at   TEXT NOT NULL,
  PRIMARY KEY (case_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_assign_user ON case_assignments(user_id);

CREATE TABLE IF NOT EXISTS evidence (
  id                    INTEGER PRIMARY KEY,
  evidence_number       TEXT NOT NULL UNIQUE,
  case_id               INTEGER NOT NULL REFERENCES cases(id),
  item_name             TEXT NOT NULL,
  evidence_type         TEXT NOT NULL,
  source                TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  storage_location      TEXT NOT NULL DEFAULT '',
  collected_at          TEXT NOT NULL,
  registered_at         TEXT NOT NULL,
  registered_by         INTEGER NOT NULL REFERENCES users(id),
  sha256                TEXT CHECK (sha256 IS NULL OR (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')),
  md5                   TEXT CHECK (md5 IS NULL OR (length(md5) = 32 AND md5 NOT GLOB '*[^0-9a-f]*')),
  hash_origin           TEXT NOT NULL CHECK (hash_origin IN ('Computed','Declared')),
  file_storage_name     TEXT,
  original_filename     TEXT,
  mime_type             TEXT,
  file_size             INTEGER,
  current_custodian_id  INTEGER NOT NULL REFERENCES users(id),
  status                TEXT NOT NULL DEFAULT 'In Storage'
                        CHECK (status IN ('In Storage','In Analysis','In Transit','Released','Archived')),
  last_verified_at      TEXT,
  last_verify_result    TEXT CHECK (last_verify_result IS NULL OR last_verify_result IN ('Match','Mismatch')),
  CHECK (sha256 IS NOT NULL OR md5 IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_evidence_case ON evidence(case_id);
CREATE INDEX IF NOT EXISTS idx_evidence_custodian ON evidence(current_custodian_id);

CREATE TABLE IF NOT EXISTS custody_events (
  id            INTEGER PRIMARY KEY,
  evidence_id   INTEGER NOT NULL REFERENCES evidence(id),
  action        TEXT NOT NULL CHECK (action IN ('Registered','Transfer')),
  from_user_id  INTEGER REFERENCES users(id),
  to_user_id    INTEGER NOT NULL REFERENCES users(id),
  location      TEXT NOT NULL DEFAULT '',
  purpose       TEXT NOT NULL,
  notes         TEXT NOT NULL DEFAULT '',
  status_after  TEXT NOT NULL,
  occurred_at   TEXT NOT NULL,
  recorded_by   INTEGER NOT NULL REFERENCES users(id),
  recorded_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_custody_evidence ON custody_events(evidence_id, occurred_at);

CREATE TABLE IF NOT EXISTS evidence_access_logs (
  id           INTEGER PRIMARY KEY,
  evidence_id  INTEGER NOT NULL REFERENCES evidence(id),
  user_id      INTEGER NOT NULL REFERENCES users(id),
  action       TEXT NOT NULL CHECK (action IN ('View','Download','Verify','Transfer','Register')),
  detail       TEXT NOT NULL DEFAULT '',
  ip_address   TEXT NOT NULL DEFAULT '',
  accessed_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_evidence ON evidence_access_logs(evidence_id);

CREATE TABLE IF NOT EXISTS findings (
  id                       INTEGER PRIMARY KEY,
  case_id                  INTEGER NOT NULL REFERENCES cases(id),
  evidence_id              INTEGER REFERENCES evidence(id),
  title                    TEXT NOT NULL,
  details                  TEXT NOT NULL,
  severity                 TEXT NOT NULL DEFAULT 'Medium' CHECK (severity IN ('Info','Low','Medium','High','Critical')),
  status                   TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Final')),
  author_id                INTEGER NOT NULL REFERENCES users(id),
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  finalized_at             TEXT,
  attachment_storage_name  TEXT,
  attachment_filename      TEXT,
  attachment_sha256        TEXT
);
CREATE INDEX IF NOT EXISTS idx_findings_case ON findings(case_id);

CREATE TABLE IF NOT EXISTS case_summaries (
  id            INTEGER PRIMARY KEY,
  case_id       INTEGER NOT NULL REFERENCES cases(id),
  version       INTEGER NOT NULL,
  content       TEXT NOT NULL,
  generated_by  INTEGER NOT NULL REFERENCES users(id),
  generated_at  TEXT NOT NULL,
  UNIQUE (case_id, version)
);

-- Each row stores the hash of the previous row, so edits made directly to the
-- database file are detectable through the "verify chain" function.
CREATE TABLE IF NOT EXISTS audit_logs (
  id           INTEGER PRIMARY KEY,
  occurred_at  TEXT NOT NULL,
  user_id      INTEGER,
  username     TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT '',
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL DEFAULT '',
  entity_id    TEXT NOT NULL DEFAULT '',
  details      TEXT NOT NULL DEFAULT '',
  ip_address   TEXT NOT NULL DEFAULT '',
  prev_hash    TEXT NOT NULL,
  row_hash     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

-- Immutability rules
CREATE TRIGGER IF NOT EXISTS custody_no_update BEFORE UPDATE ON custody_events
BEGIN SELECT RAISE(ABORT, 'custody_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS custody_no_delete BEFORE DELETE ON custody_events
BEGIN SELECT RAISE(ABORT, 'custody_events is append-only'); END;

CREATE TRIGGER IF NOT EXISTS access_no_update BEFORE UPDATE ON evidence_access_logs
BEGIN SELECT RAISE(ABORT, 'evidence_access_logs is append-only'); END;
CREATE TRIGGER IF NOT EXISTS access_no_delete BEFORE DELETE ON evidence_access_logs
BEGIN SELECT RAISE(ABORT, 'evidence_access_logs is append-only'); END;

CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;

CREATE TRIGGER IF NOT EXISTS evidence_no_delete BEFORE DELETE ON evidence
BEGIN SELECT RAISE(ABORT, 'evidence records cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS evidence_hash_locked BEFORE UPDATE OF sha256, md5, collected_at, case_id ON evidence
BEGIN SELECT RAISE(ABORT, 'evidence hashes and acquisition data are immutable'); END;

CREATE TRIGGER IF NOT EXISTS case_no_delete BEFORE DELETE ON cases
BEGIN SELECT RAISE(ABORT, 'cases cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS finding_final_locked BEFORE UPDATE ON findings
WHEN OLD.status = 'Final'
BEGIN SELECT RAISE(ABORT, 'finalized findings are immutable'); END;
CREATE TRIGGER IF NOT EXISTS finding_no_delete BEFORE DELETE ON findings
WHEN OLD.status = 'Final'
BEGIN SELECT RAISE(ABORT, 'finalized findings are immutable'); END;

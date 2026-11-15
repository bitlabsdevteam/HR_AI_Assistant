CREATE TABLE IF NOT EXISTS Employee (
  employee_number    TEXT PRIMARY KEY,
  first_name         TEXT NOT NULL,
  entitlement_days   INTEGER NOT NULL DEFAULT 14,
  pin_hash           TEXT NOT NULL,
  secret_question    TEXT,
  secret_answer_hash TEXT,
  active             INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

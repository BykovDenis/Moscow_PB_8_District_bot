-- Ошибки бота: что сломалось, на каком событии и у кого. Читать: SELECT * FROM errors_msk ORDER BY at_msk DESC;
CREATE TABLE errors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          INTEGER NOT NULL,
  update_type TEXT,
  user_id     INTEGER,
  where_      TEXT,
  message     TEXT NOT NULL
);

CREATE VIEW errors_msk AS
SELECT datetime(at, 'unixepoch', '+3 hours') AS at_msk, update_type, user_id, where_, message FROM errors;

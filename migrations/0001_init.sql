-- Одна строка на пользователя: его последняя заявка
CREATE TABLE requests (
  user_id       INTEGER PRIMARY KEY,
  user_chat_id  INTEGER NOT NULL,
  first_name    TEXT NOT NULL,
  last_name     TEXT,
  username      TEXT,
  bio           TEXT,
  photos        INTEGER NOT NULL DEFAULT 0,
  premium       INTEGER NOT NULL DEFAULT 0,
  -- живёт в квартале: 1 / 0, NULL — ещё не ответил
  resident      INTEGER,
  -- дом (если живёт в квартале) или квартал микрорайона (если нет)
  place         TEXT,
  -- resident | place | review | approved | declined | expired
  step          TEXT NOT NULL,
  dm_ok         INTEGER NOT NULL DEFAULT 1,
  admin_msg_id  INTEGER,
  decided_by    TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX requests_step ON requests(step, created_at);

-- Журнал решений: кто, кого и когда принял/отклонил
CREATE TABLE decisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  action      TEXT NOT NULL,
  actor_id    INTEGER,
  actor_name  TEXT,
  at          INTEGER NOT NULL
);

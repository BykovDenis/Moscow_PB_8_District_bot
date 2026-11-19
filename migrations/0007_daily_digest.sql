CREATE TABLE digest_messages (
  chat_id TEXT NOT NULL,
  day TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  reply_to INTEGER,
  body TEXT NOT NULL,
  PRIMARY KEY (chat_id, day, message_id)
);

CREATE TABLE digest_runs (
  chat_id TEXT NOT NULL,
  day TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('preparing', 'sending', 'sent')),
  owner TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  message_count INTEGER,
  telegram_message_id INTEGER,
  PRIMARY KEY (chat_id, day)
);

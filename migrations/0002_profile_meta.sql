-- Дополнительные сведения о заявителе для карточки
ALTER TABLE requests ADD COLUMN language TEXT;      -- язык интерфейса Telegram
ALTER TABLE requests ADD COLUMN invite_name TEXT;   -- название ссылки, по которой пришёл
ALTER TABLE requests ADD COLUMN channel TEXT;       -- личный канал в профиле
ALTER TABLE requests ADD COLUMN house_chats TEXT;   -- в каких чатах домов состоит (через запятую)

-- Архив прошлых заявок: при повторной заявке старая строка из requests копируется сюда,
-- чтобы видеть историю попыток (например, спамер подаёт заявку снова и снова).
-- ВАЖНО: столбцы должны совпадать с requests. Новый столбец в requests — добавить и сюда.
CREATE TABLE attempts AS SELECT * FROM requests WHERE 0;
CREATE INDEX attempts_user ON attempts(user_id);

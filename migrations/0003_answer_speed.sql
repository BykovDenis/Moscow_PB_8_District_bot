-- Через сколько секунд после заявки человек нажал кнопку на первом вопросе (боты — почти мгновенно)
ALTER TABLE requests ADD COLUMN answer_sec INTEGER;

-- Представления для чтения глазами (консоль D1, отчёты): даты по Москве вместо Unix-времени.
-- Бот работает с таблицами напрямую; здесь — только удобный вид.
-- Использование: SELECT * FROM requests_msk;

CREATE VIEW requests_msk AS
SELECT
  datetime(created_at, 'unixepoch', '+3 hours') AS created_msk,
  datetime(updated_at, 'unixepoch', '+3 hours') AS updated_msk,
  CASE step
    WHEN 'resident' THEN 'не ответил на 1-й вопрос'
    WHEN 'place'    THEN 'не ответил на 2-й вопрос'
    WHEN 'review'   THEN 'ждёт решения'
    WHEN 'approved' THEN 'принят'
    WHEN 'declined' THEN 'отклонён'
    WHEN 'expired'  THEN 'отклонён: не ответил'
  END AS status,
  decided_by,
  user_id, username, first_name, last_name,
  CASE resident WHEN 1 THEN 'да' WHEN 0 THEN 'нет' END AS lives_here,
  place, answer_sec, language, photos, premium, bio, channel, invite_name, house_chats, dm_ok
FROM requests;

CREATE VIEW attempts_msk AS
SELECT
  datetime(created_at, 'unixepoch', '+3 hours') AS created_msk,
  step, user_id, username, first_name, last_name, resident, place, answer_sec, language
FROM attempts;

CREATE VIEW decisions_msk AS
SELECT
  datetime(d.at, 'unixepoch', '+3 hours') AS at_msk,
  d.action, d.actor_name, d.user_id, r.username, r.first_name, r.last_name
FROM decisions d LEFT JOIN requests r ON r.user_id = d.user_id;

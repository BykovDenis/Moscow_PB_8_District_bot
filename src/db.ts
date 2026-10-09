export type Step = "resident" | "place" | "review" | "approved" | "declined" | "expired";

export interface RequestRow {
  user_id: number;
  user_chat_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  bio: string | null;
  photos: number;
  premium: number;
  language: string | null;
  invite_name: string | null;
  channel: string | null;
  house_chats: string | null;
  resident: number | null;
  place: string | null;
  answer_sec: number | null;
  step: Step;
  dm_ok: number;
  admin_msg_id: number | null;
  decided_by: string | null;
  created_at: number;
  updated_at: number;
}

const now = () => Math.floor(Date.now() / 1000);

export class Db {
  constructor(private db: D1Database) {}

  get(userId: number): Promise<RequestRow | null> {
    return this.db.prepare("SELECT * FROM requests WHERE user_id = ?").bind(userId).first<RequestRow>();
  }

  /** Новая заявка (повторная заявка того же человека начинается заново). */
  async create(r: Pick<RequestRow, "user_id" | "user_chat_id" | "first_name" | "last_name" | "username" | "bio" | "photos" | "premium" | "language" | "invite_name" | "channel" | "house_chats">) {
    const t = now();
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO requests
           (user_id, user_chat_id, first_name, last_name, username, bio, photos, premium,
            language, invite_name, channel, house_chats, step, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'resident', ?, ?)`,
      )
      .bind(
        r.user_id, r.user_chat_id, r.first_name, r.last_name, r.username, r.bio, r.photos, r.premium,
        r.language, r.invite_name, r.channel, r.house_chats, t, t,
      )
      .run();
  }

  async update(userId: number, fields: Partial<Omit<RequestRow, "user_id">>) {
    const entries = Object.entries(fields);
    const set = [...entries.map(([k]) => `${k} = ?`), "updated_at = ?"].join(", ");
    await this.db
      .prepare(`UPDATE requests SET ${set} WHERE user_id = ?`)
      .bind(...entries.map(([, v]) => v), now(), userId)
      .run();
  }

  /** Заявки, где человек не ответил на вопросы дольше `hours` часов. */
  async stale(hours: number): Promise<RequestRow[]> {
    const { results } = await this.db
      .prepare("SELECT * FROM requests WHERE step IN ('resident', 'place') AND created_at < ?")
      .bind(now() - hours * 3600)
      .all<RequestRow>();
    return results;
  }

  /** Сколько заявок в каждом статусе: всего и за последние `days` дней. */
  async stats(days: number): Promise<{ step: Step; total: number; recent: number }[]> {
    const { results } = await this.db
      .prepare(
        `SELECT step, COUNT(*) AS total, SUM(created_at >= ?) AS recent
         FROM requests GROUP BY step`,
      )
      .bind(now() - days * 86400)
      .all<{ step: Step; total: number; recent: number }>();
    return results;
  }

  async log(userId: number, action: string, actorId: number | null, actorName: string | null) {
    await this.db
      .prepare("INSERT INTO decisions (user_id, action, actor_id, actor_name, at) VALUES (?, ?, ?, ?, ?)")
      .bind(userId, action, actorId, actorName, now())
      .run();
  }
}

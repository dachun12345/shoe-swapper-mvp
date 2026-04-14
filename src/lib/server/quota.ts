type QuotaKey = string;

type QuotaState = {
  day: string; // YYYY-MM-DD
  used: number;
};

const DAILY_LIMIT = Number(process.env.DAILY_LIMIT ?? 1000);

// 仅用于MVP：进程内内存计数（不做持久化）
const quotaMap = new Map<QuotaKey, QuotaState>();

function todayKey(): string {
  // 用UTC日期避免服务器时区差异导致“跨天”不一致（MVP足够）
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function getDailyLimit(): number {
  return Number.isFinite(DAILY_LIMIT) ? DAILY_LIMIT : 1000;
}

export function checkAndConsumeQuota(inviteCode: string, cost = 1): {
  ok: boolean;
  used: number;
  remaining: number;
  limit: number;
} {
  const day = todayKey();
  const key: QuotaKey = `${inviteCode}::${day}`;
  const limit = getDailyLimit();
  const prev = quotaMap.get(key) ?? { day, used: 0 };

  const nextUsed = prev.used + cost;
  if (nextUsed > limit) {
    return { ok: false, used: prev.used, remaining: Math.max(0, limit - prev.used), limit };
  }

  quotaMap.set(key, { day, used: nextUsed });
  return { ok: true, used: nextUsed, remaining: Math.max(0, limit - nextUsed), limit };
}


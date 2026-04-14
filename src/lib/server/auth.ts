export function getInviteCodes(): string[] {
  const raw = process.env.INVITE_CODES?.trim();
  if (!raw) return ["DEMO2026"];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isValidInviteCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return getInviteCodes().includes(code.trim());
}


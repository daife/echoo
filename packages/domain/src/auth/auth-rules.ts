export function canRefreshToken(
  refreshToken: string | null,
): refreshToken is string {
  return typeof refreshToken === "string" && refreshToken.length > 0;
}

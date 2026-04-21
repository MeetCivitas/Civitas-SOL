export const SESSION_COOKIE = "civitas_session";
const JWT_SECRET = process.env.AUTH_JWT_SECRET || "dev-secret";
const secretKey = new TextEncoder().encode(JWT_SECRET);

export interface SessionPayload {
  sub: string;
  username: string;
  role: string;
  employee_tag?: string;
  exp?: number;
}

export async function signSession(payload: Omit<SessionPayload, "exp">) {
  const { SignJWT } = await import("jose");
  return new SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1d")
    .sign(secretKey);
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { jwtVerify } = await import("jose");
    const { payload } = await jwtVerify(token, secretKey);
    return payload as unknown as SessionPayload;
  } catch (err) {
    return null;
  }
}

export function buildSessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24,
    },
  };
}


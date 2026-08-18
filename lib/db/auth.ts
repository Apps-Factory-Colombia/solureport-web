import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { dbQuery } from "./postgres";

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = "solureport_session";
const SESSION_DAYS = 30;

export interface AuthenticatedUser {
  id: string;
  username: string;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string | null;
  rol: string;
  estado: string;
  avatar_url: string | null;
  tiene_recorrido: boolean;
  tiene_moto: boolean;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < 8) {
    throw new Error("La contraseña debe tener al menos 8 caracteres.");
  }
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$1$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  // The Supabase legacy dataset stores bcrypt hashes. V2 uses scrypt for new
  // passwords, but keeping this compatibility path lets existing users log in
  // and avoids forcing a destructive password reset during migration.
  if (/^\$2[aby]\$/.test(String(encoded || ""))) {
    try {
      const { rows } = await dbQuery<{ valid: boolean }>(
        "SELECT extensions.crypt($1, $2) = $2 AS valid",
        [password, encoded],
      );
      return rows[0]?.valid === true;
    } catch {
      return false;
    }
  }

  const [algorithm, version, salt, expectedHex] = String(encoded || "").split("$");
  if (algorithm !== "scrypt" || version !== "1" || !salt || !expectedHex) return false;
  try {
    const expected = Buffer.from(expectedHex, "hex");
    const actual = (await scrypt(password, salt, expected.length)) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export async function getAuthenticatedUser(request: NextRequest): Promise<AuthenticatedUser | null> {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const token = bearer || request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const { rows } = await dbQuery<AuthenticatedUser>(
    `SELECT u.id, u.username, u.nombre, u.apellido, u.email, u.telefono, u.rol,
            u.estado, u.avatar_url, u.tiene_recorrido, u.tiene_moto
       FROM public.sesiones_usuario s
       JOIN public.usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > clock_timestamp()
        AND u.estado = 'activo'
      LIMIT 1`,
    [hashSessionToken(token)],
  );
  return rows[0] || null;
}

export async function issueSession(userId: string, request: NextRequest, response: NextResponse): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await dbQuery(
    `INSERT INTO public.sesiones_usuario
      (usuario_id, token_hash, dispositivo, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      userId,
      hashSessionToken(token),
      "solureport-web",
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      request.headers.get("user-agent") || null,
      expiresAt.toISOString(),
    ],
  );
  const secureCookie = process.env.SOLUREPORT_COOKIE_SECURE === "true"
    || (process.env.NODE_ENV === "production" && request.headers.get("x-forwarded-proto") === "https");
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
    path: "/",
    expires: expiresAt,
  });
  return token;
}

export async function revokeSession(request: NextRequest, response: NextResponse): Promise<void> {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const token = bearer || request.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    await dbQuery(
      "UPDATE public.sesiones_usuario SET revoked_at = clock_timestamp() WHERE token_hash = $1 AND revoked_at IS NULL",
      [hashSessionToken(token)],
    );
  }
  const secureCookie = process.env.SOLUREPORT_COOKIE_SECURE === "true"
    || (process.env.NODE_ENV === "production" && request.headers.get("x-forwarded-proto") === "https");
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: secureCookie, path: "/", maxAge: 0 });
}

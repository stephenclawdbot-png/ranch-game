/**
 * Anonymous device accounts: POST /api/account creates the account and stable
 * (createAccount) and sets the raw device token as an httpOnly cookie; every request
 * resolves it with authenticate(). Only the token's hash is stored server-side.
 */
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { authenticate, type StableRow } from "@thoroughbred/db";
import { db, type Db } from "./db";
import { UnauthorizedError } from "./errors";

export const SESSION_COOKIE = "tb_session";
/** Device sessions last a long time; the stable lives as long as the cookie (one year, renewed on visit). */
const MAX_AGE_S = 365 * 24 * 60 * 60;

export interface Session {
  accountId: string;
  stable: StableRow;
}

export async function sessionToken(): Promise<string | null> {
  const jar = await cookies();
  const v = jar.get(SESSION_COOKIE)?.value;
  return v && /^[A-Za-z0-9_-]{20,200}$/.test(v) ? v : null;
}

/** The signed-in player for this request, or null. */
export async function getSession(database?: Db): Promise<Session | null> {
  const token = await sessionToken();
  if (!token) return null;
  return authenticate(database ?? (await db()), token);
}

export async function requireSession(database?: Db): Promise<Session> {
  const s = await getSession(database);
  if (!s) throw new UnauthorizedError();
  return s;
}

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}

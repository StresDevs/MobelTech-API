import crypto from 'node:crypto';
import { env } from '../config/env';

export type AuthRole = 'admin' | 'contractor' | 'architect' | 'partner';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: AuthRole;
  avatar?: string | null;
  username?: string;
  mustChangePassword?: boolean;
}

const COOKIE_NAME = 'mobeltech_token';
const isProduction = env.NODE_ENV === 'production';

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string) {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(payload).digest('base64url');
}

export function createToken(user: AuthUser) {
  const payload = base64url(JSON.stringify({
    sub: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar ?? null,
    iat: Math.floor(Date.now() / 1000),
  }));
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token?: string | null): AuthUser | null {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  if (sign(payload) !== signature) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return {
      id: data.sub,
      name: data.name,
      email: data.email,
      role: data.role,
      avatar: data.avatar,
    };
  } catch {
    return null;
  }
}

export function serializeAuthCookie(token: string) {
  const sameSite = isProduction ? 'None' : 'Lax';
  const secure = isProduction ? '; Secure' : '';
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${60 * 60 * 24 * 7}${secure}`;
}

export function getTokenFromRequestCookie(cookieHeader?: string) {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match?.[1] ?? null;
}

export function getTokenFromAuthorizationHeader(authorizationHeader?: string | null) {
  if (!authorizationHeader) return null;

  const [scheme, token] = authorizationHeader.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;

  return token;
}

export function getTokenFromRequest(headers: { authorization?: string; cookie?: string }) {
  return getTokenFromAuthorizationHeader(headers.authorization) ?? getTokenFromRequestCookie(headers.cookie);
}

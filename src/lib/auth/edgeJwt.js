import { SignJWT, jwtVerify } from "jose";
import { getSharedJwtSecretKey } from "@/lib/auth/jwtSecret.shared";

// Edge-runtime-safe — no node:fs, no eval. Shares the exact secret resolution
// with dashboardSession.js so cookies signed in the login route verify here.
const SECRET = getSharedJwtSecretKey();

export async function createEdgeJwt(claims = {}) {
  return new SignJWT({ authenticated: true, ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(SECRET);
}

export async function verifyEdgeJwt(token) {
  if (!token) return false;
  try {
    await jwtVerify(token, SECRET);
    return true;
  } catch {
    return false;
  }
}

export async function getEdgeJwtPayload(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload;
  } catch {
    return null;
  }
}

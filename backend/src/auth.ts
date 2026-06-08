import type { NextFunction, Request, Response } from "express";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { config } from "./config.js";

declare global {
  namespace Express {
    interface Request {
      user?: {
        uid: string;
      };
    }
  }
}

const oauthClient = new OAuth2Client();

export async function requireUser(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  if (config.allowUnauthenticatedDev) {
    request.user = { uid: "local-dev" };
    next();
    return;
  }

  const token = getBearerToken(request);
  if (!token) {
    response.status(401).json({ error: "Authentication required" });
    return;
  }

  const session = verifySessionToken(token);
  if (!session) {
    response.status(401).json({ error: "Invalid or expired session" });
    return;
  }
  request.user = { uid: session.uid };
  next();
}

export async function requireScheduler(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  if (config.allowUnauthenticatedDev) {
    next();
    return;
  }

  const token = getBearerToken(request);
  if (!token || !config.schedulerAudience) {
    response.status(401).json({ error: "Scheduler authentication required" });
    return;
  }

  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken: token,
      audience: config.schedulerAudience,
    });
    const payload = ticket.getPayload();
    if (
      !payload?.email ||
      !payload.email_verified ||
      (config.schedulerServiceAccount &&
        payload.email !== config.schedulerServiceAccount)
    ) {
      response.status(403).json({ error: "Invalid scheduler identity" });
      return;
    }
    next();
  } catch {
    response.status(401).json({ error: "Invalid scheduler token" });
  }
}

function getBearerToken(request: Request) {
  const authorization = request.header("authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
}

export function loginWithPassword(password: string) {
  if (!config.adminPassword || !config.sessionSecret) {
    throw new Error("ADMIN_PASSWORD is not configured");
  }
  if (!secureEqual(password, config.adminPassword)) {
    return undefined;
  }
  return createSessionToken("admin");
}

function createSessionToken(uid: string) {
  const payload = Buffer.from(
    JSON.stringify({
      uid,
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      nonce: randomUUID(),
    }),
  ).toString("base64url");
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

function verifySessionToken(token: string) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !secureEqual(signature, sign(payload))) {
    return undefined;
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { uid?: string; exp?: number };
    if (!decoded.uid || !decoded.exp || decoded.exp < Date.now() / 1000) {
      return undefined;
    }
    return { uid: decoded.uid };
  } catch {
    return undefined;
  }
}

function sign(payload: string) {
  return createHmac("sha256", config.sessionSecret)
    .update(payload)
    .digest("base64url");
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

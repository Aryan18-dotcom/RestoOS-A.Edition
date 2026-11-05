import crypto from "node:crypto";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export const hashPassword = (password) => argon2.hash(password, { type: argon2.argon2id });
export const verifyPassword = (hash, password) => argon2.verify(hash, password);
export const randomSecret = (bytes = 18) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
export function signAccess(user) {
  return jwt.sign({ sub: String(user._id), role: user.role, tenantId: user.tenantId ? String(user.tenantId) : null, mustChangePassword: user.mustChangePassword }, env.accessSecret, { expiresIn: env.accessTtl, issuer: "restaurantos" });
}
export function signRefresh(user) {
  return jwt.sign({ sub: String(user._id), tokenVersion: Date.now() }, env.refreshSecret, { expiresIn: `${env.refreshDays}d`, issuer: "restaurantos" });
}
export function verifyAccess(token) {
  return jwt.verify(token, env.accessSecret, { issuer: "restaurantos" });
}
export function verifyRefresh(token) {
  return jwt.verify(token, env.refreshSecret, { issuer: "restaurantos" });
}
export function safeEqualHex(a, b) {
  const aa = Buffer.from(a || "", "hex"), bb = Buffer.from(b || "", "hex");
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

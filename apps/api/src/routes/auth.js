import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { Tenant, User } from "../models/index.js";
import { hashPassword, verifyPassword, signAccess, signRefresh, verifyRefresh, sha256 } from "../utils/security.js";
import { requireAuth } from "../middleware/auth.js";
import { env } from "../config/env.js";

const router = Router();

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/"
};

const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
});

function setSession(res, user) {
  const access = signAccess(user);
  const refresh = signRefresh(user);
  user.refreshTokenHash = sha256(refresh);
  return user.save().then(() => {
    res.cookie("accessToken", access, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
    res.cookie("refreshToken", refresh, { ...cookieOptions, maxAge: env.refreshDays * 86400000 });
  });
}

router.get("/me", requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      name: req.user.name,
      role: req.user.role,
      tenantId: req.user.tenantId,
      mustChangePassword: req.user.mustChangePassword
    }
  });
});

router.post("/login", loginRateLimit, async (req, res, next) => {
  try {
    const body = z.object({
      loginId: z.string().min(2),
      password: z.string().min(1)
    }).parse(req.body);

    const user = await User.findOne({ loginId: body.loginId.toLowerCase(), isActive: true });
    if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.status && user.status !== "ACTIVE") {
      return res.status(403).json({ error: `This user account is ${user.status.toLowerCase()}.` });
    }

    if (user.tenantId) {
      const tenant = await Tenant.findById(user.tenantId).select("status isActive").lean();
      if (!tenant || tenant.isActive === false || (tenant.status && tenant.status !== "ACTIVE")) {
        return res.status(403).json({ error: "This restaurant account is unavailable." });
      }
    }

    user.lastLoginAt = new Date();
    await setSession(res, user);

    res.json({
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        mustChangePassword: user.mustChangePassword
      }
    });
  } catch (e) {
    next(e);
  }
});

router.post("/refresh", async (req, res) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) return res.status(401).json({ error: "Refresh session missing" });

    const payload = verifyRefresh(token);
    const user = await User.findById(payload.sub);
    if (!user?.isActive || user.refreshTokenHash !== sha256(token)) {
      return res.status(401).json({ error: "Refresh session revoked" });
    }

    if (user.status && user.status !== "ACTIVE") {
      return res.status(403).json({ error: "This user account is unavailable." });
    }

    if (user.tenantId) {
      const tenant = await Tenant.findById(user.tenantId).select("status isActive").lean();
      if (!tenant || tenant.isActive === false || (tenant.status && tenant.status !== "ACTIVE")) {
        return res.status(403).json({ error: "This restaurant account is unavailable." });
      }
    }

    await setSession(res, user);
    res.json({ ok: true });
  } catch {
    res.status(401).json({ error: "Invalid refresh session" });
  }
});

router.post("/logout", async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (token) {
    try {
      const p = verifyRefresh(token);
      await User.findByIdAndUpdate(p.sub, { $unset: { refreshTokenHash: 1 } });
    } catch {}
  }
  res.clearCookie("accessToken", { ...cookieOptions, maxAge: undefined });
  res.clearCookie("refreshToken", { ...cookieOptions, maxAge: undefined });
  res.json({ ok: true });
});

router.post("/first-login-update", requireAuth, async (req, res, next) => {
  try {
    const body = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(12).max(128),
      newLoginId: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/).optional().or(z.literal(""))
    }).parse(req.body);

    const user = await User.findById(req.user._id);
    if (!user || !user.mustChangePassword) {
      return res.status(409).json({ error: "Password change is not required" });
    }

    if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
      return res.status(400).json({ error: "Temporary password is incorrect" });
    }

    user.passwordHash = await hashPassword(body.newPassword);
    user.mustChangePassword = false;
    if (body.newLoginId) user.loginId = body.newLoginId.toLowerCase();

    await setSession(res, user);
    res.json({ ok: true, message: "Password updated" });
  } catch (e) {
    if (e.code === 11000 && e.keyPattern?.loginId) {
      return res.status(409).json({ error: "That login ID is already in use." });
    }
    next(e);
  }
});

export default router;
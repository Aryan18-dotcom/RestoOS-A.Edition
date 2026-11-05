import { Tenant, User } from "../models/index.js";
import { verifyAccess } from "../utils/security.js";

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.accessToken || req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const payload = verifyAccess(token);
    const user = await User.findById(payload.sub).lean();
    if (!user || !user.isActive) return res.status(401).json({ error: "Invalid session" });
    if (user.status && user.status !== "ACTIVE") return res.status(403).json({ code: "USER_UNAVAILABLE", error: `This user account is ${user.status.toLowerCase()}.` });
    if (user.tenantId) {
      const tenant = await Tenant.findById(user.tenantId).select("status isActive").lean();
      if (!tenant || tenant.isActive === false || (tenant.status && tenant.status !== "ACTIVE")) {
        return res.status(403).json({ code: "RESTAURANT_UNAVAILABLE", error: "This restaurant account is unavailable." });
      }
    }
    req.user = user;
    const isFirstLoginUpdate = req.baseUrl === "/api/v1/auth" && req.path === "/first-login-update";
    if (user.mustChangePassword && !isFirstLoginUpdate) {
      return res.status(403).json({ code: "PASSWORD_CHANGE_REQUIRED", error: "Change your temporary password first." });
    }
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

export const allowRoles = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "Insufficient permissions" });
  next();
};

export const requireTenant = (req, res, next) => {
  if (!req.user?.tenantId) return res.status(403).json({ error: "Restaurant context required" });
  req.tenantId = req.user.tenantId;
  next();
};

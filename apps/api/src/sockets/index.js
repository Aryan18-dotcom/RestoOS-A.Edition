import { Server } from "socket.io";
import { env } from "../config/env.js";
import { verifyAccess } from "../utils/security.js";
import { Tenant, User } from "../models/index.js";
import { setIo } from "./ioRef.js";

export function configureSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.webOrigin, credentials: true },
    transports: ["websocket", "polling"]
  });
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers.cookie?.split("; ").find(v => v.startsWith("accessToken="))?.split("=")[1];
      if (!token) return next(new Error("Authentication required"));
      const claims = verifyAccess(token);
      const user = await User.findById(claims.sub).lean();
      if (!user?.isActive || user.mustChangePassword || (user.status && user.status !== "ACTIVE")) return next(new Error("Invalid user session"));
      if (user.tenantId) {
        const tenant = await Tenant.findById(user.tenantId).select("status isActive").lean();
        if (!tenant || tenant.isActive === false || (tenant.status && tenant.status !== "ACTIVE")) {
          return next(new Error("Restaurant account is unavailable"));
        }
      }
      socket.user = user;
      next();
    } catch { next(new Error("Unauthorized")); }
  });
  io.on("connection", socket => {
    const u = socket.user;
    if (u.tenantId) {
      const tid = String(u.tenantId);
      socket.join(`user:${u._id}`);
      socket.join(`tenant:${tid}`);
      if (["owner", "manager", "cashier"].includes(u.role)) socket.join(`billing:${tid}`);
      if (["owner", "manager", "kitchen"].includes(u.role)) socket.join(`kitchen:${tid}`);
      if (["owner", "manager", "waiter"].includes(u.role)) socket.join(`waiters:${tid}`);
    }
  });
  setIo(io);
  return io;
}

import express from "express";
import os from "node:os";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import authRoutes from "./routes/auth.js";
import superAdminRoutes from "./routes/superAdmin.js";
import menuRoutes from "./routes/menu.js";
import orderRoutes from "./routes/orders.js";
import paymentRoutes, { razorpayWebhook } from "./routes/payments.js";
import kitchenRoutes from "./routes/kitchen.js";
import { env } from "./config/env.js";
import { connectDatabase } from "./config/db.js";

function isPrivateIpv4(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some(value => value < 0 || value > 255)) return false;
  return octets[0] === 10 ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
}

function getLanIpv4() {
  const addresses = Object.entries(os.networkInterfaces()).flatMap(([name, entries]) =>
    (entries || [])
      .filter(entry => entry.family === "IPv4" && !entry.internal && isPrivateIpv4(entry.address))
      .map(entry => ({ name: name.toLowerCase(), address: entry.address }))
  );
  addresses.sort((a, b) => Number(/wi-?fi|wireless|wlan/.test(b.name)) - Number(/wi-?fi|wireless|wlan/.test(a.name)));
  return addresses[0]?.address || null;
}

function isAllowedLanWebOrigin(origin) {
  try {
    const url = new URL(origin);
    const webOrigin = new URL(env.webOrigin);
    return url.protocol === "http:" &&
      url.port === webOrigin.port &&
      isPrivateIpv4(url.hostname);
  } catch {
    return false;
  }
}

function isSameOrigin(origin, req) {
  try {
    return new URL(origin).origin === new URL(`${req.protocol}://${req.get("host")}`).origin;
  } catch {
    return false;
  }
}

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors((req, callback) => {
  const origin = req.get("Origin");
  const allowed = !origin ||
      origin === env.webOrigin ||
      isSameOrigin(origin, req) ||
      (env.nodeEnv === "development" && isAllowedLanWebOrigin(origin));
  callback(null, {
    origin: allowed ? origin : false,
    credentials: true
  });
}));
app.use(pinoHttp({ autoLogging: false }));
app.use(async (_req, _res, next) => {
  try {
    await connectDatabase();
    next();
  } catch (error) {
    next(error);
  }
});
app.use(cookieParser());
app.post("/api/v1/webhooks/razorpay", express.raw({ type: "application/json", limit: "1mb" }), razorpayWebhook);
app.use(express.json({ limit: "1mb" }));
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/super-admin", superAdminRoutes);
app.use("/api/v1/menu", menuRoutes);
app.use("/api/v1/orders", orderRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/kitchen", kitchenRoutes);
app.get("/api/v1/network", (_req, res) => {
  if (env.nodeEnv !== "development") return res.sendStatus(404);
  res.json({ lanIpv4: getLanIpv4() });
});
app.get("/api/v1/health", (_req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));
app.use((err, _req, res, _next) => {
  const status = err.status || (err.name === "ZodError" ? 400 : 500);
  if (status >= 500) console.error(`[api] ${status}: ${err.message}`);
  res.status(status).json({
    error: status === 500 ? "Internal server error" : err.message,
    details: status === 400 ? err.issues : undefined
  });
});
export default app;

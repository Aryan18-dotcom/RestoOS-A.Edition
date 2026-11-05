import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

dotenv.config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });

const required = ["MONGODB_URI", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}
if (!process.env.MONGODB_URI.startsWith("mongodb+srv://")) {
  throw new Error("MONGODB_URI must be a MongoDB Atlas connection string starting with mongodb+srv://");
}
if (/YOUR_(USERNAME|PASSWORD|CLUSTER)/.test(process.env.MONGODB_URI)) {
  throw new Error("Replace the MongoDB Atlas placeholders in MONGODB_URI with your Atlas connection details.");
}
if (process.env.JWT_ACCESS_SECRET.length < 32 || process.env.JWT_REFRESH_SECRET.length < 32) {
  throw new Error("JWT secrets must be at least 32 characters.");
}
export const env = {
  nodeEnv: process.env.NODE_ENV || "production",
  port: Number(process.env.API_PORT || 5000),
  webOrigin: process.env.WEB_ORIGIN || "http://localhost:3000",
  mongoUri: process.env.MONGODB_URI,
  accessSecret: process.env.JWT_ACCESS_SECRET,
  refreshSecret: process.env.JWT_REFRESH_SECRET,
  accessTtl: process.env.ACCESS_TOKEN_TTL || "15m",
  refreshDays: Number(process.env.REFRESH_TOKEN_DAYS || 7),
  cookieSecure: process.env.COOKIE_SECURE === undefined
    ? process.env.NODE_ENV === "production"
    : process.env.COOKIE_SECURE === "true",
  bootstrapEmail: process.env.BOOTSTRAP_SUPERADMIN_EMAIL || "admin",
  bootstrapPassword: process.env.BOOTSTRAP_SUPERADMIN_PASSWORD || "admin@pass123",
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET
};

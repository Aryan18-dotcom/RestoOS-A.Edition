import { connectDatabase } from "../config/db.js";
import { env } from "../config/env.js";
import { User } from "../models/index.js";
import { hashPassword } from "../utils/security.js";

await connectDatabase();
const existing = await User.findOne({ role: "super_admin" });
if (existing) {
  console.log(`Super admin already exists: ${existing.loginId}`);
  process.exit(0);
}
const user = await User.create({
  tenantId: null, loginId: env.bootstrapEmail.toLowerCase(), name: "Platform Super Admin",
  role: "super_admin", passwordHash: await hashPassword(env.bootstrapPassword),
  mustChangePassword: true, isActive: true
});
console.log(`Bootstrap super admin created: ${user.loginId}`);
console.log("Temporary password is the configured BOOTSTRAP_SUPERADMIN_PASSWORD. Change it immediately after first login.");
process.exit(0);

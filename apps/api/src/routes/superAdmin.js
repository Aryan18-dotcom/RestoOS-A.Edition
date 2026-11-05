import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Category, MenuItem, Order, Tenant, User, AuditLog } from "../models/index.js";
import { allowRoles, requireAuth } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { hashPassword, randomSecret } from "../utils/security.js";
import { ioRef } from "../sockets/ioRef.js";

const router = Router();
const userRoles = ["owner", "manager", "cashier", "waiter", "kitchen"];
const accountStatuses = ["ACTIVE", "BLOCKED", "SUSPENDED"];
router.use(requireAuth, allowRoles("super_admin"));

function currentStatus(record) {
  return record.status || (record.isActive === false ? "SUSPENDED" : "ACTIVE");
}

async function createTenantUser(tenantId, input, actorId, session) {
  const base = input.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "staff";
  let loginId;
  do {
    loginId = `${base}${randomSecret(6).toLowerCase()}`;
  } while (await User.exists({ loginId }).session(session));

  const temporaryPassword = randomSecret(12);
  const [user] = await User.create([{
    tenantId, loginId, email: input.email || undefined, name: input.name, role: input.role,
    permissions: input.permissions || [], passwordHash: await hashPassword(temporaryPassword),
    mustChangePassword: true, status: "ACTIVE", isActive: true
  }], { session });
  await AuditLog.create([{
    tenantId, actorId, action: input.role === "owner" ? "RESTAURANT_OWNER_CREATED" : "STAFF_USER_CREATED",
    entityType: "User", entityId: user._id, metadata: { role: user.role }
  }], { session });

  return {
    credentials: { loginId, temporaryPassword, mustChangePassword: true },
    user: { id: user._id, name: user.name, role: user.role, email: user.email, status: user.status }
  };
}

router.get("/status", async (_req, res, next) => {
  try {
    const [restaurantCount, userCount, orderCount, activeRestaurants] = await Promise.all([
      Tenant.countDocuments(),
      User.countDocuments({ tenantId: { $ne: null } }),
      Order.countDocuments(),
      Tenant.countDocuments({ isActive: true, $or: [{ status: "ACTIVE" }, { status: { $exists: false } }] })
    ]);
    res.json({
      api: "OPERATIONAL",
      database: mongoose.connection.readyState === 1 ? "CONNECTED" : "DISCONNECTED",
      nodeEnv: env.nodeEnv,
      uptimeSeconds: Math.floor(process.uptime()),
      counts: { restaurants: restaurantCount, activeRestaurants, users: userCount, orders: orderCount }
    });
  } catch (e) { next(e); }
});

router.get("/restaurants", async (_req, res, next) => {
  try {
    const restaurants = await Tenant.aggregate([
      { $sort: { createdAt: -1 } },
      { $lookup: { from: "users", localField: "_id", foreignField: "tenantId", as: "staff" } },
      {
        $addFields: {
          status: { $ifNull: ["$status", { $cond: [{ $eq: ["$isActive", false] }, "SUSPENDED", "ACTIVE"] }] },
          userCount: { $size: "$staff" },
          ownerCount: { $size: { $filter: { input: "$staff", as: "user", cond: { $eq: ["$$user.role", "owner"] } } } }
        }
      },
      { $project: { staff: 0 } }
    ]);
    res.json({ restaurants });
  } catch (e) { next(e); }
});

router.post("/restaurants", async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const body = z.object({
      name: z.string().trim().min(2).max(120), slug: z.string().trim().min(2).max(60).regex(/^[a-z0-9-]+$/),
      legalName: z.string().optional(), phone: z.string().optional(),
      email: z.union([z.string().email(), z.literal("")]).optional(),
      address: z.string().optional(), timezone: z.string().default("Asia/Kolkata"), gstin: z.string().optional(),
      ownerName: z.string().trim().min(2).max(100),
      ownerEmail: z.union([z.string().email(), z.literal("")]).optional()
    }).parse(req.body);
    const { ownerName, ownerEmail, ...tenantFields } = body;
    let tenant;
    let owner;
    await session.withTransaction(async () => {
      [tenant] = await Tenant.create([{
        ...tenantFields, email: tenantFields.email || undefined,
        status: "ACTIVE", isActive: true
      }], { session });
      owner = await createTenantUser(
        tenant._id,
        { name: ownerName, email: ownerEmail, role: "owner" },
        req.user._id,
        session
      );
      await AuditLog.create([{
        actorId: req.user._id, action: "TENANT_CREATED", entityType: "Tenant",
        entityId: tenant._id, metadata: { name: tenant.name }
      }], { session });
    });
    res.status(201).json({ tenant, owner });
  } catch (e) { next(e); }
  finally { await session.endSession(); }
});

router.get("/restaurants/:tenantId", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.tenantId)) return res.status(404).json({ error: "Restaurant not found" });
    const tenant = await Tenant.findById(req.params.tenantId).lean();
    if (!tenant) return res.status(404).json({ error: "Restaurant not found" });
    const [users, orders, menuItems, categories] = await Promise.all([
      User.find({ tenantId: tenant._id })
        .select("name loginId email role status isActive mustChangePassword lastLoginAt createdAt")
        .sort({ createdAt: -1 }).lean(),
      Order.countDocuments({ tenantId: tenant._id }),
      MenuItem.countDocuments({ tenantId: tenant._id }),
      Category.countDocuments({ tenantId: tenant._id })
    ]);
    const usersByRole = Object.fromEntries(userRoles.map(role => [role, users.filter(user => user.role === role).length]));
    res.json({
      restaurant: { ...tenant, status: currentStatus(tenant) },
      users: users.map(user => ({ ...user, status: currentStatus(user) })),
      stats: { userCount: users.length, usersByRole, orders, menuItems, categories }
    });
  } catch (e) { next(e); }
});

router.patch("/restaurants/:tenantId/status", async (req, res, next) => {
  try {
    const { status } = z.object({ status: z.enum(accountStatuses) }).parse(req.body);
    if (!mongoose.isValidObjectId(req.params.tenantId)) return res.status(404).json({ error: "Restaurant not found" });
    const tenant = await Tenant.findByIdAndUpdate(
      req.params.tenantId, { $set: { status, isActive: status === "ACTIVE" } }, { new: true, runValidators: true }
    );
    if (!tenant) return res.status(404).json({ error: "Restaurant not found" });
    if (status !== "ACTIVE") ioRef()?.in(`tenant:${tenant._id}`).disconnectSockets(true);
    await AuditLog.create({
      actorId: req.user._id, action: `TENANT_${status}`, entityType: "Tenant",
      entityId: tenant._id, metadata: { status }
    });
    res.json({ restaurant: tenant });
  } catch (e) { next(e); }
});

router.post("/restaurants/:tenantId/users", async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().trim().min(2).max(100),
      role: z.enum(userRoles),
      email: z.union([z.string().email(), z.literal("")]).optional(),
      permissions: z.array(z.string()).default([])
    }).parse(req.body);
    if (!mongoose.isValidObjectId(req.params.tenantId)) return res.status(404).json({ error: "Restaurant not found" });
    const tenant = await Tenant.findById(req.params.tenantId);
    if (!tenant) return res.status(404).json({ error: "Restaurant not found" });
    if (currentStatus(tenant) !== "ACTIVE" || tenant.isActive === false) {
      return res.status(409).json({ error: "Cannot add users to an unavailable restaurant" });
    }

    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await createTenantUser(tenant._id, body, req.user._id, session);
      });
      res.status(201).json(result);
    } finally { await session.endSession(); }
  } catch (e) { next(e); }
});

router.patch("/restaurants/:tenantId/users/:userId/status", async (req, res, next) => {
  try {
    const { status } = z.object({ status: z.enum(accountStatuses) }).parse(req.body);
    if (!mongoose.isValidObjectId(req.params.tenantId) || !mongoose.isValidObjectId(req.params.userId)) {
      return res.status(404).json({ error: "User not found" });
    }
    const user = await User.findOneAndUpdate(
      { _id: req.params.userId, tenantId: req.params.tenantId },
      {
        $set: { status, isActive: status === "ACTIVE" },
        ...(status === "ACTIVE" ? {} : { $unset: { refreshTokenHash: 1 } })
      },
      { new: true, runValidators: true }
    ).select("name loginId email role status isActive mustChangePassword lastLoginAt createdAt");
    if (!user) return res.status(404).json({ error: "User not found" });
    if (status !== "ACTIVE") ioRef()?.in(`user:${user._id}`).disconnectSockets(true);
    await AuditLog.create({
      tenantId: req.params.tenantId, actorId: req.user._id,
      action: `STAFF_USER_${status}`, entityType: "User", entityId: user._id, metadata: { status, role: user.role }
    });
    res.json({ user });
  } catch (e) { next(e); }
});

export default router;

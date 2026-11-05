import { Router } from "express";
import { z } from "zod";
import { Category, MenuItem, Tenant, AuditLog } from "../models/index.js";
import { requireAuth, requireTenant, allowRoles } from "../middleware/auth.js";
import { ioRef } from "../sockets/ioRef.js";

const router = Router();
router.get("/admin", requireAuth, requireTenant, allowRoles("owner", "manager"), async (req, res, next) => {
  try {
    const [categories, items] = await Promise.all([
      Category.find({ tenantId: req.tenantId }).sort({ sortOrder: 1 }).lean(),
      MenuItem.find({ tenantId: req.tenantId }).sort({ name: 1 }).lean()
    ]);
    res.json({ categories, items });
  } catch (e) { next(e); }
});

router.get("/", async (req, res, next) => {
  try {
    const tenantId = req.query.tenantId;
    if (!tenantId) return res.status(400).json({ error: "tenantId is required for public menu lookup" });
    const tenant = await Tenant.findOne({
      _id: tenantId, isActive: true,
      $or: [{ status: "ACTIVE" }, { status: { $exists: false } }]
    }).select("_id").lean();
    if (!tenant) return res.status(404).json({ error: "Restaurant not found" });
    const [restaurant, categories, items] = await Promise.all([
      Tenant.findById(tenant._id).select("name slug currency").lean(),
      Category.find({ tenantId: tenant._id, isActive: true }).sort({ sortOrder: 1 }).lean(),
      MenuItem.find({ tenantId: tenant._id, isAvailable: true }).lean()
    ]);
    res.json({ restaurant, categories, items });
  } catch (e) { next(e); }
});
router.post("/categories", requireAuth, requireTenant, allowRoles("owner", "manager"), async (req, res, next) => {
  try {
    const body = z.object({ name: z.string().min(1).max(80), sortOrder: z.number().default(0) }).parse(req.body);
    const category = await Category.create({ ...body, tenantId: req.tenantId });
    res.status(201).json({ category });
  } catch (e) { next(e); }
});
router.post("/items", requireAuth, requireTenant, allowRoles("owner", "manager"), async (req, res, next) => {
  try {
    const body = z.object({
      categoryId: z.string().regex(/^[\da-f]{24}$/i), name: z.string().trim().min(1).max(120), description: z.string().optional(),
      pricePaise: z.number().int().nonnegative(), gstRate: z.number().refine(v => [0,5,12,18,28].includes(v)),
      foodType: z.enum(["VEG", "NON_VEG", "EGG"]).default("VEG"), station: z.string().default("MAIN")
    }).parse(req.body);
    if (!await Category.exists({ _id: body.categoryId, tenantId: req.tenantId })) {
      return res.status(400).json({ error: "Category does not belong to this restaurant." });
    }
    const item = await MenuItem.create({ ...body, tenantId: req.tenantId });
    res.status(201).json({ item });
  } catch (e) { next(e); }
});
router.patch("/items/:id/availability", requireAuth, requireTenant, allowRoles("owner", "manager"), async (req, res, next) => {
  try {
    const body = z.object({ isAvailable: z.boolean() }).parse(req.body);
    const item = await MenuItem.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenantId }, body, { new: true });
    if (!item) return res.status(404).json({ error: "Menu item not found" });
    ioRef()?.to(`tenant:${req.tenantId}`).emit("menu:item_availability", { itemId: String(item._id), isAvailable: item.isAvailable });
    await AuditLog.create({ tenantId: req.tenantId, actorId: req.user._id, action: "MENU_AVAILABILITY_CHANGED", entityType: "MenuItem", entityId: item._id, metadata: body });
    res.json({ item });
  } catch (e) { next(e); }
});

router.patch("/items/:id", requireAuth, requireTenant, allowRoles("owner", "manager"), async (req, res, next) => {
  try {
    const body = z.object({
      categoryId: z.string().regex(/^[\da-f]{24}$/i),
      name: z.string().trim().min(1).max(120),
      description: z.string().max(1000).optional(),
      pricePaise: z.number().int().nonnegative(),
      gstRate: z.number().refine(value => [0, 5, 12, 18, 28].includes(value)),
      foodType: z.enum(["VEG", "NON_VEG", "EGG"]),
      station: z.string().trim().min(1).max(60),
      isAvailable: z.boolean()
    }).parse(req.body);
    const category = await Category.findOne({ _id: body.categoryId, tenantId: req.tenantId });
    if (!category) return res.status(400).json({ error: "Category does not belong to this restaurant." });
    const item = await MenuItem.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId }, body, { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ error: "Menu item not found" });
    res.json({ item });
  } catch (e) { next(e); }
});

router.delete("/items/:id", requireAuth, requireTenant, allowRoles("owner", "manager"), async (req, res, next) => {
  try {
    const item = await MenuItem.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
    if (!item) return res.status(404).json({ error: "Menu item not found" });
    await AuditLog.create({
      tenantId: req.tenantId, actorId: req.user._id,
      action: "MENU_ITEM_DELETED", entityType: "MenuItem", entityId: item._id,
      metadata: { name: item.name }
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete("/categories/:id", requireAuth, requireTenant, allowRoles("owner", "manager"), async (req, res, next) => {
  try {
    const category = await Category.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!category) return res.status(404).json({ error: "Category not found" });
    if (await MenuItem.exists({ categoryId: category._id, tenantId: req.tenantId })) {
      return res.status(409).json({ error: "Move or delete this category's menu items first." });
    }
    await category.deleteOne();
    res.json({ ok: true });
  } catch (e) { next(e); }
});
export default router;

import { Router } from "express";
import { z } from "zod";
import { Order, Kot, AuditLog } from "../models/index.js";
import { requireAuth, requireTenant, allowRoles } from "../middleware/auth.js";
import { ioRef } from "../sockets/ioRef.js";

const router = Router();
router.use(requireAuth, requireTenant);
router.get("/orders", allowRoles("owner", "manager", "kitchen"), async (req, res, next) => {
  try {
    const orders = await Order.find({ tenantId: req.tenantId, paymentStatus: "PAID", orderStatus: { $in: ["CONFIRMED", "PREPARING", "READY"] } }).sort({ confirmedAt: 1 }).lean();
    res.json({ orders });
  } catch (e) { next(e); }
});
router.patch("/items/:itemId", allowRoles("kitchen"), async (req, res, next) => {
  try {
    const body = z.object({ status: z.enum(["ACCEPTED", "PREPARING", "READY", "SERVED"]) }).parse(req.body);
    const order = await Order.findOne({ tenantId: req.tenantId, "items._id": req.params.itemId });
    if (!order) return res.status(404).json({ error: "Order item not found" });
    const item = order.items.id(req.params.itemId);
    if (item.status === "CANCELLED") return res.status(409).json({ error: "Cancelled item cannot be updated" });
    item.status = body.status;
    if (body.status === "PREPARING" && !item.startedAt) item.startedAt = new Date();
    if (body.status === "READY") item.readyAt = new Date();
    if (body.status === "SERVED") item.servedAt = new Date();
    const active = order.items.filter(i => i.status !== "CANCELLED");
    if (active.length && active.every(i => i.status === "SERVED")) order.orderStatus = "SERVED";
    else if (active.length && active.every(i => ["READY", "SERVED"].includes(i.status))) order.orderStatus = "READY";
    else if (active.some(i => ["PREPARING", "READY", "SERVED"].includes(i.status))) order.orderStatus = "PREPARING";
    await order.save();
    const event = { orderId: String(order._id), itemId: String(item._id), itemStatus: item.status, orderStatus: order.orderStatus };
    ioRef()?.to(`tenant:${req.tenantId}`).emit("order:status_update", event);
    await AuditLog.create({ tenantId: req.tenantId, actorId: req.user._id, action: "KITCHEN_ITEM_STATUS", entityType: "Order", entityId: order._id, metadata: event });
    res.json({ order });
  } catch (e) { next(e); }
});
router.post("/orders/:orderId/bump", allowRoles("kitchen"), async (req, res, next) => {
  try {
    const order = await Order.findOne({ _id: req.params.orderId, tenantId: req.tenantId, paymentStatus: "PAID" });
    if (!order) return res.status(404).json({ error: "Order not found" });
    const active = order.items.filter(i => i.status !== "CANCELLED");
    if (!active.length || !active.every(i => ["READY", "SERVED"].includes(i.status))) return res.status(409).json({ error: "All active dishes must be ready before bumping the order" });
    order.orderStatus = "READY";
    await order.save();
    const data = { orderId: String(order._id), tokenNumber: order.tokenNumber, orderStatus: "READY" };
    ioRef()?.to(`tenant:${req.tenantId}`).emit("order:ready", data);
    res.json({ ok: true, order });
  } catch (e) { next(e); }
});
export default router;

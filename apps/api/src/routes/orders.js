import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { Bill, Category, CustomerSession, Kot, MenuItem, Order, Payment, Tenant, User } from "../models/index.js";
import { createPendingCustomerOrder } from "../services/orderService.js";
import { allocateDailyToken, businessDateFor } from "../services/tokenService.js";
import { requireAuth, requireTenant, allowRoles } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { ioRef } from "../sockets/ioRef.js";

const router = Router();
const customerSessionCookie = "restaurantCustomerSession";
const customerSessionMaxAge = 7 * 60 * 60 * 1000;
const staffRoles = ["owner", "manager", "cashier"];

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createOrderItems(menu, lines) {
  const byId = new Map(menu.map(item => [String(item._id), item]));
  return lines.map(line => {
    const item = byId.get(String(line.menuItemId));
    if (!item) throw Object.assign(new Error("One or more menu items are unavailable"), { status: 409 });
    const quantity = Math.min(30, Math.max(1, Number(line.quantity)));
    const totalPaise = item.pricePaise * quantity;
    return {
      menuItemId: item._id, name: item.name, quantity, unitPricePaise: item.pricePaise,
      totalPaise, gstRate: item.gstRate, station: item.station, modifiers: line.modifiers || []
    };
  });
}

function orderTotals(items) {
  const subtotalPaise = items.reduce((sum, item) => sum + item.totalPaise, 0);
  const taxPaise = items.reduce((sum, item) => sum + Math.round(item.totalPaise * item.gstRate / 100), 0);
  return { subtotalPaise, taxPaise, totalPaise: subtotalPaise + taxPaise };
}

async function getCustomerSession(req, tenantId) {
  const token = req.cookies?.[customerSessionCookie];
  if (!token) return null;
  return CustomerSession.findOne({ tenantId, tokenHash: hashToken(token), expiresAt: { $gt: new Date() } });
}

router.post("/customer-session", async (req, res, next) => {
  try {
    const body = z.object({
      tenantId: z.string().regex(/^[\da-f]{24}$/i),
      name: z.string().trim().min(2).max(100),
      phone: z.string().trim().regex(/^\+?[\d\s()-]{10,18}$/)
    }).parse(req.body);
    const tenant = await Tenant.findOne({
      _id: body.tenantId, isActive: true,
      $or: [{ status: "ACTIVE" }, { status: { $exists: false } }]
    }).select("_id").lean();
    if (!tenant) return res.status(404).json({ error: "Restaurant not found" });
    const token = crypto.randomBytes(32).toString("base64url");
    const session = await CustomerSession.create({
      tenantId: tenant._id, name: body.name, phone: body.phone.trim(),
      tokenHash: hashToken(token), expiresAt: new Date(Date.now() + customerSessionMaxAge)
    });
    res.cookie(customerSessionCookie, token, {
      httpOnly: true, secure: env.cookieSecure, sameSite: "lax", path: "/", maxAge: customerSessionMaxAge
    });
    res.status(201).json({ customer: { name: session.name, phone: session.phone }, expiresAt: session.expiresAt });
  } catch (e) { next(e); }
});

router.get("/customer-session", async (req, res, next) => {
  try {
    const tenantId = req.query.tenantId;
    if (typeof tenantId !== "string" || !mongoose.isValidObjectId(tenantId)) {
      return res.status(400).json({ error: "A valid tenantId is required" });
    }
    const session = await getCustomerSession(req, tenantId);
    if (!session) return res.json({ customer: null });
    res.json({ customer: { name: session.name, phone: session.phone }, expiresAt: session.expiresAt });
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    const body = z.object({
      restaurantSlug: z.string(), orderType: z.enum(["DINE_IN", "TAKEAWAY", "PICKUP"]).default("TAKEAWAY"),
      zone: z.string().max(100).optional(),
      items: z.array(z.object({
        menuItemId: z.string().regex(/^[\da-f]{24}$/i),
        quantity: z.number().int().min(1).max(30), modifiers: z.array(z.any()).optional()
      })).min(1)
    }).parse(req.body);
    const tenant = await Tenant.findOne({
      slug: body.restaurantSlug, isActive: true,
      $or: [{ status: "ACTIVE" }, { status: { $exists: false } }]
    }).select("_id").lean();
    if (!tenant) return res.status(404).json({ error: "Restaurant not found" });
    const session = await getCustomerSession(req, tenant._id);
    if (!session) return res.status(401).json({ error: "Enter your name and phone number to continue." });
    const result = await createPendingCustomerOrder({
      ...body,
      customer: { name: session.name, phone: session.phone },
      customerSessionId: session._id
    });
    ioRef()?.to(`billing:${result.tenant._id}`).emit("order:created", { orderId: result.order._id, status: result.order.orderStatus });
    res.status(201).json({
      order: { id: result.order._id, totalPaise: result.order.totalPaise, paymentStatus: result.order.paymentStatus },
      trackingToken: result.trackingToken
    });
  } catch (e) { next(e); }
});

router.get("/customer-session/orders", async (req, res, next) => {
  try {
    const tenantId = req.query.tenantId;
    if (typeof tenantId !== "string" || !mongoose.isValidObjectId(tenantId)) {
      return res.status(400).json({ error: "A valid tenantId is required" });
    }
    const session = await getCustomerSession(req, tenantId);
    if (!session) return res.status(401).json({ error: "Customer session expired" });
    const orders = await Order.find({ tenantId, customerSessionId: session._id })
      .select("orderNumber tokenNumber orderStatus paymentStatus items totalPaise paymentMethod createdAt")
      .sort({ createdAt: -1 }).lean();
    res.json({ orders });
  } catch (e) { next(e); }
});

router.get("/analytics", requireAuth, requireTenant, allowRoles(...staffRoles), async (req, res, next) => {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [today, statusCounts, topItems, users, menuItems, categories] = await Promise.all([
      Order.aggregate([
        { $match: { tenantId: req.tenantId, createdAt: { $gte: start } } },
        { $group: {
          _id: null, orders: { $sum: 1 },
          paidOrders: { $sum: { $cond: [{ $eq: ["$paymentStatus", "PAID"] }, 1, 0] } },
          salesPaise: { $sum: { $cond: [{ $eq: ["$paymentStatus", "PAID"] }, "$totalPaise", 0] } },
          outstandingPaise: { $sum: { $cond: [{ $eq: ["$paymentStatus", "PENDING"] }, "$totalPaise", 0] } }
        } }
      ]),
      Order.aggregate([
        { $match: { tenantId: req.tenantId } },
        { $group: { _id: "$orderStatus", count: { $sum: 1 } } }
      ]),
      Order.aggregate([
        { $match: { tenantId: req.tenantId, paymentStatus: "PAID" } },
        { $unwind: "$items" },
        { $group: { _id: "$items.name", quantity: { $sum: "$items.quantity" }, salesPaise: { $sum: "$items.totalPaise" } } },
        { $sort: { quantity: -1 } }, { $limit: 5 }
      ]),
      User.countDocuments({ tenantId: req.tenantId }),
      MenuItem.countDocuments({ tenantId: req.tenantId }),
      Category.countDocuments({ tenantId: req.tenantId })
    ]);
    res.json({
      today: today[0] || { orders: 0, paidOrders: 0, salesPaise: 0, outstandingPaise: 0 },
      statusCounts: Object.fromEntries(statusCounts.map(item => [item._id, item.count])),
      topItems, users, menuItems, categories
    });
  } catch (e) { next(e); }
});

router.get("/operations", requireAuth, requireTenant, allowRoles(...staffRoles), async (req, res, next) => {
  try {
    const orders = await Order.find({ tenantId: req.tenantId })
      .select("orderNumber tokenNumber customer orderType source items subtotalPaise taxPaise totalPaise paymentStatus paymentMethod orderStatus customerSessionId createdAt confirmedAt")
      .sort({ createdAt: -1 }).limit(100).lean();
    const kots = orders.length ? await Kot.find({ tenantId: req.tenantId, orderId: { $in: orders.map(order => order._id) } }).lean() : [];
    const kotsByOrder = new Map();
    for (const kot of kots) {
      const key = String(kot.orderId);
      if (!kotsByOrder.has(key)) kotsByOrder.set(key, []);
      kotsByOrder.get(key).push(kot);
    }
    res.json({ orders: orders.map(order => ({ ...order, kots: kotsByOrder.get(String(order._id)) || [] })) });
  } catch (e) { next(e); }
});

router.get("/bills", requireAuth, requireTenant, allowRoles(...staffRoles), async (req, res, next) => {
  try {
    const bills = await Bill.find({ tenantId: req.tenantId }).sort({ generatedAt: -1 }).limit(50).lean();
    res.json({ bills });
  } catch (e) { next(e); }
});

router.post("/bills", requireAuth, requireTenant, allowRoles(...staffRoles), async (req, res, next) => {
  try {
    const body = z.object({ orderIds: z.array(z.string().regex(/^[\da-f]{24}$/i)).min(1).max(50) }).parse(req.body);
    const orderIds = [...new Set(body.orderIds)];
    if (orderIds.length !== body.orderIds.length) return res.status(400).json({ error: "Duplicate orders were selected." });
    const orders = await Order.find({ _id: { $in: orderIds }, tenantId: req.tenantId }).sort({ createdAt: 1 }).lean();
    if (orders.length !== orderIds.length) return res.status(404).json({ error: "One or more orders were not found." });
    const hasPendingOrder = orders.some(order => order.paymentStatus !== "PAID");
    if (hasPendingOrder && (orders.length !== 1 || orders[0].source !== "COUNTER" || orders[0].paymentStatus !== "PENDING")) {
      return res.status(409).json({ error: "Only paid customer orders can be merged. An unpaid bill must be one counter order." });
    }
    const sessionIds = new Set(orders.map(order => String(order.customerSessionId || "")));
    if (sessionIds.size !== 1 || !orders[0].customerSessionId) {
      if (orders.length > 1 || orders.some(order => order.customerSessionId)) {
        return res.status(400).json({ error: "Orders must belong to the same customer session to be merged." });
      }
    }
    if (await Bill.exists({ tenantId: req.tenantId, orderIds: { $in: orderIds } })) {
      return res.status(409).json({ error: "One or more selected orders have already been billed." });
    }
    const items = orders.flatMap(order => order.items);
    const totals = orderTotals(items);
    const bill = await Bill.create({
      tenantId: req.tenantId, customerSessionId: orders[0].customerSessionId,
      invoiceNumber: `B-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      orderIds: orders.map(order => order._id), customer: orders[0].customer, items,
      paymentMethods: [...new Set(orders.map(order => order.paymentMethod).filter(Boolean))],
      ...totals, paymentStatus: hasPendingOrder ? "PENDING" : "PAID", createdBy: req.user._id
    });
    res.status(201).json({ bill });
  } catch (e) { next(e); }
});

router.patch("/bills/:id/items", requireAuth, requireTenant, allowRoles("owner", "manager", "cashier"), async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const body = z.object({
      items: z.array(z.object({
        menuItemId: z.string().regex(/^[\da-f]{24}$/i), quantity: z.number().int().min(1).max(30)
      })).min(1).max(100)
    }).parse(req.body);
    let bill;
    await session.withTransaction(async () => {
      bill = await Bill.findOne({
        _id: req.params.id, tenantId: req.tenantId, paymentStatus: "PENDING"
      }).session(session);
      if (!bill || bill.orderIds.length !== 1) {
        throw Object.assign(new Error("Editable unpaid counter bill not found."), { status: 404 });
      }
      const order = await Order.findOne({
        _id: bill.orderIds[0], tenantId: req.tenantId, source: "COUNTER",
        paymentStatus: "PENDING", orderStatus: "PENDING_PAYMENT"
      }).session(session);
      if (!order) throw Object.assign(new Error("This bill is no longer editable."), { status: 409 });
      if (await Payment.exists({ orderId: order._id, status: { $in: ["CREATED", "AUTHORIZED"] } }).session(session)) {
        throw Object.assign(new Error("This order has an active payment and cannot be edited."), { status: 409 });
      }
      const ids = [...new Set(body.items.map(item => item.menuItemId))];
      const menu = await MenuItem.find({
        _id: { $in: ids }, tenantId: req.tenantId, isAvailable: true
      }).session(session).lean();
      if (menu.length !== ids.length) {
        throw Object.assign(new Error("One or more menu items are unavailable."), { status: 409 });
      }
      order.items = createOrderItems(menu, body.items);
      Object.assign(order, orderTotals(order.items));
      await order.save({ session });
      Object.assign(bill, orderTotals(order.items), { items: order.items, customer: order.customer });
      await bill.save({ session });
    });
    res.json({ bill });
  } catch (e) { next(e); }
  finally { await session.endSession(); }
});

router.patch("/:id/items", requireAuth, requireTenant, allowRoles("owner", "manager", "cashier"), async (req, res, next) => {
  try {
    const body = z.object({
      items: z.array(z.object({
        menuItemId: z.string().regex(/^[\da-f]{24}$/i), quantity: z.number().int().min(1).max(30)
      })).min(1).max(100)
    }).parse(req.body);
    const order = await Order.findOne({
      _id: req.params.id, tenantId: req.tenantId, source: "COUNTER",
      paymentStatus: "PENDING", orderStatus: "PENDING_PAYMENT"
    });
    if (!order) return res.status(404).json({ error: "Editable unpaid order not found." });
    if (await Payment.exists({ orderId: order._id, status: { $in: ["CREATED", "AUTHORIZED"] } })) {
      return res.status(409).json({ error: "This order already has an active payment. It cannot be edited." });
    }
    if (await Bill.exists({ tenantId: req.tenantId, orderIds: order._id })) {
      return res.status(409).json({ error: "This order already has a bill. Recreate the bill after cancelling it to make changes." });
    }
    const ids = [...new Set(body.items.map(item => item.menuItemId))];
    const menu = await MenuItem.find({ _id: { $in: ids }, tenantId: req.tenantId, isAvailable: true }).lean();
    if (menu.length !== ids.length) return res.status(409).json({ error: "One or more menu items are unavailable." });
    order.items = createOrderItems(menu, body.items);
    Object.assign(order, orderTotals(order.items));
    await order.save();
    res.json({ order });
  } catch (e) { next(e); }
});

router.post("/manual", requireAuth, requireTenant, allowRoles("owner", "manager", "waiter", "cashier"), async (req, res, next) => {
  try {
    const body = z.object({
      customerName: z.string().trim().min(2).max(100).optional(),
      customerPhone: z.string().trim().max(20).optional(),
      orderType: z.enum(["DINE_IN", "TAKEAWAY", "PICKUP", "WALK_IN"]).default("TAKEAWAY"),
      items: z.array(z.object({ menuItemId: z.string().regex(/^[\da-f]{24}$/i), quantity: z.number().int().min(1).max(30) })).min(1)
    }).parse(req.body);
    const tenant = await Tenant.findById(req.tenantId).select("timezone status isActive").lean();
    if (!tenant || tenant.isActive === false || (tenant.status && tenant.status !== "ACTIVE")) {
      return res.status(409).json({ error: "Restaurant is unavailable." });
    }
    const ids = [...new Set(body.items.map(item => item.menuItemId))];
    const menu = await MenuItem.find({ _id: { $in: ids }, tenantId: req.tenantId, isAvailable: true }).lean();
    if (menu.length !== ids.length) return res.status(409).json({ error: "One or more menu items are unavailable." });
    const items = createOrderItems(menu, body.items);
    const order = await Order.create({
      tenantId: req.tenantId, orderNumber: `R-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      businessDate: businessDateFor(tenant.timezone), customer: { name: body.customerName, phone: body.customerPhone },
      orderType: body.orderType, source: "COUNTER", createdBy: req.user._id,
      paymentStatus: "PENDING", orderStatus: "PENDING_PAYMENT", items, ...orderTotals(items)
    });
    ioRef()?.to(`billing:${req.tenantId}`).emit("order:created", { orderId: order._id, status: order.orderStatus });
    res.status(201).json({ order });
  } catch (e) { next(e); }
});

router.post("/:id/settle", requireAuth, requireTenant, allowRoles("owner", "manager", "cashier"), async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const { method } = z.object({ method: z.enum(["CASH", "UPI", "CARD"]) }).parse(req.body);
    let order;
    let payment;
    await session.withTransaction(async () => {
      order = await Order.findOne({
        _id: req.params.id, tenantId: req.tenantId, source: "COUNTER",
        paymentStatus: "PENDING", orderStatus: "PENDING_PAYMENT"
      }).session(session);
      if (!order) throw Object.assign(new Error("Unpaid order not found."), { status: 404 });
      const tenant = await Tenant.findById(order.tenantId).session(session).lean();
      if (!tenant || tenant.isActive === false || (tenant.status && tenant.status !== "ACTIVE")) {
        throw Object.assign(new Error("Restaurant is unavailable."), { status: 409 });
      }
      const [createdPayment] = await Payment.create([{
        tenantId: order.tenantId, orderId: order._id, provider: method, status: "CAPTURED",
        amountPaise: order.totalPaise, idempotencyKey: `pos:${order._id}`,
        capturedAt: new Date(), rawEvent: { source: "POS_MANUAL_SETTLEMENT", actorId: String(req.user._id) }
      }], { session });
      payment = createdPayment;
      const tokenNumber = await allocateDailyToken(order.tenantId, businessDateFor(tenant.timezone), session);
      order.paymentStatus = "PAID";
      order.orderStatus = "CONFIRMED";
      order.tokenNumber = tokenNumber;
      order.confirmedAt = new Date();
      order.paymentMethod = method;
      await order.save({ session });
      const groupedItems = new Map();
      for (const item of order.items) {
        const station = item.station || "MAIN";
        if (!groupedItems.has(station)) groupedItems.set(station, []);
        groupedItems.get(station).push(item._id);
      }
      for (const [station, itemIds] of groupedItems) {
        await Kot.create([{ tenantId: order.tenantId, orderId: order._id, station, itemIds }], { session });
      }
      await Bill.updateMany(
        { tenantId: req.tenantId, orderIds: order._id, paymentStatus: "PENDING" },
        { $set: { paymentStatus: "PAID", paymentMethods: [method] } },
        { session }
      );
    });
    ioRef()?.to(`kitchen:${order.tenantId}`).emit("payment:verified", { orderId: String(order._id), tokenNumber: order.tokenNumber, orderStatus: order.orderStatus });
    ioRef()?.to(`billing:${order.tenantId}`).emit("payment:verified", { orderId: String(order._id), tokenNumber: order.tokenNumber, orderStatus: order.orderStatus });
    res.json({ order, payment });
  } catch (e) { next(e); }
  finally { await session.endSession(); }
});

router.get("/track/:trackingToken", async (req, res, next) => {
  try {
    const order = await Order.findOne({ trackingTokenHash: hashToken(req.params.trackingToken) })
      .select("tokenNumber orderStatus paymentStatus items customer.name orderType zone createdAt confirmedAt")
      .lean();
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json({ order });
  } catch (e) { next(e); }
});

router.get("/:id", requireAuth, requireTenant, allowRoles(...staffRoles, "waiter"), async (req, res, next) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, tenantId: req.tenantId }).lean();
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json({ order });
  } catch (e) { next(e); }
});

export default router;

import mongoose from "mongoose";
import crypto from "node:crypto";
import { Category, MenuItem, Order, Kot, Tenant } from "../models/index.js";
import { allocateDailyToken, businessDateFor } from "./tokenService.js";

export async function createPendingCustomerOrder(input) {
  const tenant = await Tenant.findOne({
    slug: input.restaurantSlug, isActive: true,
    $or: [{ status: "ACTIVE" }, { status: { $exists: false } }]
  }).lean();
  if (!tenant) throw Object.assign(new Error("Restaurant not found"), { status: 404 });
  const ids = [...new Set(input.items.map(i => i.menuItemId))];
  const menu = await MenuItem.find({ _id: { $in: ids }, tenantId: tenant._id, isAvailable: true }).lean();
  if (menu.length !== ids.length) throw Object.assign(new Error("One or more menu items are unavailable"), { status: 409 });
  const byId = new Map(menu.map(m => [String(m._id), m]));
  let subtotal = 0, tax = 0;
  const items = input.items.map(line => {
    const item = byId.get(String(line.menuItemId));
    const qty = Math.max(1, Math.min(30, Number(line.quantity)));
    const total = item.pricePaise * qty;
    subtotal += total;
    tax += Math.round(total * item.gstRate / 100);
    return { menuItemId: item._id, name: item.name, quantity: qty, unitPricePaise: item.pricePaise, totalPaise: total, gstRate: item.gstRate, station: item.station, modifiers: line.modifiers || [] };
  });
  const trackingToken = crypto.randomBytes(32).toString("base64url");
  const businessDate = businessDateFor(tenant.timezone);
  const order = await Order.create({
    tenantId: tenant._id, orderNumber: `R-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
    businessDate, trackingTokenHash: crypto.createHash("sha256").update(trackingToken).digest("hex"),
    customer: input.customer, customerSessionId: input.customerSessionId || null,
    orderType: input.orderType || "PICKUP", zone: input.zone,
    source: "CUSTOMER", paymentStatus: "PENDING", orderStatus: "PENDING_PAYMENT",
    items, subtotalPaise: subtotal, taxPaise: tax, totalPaise: subtotal + tax
  });
  return { order, trackingToken, tenant };
}

export async function confirmPaidOrder(orderId, paymentId, paymentMethod = "RAZORPAY") {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: orderId, paymentStatus: "PENDING", orderStatus: "PENDING_PAYMENT" }).session(session);
      if (!order) {
        const existing = await Order.findById(orderId).session(session);
        if (existing?.paymentStatus === "PAID") { result = existing; return; }
        throw new Error("Order is not eligible for confirmation");
      }
      const tenant = await Tenant.findById(order.tenantId).session(session).lean();
      const token = await allocateDailyToken(order.tenantId, businessDateFor(tenant.timezone), session);
      order.paymentStatus = "PAID";
      order.orderStatus = "CONFIRMED";
      order.tokenNumber = token;
      order.confirmedAt = new Date();
      order.paymentMethod = paymentMethod;
      await order.save({ session });
      const grouped = new Map();
      for (const item of order.items) {
        const station = item.station || "MAIN";
        if (!grouped.has(station)) grouped.set(station, []);
        grouped.get(station).push(item._id);
      }
      for (const [station, itemIds] of grouped) {
        await Kot.create([{ tenantId: order.tenantId, orderId: order._id, station, itemIds }], { session });
      }
      result = order;
    });
  } finally { await session.endSession(); }
  return result;
}

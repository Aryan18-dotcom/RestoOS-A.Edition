import { Router } from "express";
import crypto from "node:crypto";
import Razorpay from "razorpay";
import { env } from "../config/env.js";
import { Order, Payment, WebhookEvent } from "../models/index.js";
import { confirmPaidOrder } from "../services/orderService.js";
import { ioRef } from "../sockets/ioRef.js";
import { safeEqualHex } from "../utils/security.js";

const router = Router();

function emitPaymentVerified(order) {
  if (!order) return;
  const data = { orderId: String(order._id), tokenNumber: order.tokenNumber, orderStatus: order.orderStatus };
  const io = ioRef();
  io?.to(`kitchen:${order.tenantId}`).emit("payment:verified", data);
  io?.to(`billing:${order.tenantId}`).emit("payment:verified", data);
  io?.to(`waiters:${order.tenantId}`).emit("payment:verified", data);
  io?.to(`order:${order._id}`).emit("payment:verified", data);
}

async function confirmRazorpayCapture(payment, paymentEntity, eventId) {
  if (!payment) throw new Error("Payment record not found");
  if (Number(paymentEntity?.amount) !== payment.amountPaise) throw new Error("Payment amount mismatch");
  if (paymentEntity?.status !== "captured" && paymentEntity?.captured !== true) throw new Error("Payment is not captured");
  if (!paymentEntity?.id) throw new Error("Razorpay payment ID is missing");

  if (payment.status !== "CAPTURED") {
    payment.status = "CAPTURED";
    payment.razorpayPaymentId = paymentEntity.id;
    payment.providerReference = paymentEntity.order_id;
    payment.razorpayOrderId = paymentEntity.order_id || payment.razorpayOrderId;
    payment.capturedAt = new Date();
    payment.rawEvent = eventId ? { eventId } : { source: "RAZORPAY_API" };
    await payment.save();
  }

  const order = await confirmPaidOrder(payment.orderId, paymentEntity.id);
  emitPaymentVerified(order);
}

router.post("/:orderId/checkout", async (req, res, next) => {
  try {
    if (!env.razorpayKeyId || !env.razorpayKeySecret) {
      return res.status(503).json({ error: "Online payments are not configured" });
    }
    const trackingToken = req.body?.trackingToken;
    if (typeof trackingToken !== "string" || !/^[\da-f]{24}$/i.test(req.params.orderId)) {
      return res.status(404).json({ error: "Order not found" });
    }
    const trackingTokenHash = crypto.createHash("sha256").update(trackingToken).digest("hex");
    const order = await Order.findOne({
      _id: req.params.orderId, trackingTokenHash, paymentStatus: "PENDING", orderStatus: "PENDING_PAYMENT"
    });
    if (!order) return res.status(404).json({ error: "Pending order not found" });
    if (!Number.isSafeInteger(order.totalPaise) || order.totalPaise <= 0) {
      return res.status(400).json({ error: "Order total must be greater than zero to accept payment" });
    }

    const razorpay = new Razorpay({ key_id: env.razorpayKeyId, key_secret: env.razorpayKeySecret });
    let payment = await Payment.findOne({
      orderId: order._id, provider: "RAZORPAY", status: "CREATED", razorpayOrderId: { $exists: true }
    });
    let razorpayOrder;
    if (payment) {
      razorpayOrder = {
        id: payment.razorpayOrderId,
        amount: payment.amountPaise,
        currency: payment.currency
      };
    } else {
      try {
        razorpayOrder = await razorpay.orders.create({
          amount: order.totalPaise,
          currency: "INR",
          receipt: String(order.orderNumber).slice(0, 40),
          notes: { restaurantOrderId: String(order._id), tenantId: String(order.tenantId) }
        });
      } catch (error) {
        const detail = error?.error?.description || error?.description || error?.message;
        throw Object.assign(new Error(`Razorpay could not create the payment order: ${detail || "Check the API credentials and account payment settings."}`), { status: 502 });
      }
      payment = await Payment.create({
        tenantId: order.tenantId,
        orderId: order._id,
        provider: "RAZORPAY",
        amountPaise: order.totalPaise,
        razorpayOrderId: razorpayOrder.id,
        providerReference: razorpayOrder.id,
        idempotencyKey: `checkout:${order._id}`
      });
    }
    res.json({
      keyId: env.razorpayKeyId,
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      name: "RestaurantOS",
      description: `Order ${order.orderNumber}`
    });
  } catch (e) { next(e); }
});

router.post("/:orderId/verify", async (req, res, next) => {
  try {
    const { trackingToken, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (typeof trackingToken !== "string" ||
        typeof razorpay_order_id !== "string" ||
        typeof razorpay_payment_id !== "string" ||
        typeof razorpay_signature !== "string" ||
        !/^[\da-f]{24}$/i.test(req.params.orderId)) {
      return res.status(400).json({ error: "Payment verification details are invalid" });
    }
    const trackingTokenHash = crypto.createHash("sha256").update(trackingToken).digest("hex");
    const order = await Order.findOne({ _id: req.params.orderId, trackingTokenHash });
    if (!order) return res.status(404).json({ error: "Order not found" });
    const payment = await Payment.findOne({
      orderId: order._id, provider: "RAZORPAY", razorpayOrderId: razorpay_order_id
    });
    if (!payment) return res.status(404).json({ error: "Payment attempt not found" });

    const expectedSignature = crypto.createHmac("sha256", env.razorpayKeySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
    if (!safeEqualHex(razorpay_signature, expectedSignature)) {
      return res.status(400).json({ error: "Razorpay payment signature is invalid" });
    }

    if (env.nodeEnv === "development") {
      const razorpay = new Razorpay({ key_id: env.razorpayKeyId, key_secret: env.razorpayKeySecret });
      const paymentEntity = await razorpay.payments.fetch(razorpay_payment_id);
      if (paymentEntity.order_id !== razorpay_order_id || Number(paymentEntity.amount) !== payment.amountPaise) {
        return res.status(400).json({ error: "Razorpay payment details do not match this order" });
      }
      if (paymentEntity.status === "captured" || paymentEntity.captured === true) {
        await confirmRazorpayCapture(payment, paymentEntity);
      }
    }

    const currentOrder = await Order.findById(order._id).select("paymentStatus orderStatus tokenNumber").lean();
    return res.json({
      paymentStatus: currentOrder.paymentStatus,
      orderStatus: currentOrder.orderStatus,
      tokenNumber: currentOrder.tokenNumber
    });
  } catch (e) { next(e); }
});

router.post("/:orderId/qr", async (req, res, next) => {
  try {
    if (!env.razorpayKeyId || !env.razorpayKeySecret) return res.status(503).json({ error: "Online payments are not configured" });
    const trackingToken = req.body?.trackingToken;
    if (typeof trackingToken !== "string" || !/^[\da-f]{24}$/i.test(req.params.orderId)) {
      return res.status(404).json({ error: "Order not found" });
    }
    const trackingTokenHash = crypto.createHash("sha256").update(trackingToken).digest("hex");
    const order = await Order.findOne({
      _id: req.params.orderId, trackingTokenHash, paymentStatus: "PENDING", orderStatus: "PENDING_PAYMENT"
    });
    if (!order) return res.status(404).json({ error: "Pending order not found" });
    const existing = await Payment.findOne({ orderId: order._id, status: "CREATED" });
    const razorpay = new Razorpay({ key_id: env.razorpayKeyId, key_secret: env.razorpayKeySecret });
    if (existing?.qrCodeId) {
      const qr = await razorpay.qrCode.fetch(existing.qrCodeId);
      return res.json({ qrCodeId: qr.id, imageUrl: qr.image_url, keyId: env.razorpayKeyId, expiresAt: qr.close_by });
    }
    const qr = await razorpay.qrCode.create({
      type: "upi_qr", name: `Order ${order.orderNumber}`, usage: "single_use",
      fixed_amount: true, payment_amount: order.totalPaise, description: `RestaurantOS ${order.orderNumber}`,
      close_by: Math.floor(Date.now() / 1000) + 20 * 60,
      notes: { orderId: String(order._id), tenantId: String(order.tenantId) }
    });
    await Payment.create({
      tenantId: order.tenantId, orderId: order._id, provider: "RAZORPAY", amountPaise: order.totalPaise,
      qrCodeId: qr.id, idempotencyKey: `qr:${order._id}`
    });
    res.json({ qrCodeId: qr.id, imageUrl: qr.image_url, keyId: env.razorpayKeyId, expiresAt: qr.close_by });
  } catch (e) { next(e); }
});

router.post("/:orderId/status", async (req, res, next) => {
  try {
    if (env.nodeEnv !== "development") return res.status(404).json({ error: "Payment API polling is only available in development" });
    if (!env.razorpayKeyId || !env.razorpayKeySecret) return res.status(503).json({ error: "Online payments are not configured" });
    const trackingToken = req.body?.trackingToken;
    if (typeof trackingToken !== "string" || !/^[\da-f]{24}$/i.test(req.params.orderId)) {
      return res.status(404).json({ error: "Order not found" });
    }

    const trackingTokenHash = crypto.createHash("sha256").update(trackingToken).digest("hex");
    const order = await Order.findOne({ _id: req.params.orderId, trackingTokenHash });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.paymentStatus !== "PAID") {
      const payment = await Payment.findOne({ orderId: order._id, provider: "RAZORPAY" });
      if (!payment) return res.json({ paymentStatus: order.paymentStatus, orderStatus: order.orderStatus });
      if (payment.status === "CAPTURED") {
        await confirmRazorpayCapture(payment, {
          id: payment.razorpayPaymentId,
          amount: payment.amountPaise,
          order_id: payment.providerReference,
          status: "captured"
        });
      } else if (payment.qrCodeId) {
        const razorpay = new Razorpay({ key_id: env.razorpayKeyId, key_secret: env.razorpayKeySecret });
        const result = await razorpay.qrCode.fetchAllPayments(payment.qrCodeId, { count: 10 });
        const capturedPayment = result.items.find(item => item.status === "captured" || item.captured);
        if (capturedPayment) await confirmRazorpayCapture(payment, capturedPayment);
      } else if (payment.razorpayOrderId) {
        const razorpay = new Razorpay({ key_id: env.razorpayKeyId, key_secret: env.razorpayKeySecret });
        const result = await razorpay.orders.fetchPayments(payment.razorpayOrderId);
        const capturedPayment = result.items.find(item => item.status === "captured" || item.captured);
        if (capturedPayment) await confirmRazorpayCapture(payment, capturedPayment);
      }
    }

    const currentOrder = await Order.findById(order._id).select("paymentStatus orderStatus").lean();
    return res.json({ paymentStatus: currentOrder.paymentStatus, orderStatus: currentOrder.orderStatus });
  } catch (e) { next(e); }
});

export default router;

export async function razorpayWebhook(req, res) {
  if (env.nodeEnv === "development") return res.status(404).send("Webhook processing is disabled in development");
  const signature = req.headers["x-razorpay-signature"];
  if (!env.razorpayWebhookSecret || !signature) return res.status(400).send("Webhook signature configuration missing");
  const expected = crypto.createHmac("sha256", env.razorpayWebhookSecret).update(req.body).digest("hex");
  if (!safeEqualHex(signature, expected)) return res.status(400).send("Invalid signature");
  const payload = JSON.parse(req.body.toString("utf8"));
  const eventId = req.headers["x-razorpay-event-id"] || crypto.createHash("sha256").update(req.body).digest("hex");
  try {
    await WebhookEvent.create({ provider: "RAZORPAY", eventId, eventType: payload.event, payload, status: "RECEIVED" });
  } catch (e) {
    if (e.code === 11000) return res.status(200).send("Duplicate event");
    return res.status(500).send("Could not persist webhook");
  }
  try {
    if (payload.event === "qr_code.credited") {
      const qrEntity = payload.payload?.qr_code?.entity;
      const paymentEntity = payload.payload?.payment?.entity;
      const payment = await Payment.findOne({ qrCodeId: qrEntity?.id, provider: "RAZORPAY" });
      await confirmRazorpayCapture(payment, paymentEntity, eventId);
    } else if (payload.event === "payment.captured") {
      const paymentEntity = payload.payload?.payment?.entity;
      const payment = await Payment.findOne({
        provider: "RAZORPAY",
        $or: [{ razorpayOrderId: paymentEntity?.order_id }, { providerReference: paymentEntity?.order_id }]
      });
      await confirmRazorpayCapture(payment, paymentEntity, eventId);
    }
    await WebhookEvent.updateOne({ eventId }, { $set: { status: "PROCESSED", processedAt: new Date() } });
    return res.status(200).send("OK");
  } catch (e) {
    await WebhookEvent.updateOne({ eventId }, { $set: { status: "FAILED", lastError: e.message }, $inc: { attempts: 1 } });
    return res.status(500).send("Processing failed");
  }
}

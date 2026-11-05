import mongoose from "mongoose";

const { Schema, model } = mongoose;
const opts = { timestamps: true, versionKey: false };

const TenantSchema = new Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true },
  legalName: String, phone: String, email: String, address: String,
  timezone: { type: String, default: "Asia/Kolkata" },
  currency: { type: String, default: "INR" },
  gstin: String, upiId: String, status: { type: String, enum: ["ACTIVE", "BLOCKED", "SUSPENDED"], default: "ACTIVE" },
  isActive: { type: Boolean, default: true },
  settings: { taxEnabled: { type: Boolean, default: true }, serviceChargeEnabled: { type: Boolean, default: false } }
}, opts);

const UserSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", default: null, index: true },
  loginId: { type: String, required: true, unique: true, lowercase: true, trim: true },
  email: { type: String, lowercase: true, sparse: true },
  name: { type: String, required: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["super_admin", "owner", "manager", "cashier", "waiter", "kitchen"], required: true },
  permissions: { type: [String], default: [] },
  mustChangePassword: { type: Boolean, default: true },
  status: { type: String, enum: ["ACTIVE", "BLOCKED", "SUSPENDED"], default: "ACTIVE" },
  isActive: { type: Boolean, default: true },
  refreshTokenHash: String,
  lastLoginAt: Date
}, opts);
UserSchema.index({ tenantId: 1, role: 1 });

const CustomerSessionSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, expires: 0 }
}, opts);

const CategorySchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  name: { type: String, required: true }, sortOrder: { type: Number, default: 0 }, isActive: { type: Boolean, default: true }
}, opts);

const MenuItemSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
  name: { type: String, required: true }, description: String,
  pricePaise: { type: Number, required: true, min: 0 },
  gstRate: { type: Number, enum: [0, 5, 12, 18, 28], default: 5 },
  foodType: { type: String, enum: ["VEG", "NON_VEG", "EGG"], default: "VEG" },
  station: { type: String, default: "MAIN" },
  modifiers: [{ name: String, options: [{ name: String, priceDeltaPaise: Number }] }],
  isAvailable: { type: Boolean, default: true }, imageUrl: String
}, opts);

const OrderItemSchema = new Schema({
  menuItemId: { type: Schema.Types.ObjectId, ref: "MenuItem" },
  name: { type: String, required: true }, quantity: { type: Number, min: 1, required: true },
  unitPricePaise: { type: Number, required: true }, totalPaise: { type: Number, required: true },
  gstRate: { type: Number, default: 5 }, station: String, modifiers: [Schema.Types.Mixed],
  status: { type: String, enum: ["PENDING", "ACCEPTED", "PREPARING", "READY", "SERVED", "CANCELLED"], default: "PENDING" },
  startedAt: Date, readyAt: Date, servedAt: Date, cancellationReason: String
}, { _id: true });

const OrderSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  orderNumber: { type: String, required: true },
  businessDate: { type: String, required: true },
  tokenNumber: Number,
  trackingTokenHash: String,
  customer: { name: String, phone: String },
  orderType: { type: String, enum: ["DINE_IN", "TAKEAWAY", "PICKUP", "WALK_IN"], default: "PICKUP" },
  zone: String, tableId: { type: Schema.Types.ObjectId, default: null },
  customerSessionId: { type: Schema.Types.ObjectId, ref: "CustomerSession", default: null, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  source: { type: String, enum: ["CUSTOMER", "WAITER", "COUNTER"], default: "CUSTOMER" },
  paymentStatus: { type: String, enum: ["PENDING", "PAID", "FAILED", "PARTIALLY_REFUNDED", "REFUNDED"], default: "PENDING" },
  orderStatus: { type: String, enum: ["PENDING_PAYMENT", "CONFIRMED", "PREPARING", "READY", "SERVED", "CANCELLED"], default: "PENDING_PAYMENT" },
  items: [OrderItemSchema],
  subtotalPaise: Number, taxPaise: Number, totalPaise: Number,
  paymentMethod: String, confirmedAt: Date
}, opts);
OrderSchema.index({ tenantId: 1, businessDate: 1, tokenNumber: 1 }, { unique: true, partialFilterExpression: { tokenNumber: { $type: "number" } } });
OrderSchema.index({ tenantId: 1, orderNumber: 1 }, { unique: true });

const TokenSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
  businessDate: { type: String, required: true }, sequence: { type: Number, default: 0 }
}, opts);
TokenSchema.index({ tenantId: 1, businessDate: 1 }, { unique: true });

const PaymentSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
  provider: { type: String, enum: ["RAZORPAY", "CASH", "UPI", "CARD"], required: true },
  status: { type: String, enum: ["CREATED", "AUTHORIZED", "CAPTURED", "FAILED", "REFUNDED"], default: "CREATED" },
  amountPaise: Number, currency: { type: String, default: "INR" },
  qrCodeId: String, razorpayOrderId: String, razorpayPaymentId: String, providerReference: String,
  idempotencyKey: { type: String, required: true, unique: true },
  capturedAt: Date, rawEvent: Schema.Types.Mixed
}, opts);

const WebhookEventSchema = new Schema({
  provider: String, eventId: { type: String, unique: true }, eventType: String,
  payload: Schema.Types.Mixed, status: { type: String, enum: ["RECEIVED", "PROCESSED", "FAILED"], default: "RECEIVED" },
  attempts: { type: Number, default: 0 }, lastError: String, processedAt: Date
}, opts);

const KotSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true },
  orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
  station: String, itemIds: [{ type: Schema.Types.ObjectId }], status: { type: String, default: "NEW" }
}, opts);

const AuditSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant" }, actorId: Schema.Types.ObjectId,
  action: String, entityType: String, entityId: Schema.Types.ObjectId,
  metadata: Schema.Types.Mixed, ip: String
}, opts);

const BillSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
  customerSessionId: { type: Schema.Types.ObjectId, ref: "CustomerSession", default: null, index: true },
  invoiceNumber: { type: String, required: true },
  orderIds: [{ type: Schema.Types.ObjectId, ref: "Order", required: true }],
  customer: { name: String, phone: String },
  items: [OrderItemSchema],
  subtotalPaise: { type: Number, required: true },
  taxPaise: { type: Number, required: true },
  totalPaise: { type: Number, required: true },
  paymentMethods: [String],
  paymentStatus: { type: String, enum: ["PAID", "PENDING"], required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  generatedAt: { type: Date, default: Date.now }
}, opts);
BillSchema.index({ tenantId: 1, invoiceNumber: 1 }, { unique: true });
BillSchema.index({ tenantId: 1, orderIds: 1 }, { unique: true });

export const Tenant = model("Tenant", TenantSchema);
export const User = model("User", UserSchema);
export const CustomerSession = model("CustomerSession", CustomerSessionSchema);
export const Category = model("Category", CategorySchema);
export const MenuItem = model("MenuItem", MenuItemSchema);
export const Order = model("Order", OrderSchema);
export const DailyTokenSequence = model("DailyTokenSequence", TokenSchema);
export const Payment = model("Payment", PaymentSchema);
export const WebhookEvent = model("WebhookEvent", WebhookEventSchema);
export const Kot = model("Kot", KotSchema);
export const AuditLog = model("AuditLog", AuditSchema);
export const Bill = model("Bill", BillSchema);

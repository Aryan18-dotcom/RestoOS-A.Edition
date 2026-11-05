# Security and release checklist

## Identity and access
- [ ] Change bootstrap super-admin password immediately; disable bootstrap seed path after setup.
- [ ] Enforce MFA for super-admin and owner accounts.
- [ ] Add refresh-token rotation reuse detection and per-device sessions.
- [ ] Add CSRF token strategy for all cookie-authenticated state-changing routes.
- [ ] Add account lockout, password reset and email/phone verification.
- [ ] Add permission-level checks, not only broad roles, for discounts/refunds/export.
- [ ] Ensure all tenant reads/writes include tenantId and test cross-tenant isolation.

## Payment correctness
- [ ] Confirm Razorpay account activation for UPI QR APIs and exact webhook payloads.
- [ ] Verify webhook signature using raw request bytes.
- [ ] Verify QR ID, payment ID, currency, amount and tenant/order metadata.
- [ ] Add durable retry worker for WebhookEvent status FAILED.
- [ ] Add reconciliation job against Razorpay API.
- [ ] Add refunds, partial refunds and chargeback workflow.
- [ ] Test duplicate, delayed, reordered and replayed webhook deliveries.
- [ ] Test MongoDB transaction rollback and token allocation race conditions.

## POS operations
- [ ] Add KOT splitting and station-level bump workflow.
- [ ] Add waiter order creation with explicit payment authorization.
- [ ] Add owner/cashier billing, split tender, receipt numbering and immutable invoices.
- [ ] Add GST invoice validation and accountant review.
- [ ] Add inventory ledger, recipe consumption, purchase and wastage.
- [ ] Add thermal print bridge and printer reconnect handling.
- [ ] Add persisted notification outbox and socket reconnect synchronization.

## Infrastructure
- [ ] TLS, HSTS, firewall, SSH key-only login.
- [ ] MongoDB private networking, auth and encrypted backups.
- [ ] Daily off-server backup and restore test.
- [ ] PM2 startup integration and log rotation.
- [ ] Error monitoring, uptime alerts and disk/RAM monitoring.
- [ ] Staging deployment, dependency audit and penetration test.
- [ ] Load test API, sockets, webhook processing and report queries.

# RestaurantOS

A JavaScript monorepo foundation for a tenant-aware restaurant POS, token ordering, kitchen display and billing platform.

## Included
- Next.js App Router + Tailwind customer/staff/admin interface
- Express API + MongoDB/Mongoose
- Super-admin bootstrap account with forced password change
- Super-admin restaurant registration with a linked owner and one-time credentials
- Restaurant detail, user management, account blocking/suspension, and system status dashboard
- Restaurant-scoped user creation with generated one-time username/password
- WhatsApp automation placeholder (no provider connected)
- First-login credential update enforcement
- Access/refresh JWT cookies, Argon2id password hashing, RBAC and tenant scoping
- Menu/category APIs, pending orders, daily token allocation, KOT item statuses
- Razorpay QR creation, development API payment verification, and production raw-body webhook signature verification/idempotency
- Socket.IO rooms and server-authoritative broadcasts
- Dashboard, kitchen, waiter and customer tracking screens
- MongoDB Atlas for database hosting and transactions

## Important security note
The requested `admin / admin@pass123` is supported only as a bootstrap credential. The bootstrap account is forced to change its password before using any other feature. Set `BOOTSTRAP_SUPERADMIN_EMAIL` and `BOOTSTRAP_SUPERADMIN_PASSWORD` before the first seed in production, use a unique strong secret, and remove bootstrap credentials from the environment after seeding. Never expose this account publicly or reuse the default password.

This is a substantial runnable foundation, not a claim of audited payment compliance or a fully certified commercial POS. Before live sales, complete provider onboarding, GST/accounting review, penetration testing, printer integration, backup restoration drills, load testing and legal review. Razorpay QR API capabilities and event names can depend on account/product activation. The webhook implementation deliberately fails closed when secrets are missing.

## Role-based access control (RBAC)

Staff navigation and every staff workspace are restricted by the authenticated user's role. The frontend checks `/api/v1/auth/me` before rendering a protected workspace, hides navigation entries the role cannot use, redirects unauthorized page visits to that role's home page, and routes unauthenticated users to login. The Express API independently enforces role permissions; frontend hiding is not treated as a security boundary.

| Role | Default landing page | Allowed staff pages |
|---|---|---|
| `super_admin` | `/super-admin` | Platform restaurant administration only |
| `owner` | `/dashboard` | Overview, Kitchen (read-only), Waiter, Menu, Billing |
| `manager` | `/dashboard` | Overview, Kitchen (read-only), Waiter, Menu |
| `cashier` | `/billing` | Billing counter |
| `waiter` | `/waiter` | Waiter workspace |
| `kitchen` | `/kitchen` | Kitchen display and item status updates |
| Customer | `/menu` or `/track/:trackingToken` | Public customer menu and order tracking; no staff account required |

API enforcement includes: super-admin routes restricted to `super_admin`; menu writes restricted to `owner` and `manager`; kitchen ticket reads available to `owner`, `manager`, and `kitchen`, while kitchen item updates and bump actions are restricted to `kitchen`; manual order creation restricted to `owner`, `manager`, and `waiter`; authenticated order detail reads restricted to `owner`, `manager`, `cashier`, and `waiter`. Tenant scoping remains session-derived. Public menu lookup, customer order creation/tracking, Razorpay QR creation and signed Razorpay webhooks remain public/provider-facing flows by design.

### RBAC smoke test
1. Create one account for each staff role and complete its forced first-login password change.
2. Sign in separately as each role and verify the default landing page and visible navigation.
3. Paste another role's page URL directly into the address bar; the user should be redirected to their own workspace.
4. Call a disallowed protected API with that user's session; it should return HTTP `403`.
5. Verify a kitchen account can update item statuses, while owner/manager accounts can only view kitchen tickets.
6. Verify customers can still open `/menu` and `/track/:trackingToken` without staff authentication.

## Requirements
- Node.js 20.11+
- MongoDB Atlas cluster (transactions are required)
- npm

## Local setup
1. Create a MongoDB Atlas cluster, add a database user, and allow your client IP in Network Access.
2. Copy `.env.example` to `.env`; replace the `MONGODB_URI` placeholders with the Atlas connection string and set strong secrets. URL-encode special characters in the database username or password.
3. `npm install`
4. `npm run seed:superadmin`
5. `npm run dev`
6. Open `http://localhost:3000`.

For phone testing on the same Wi-Fi, open the owner dashboard on the laptop at `http://localhost:3000`; in development, its restaurant QR and printable menu URL use the laptop's detected private IPv4 address. Scan that QR from the phone while both devices are on the same network. The browser API client follows that LAN hostname to reach port 5000, and development CORS permits the private IPv4 web origin. Allow Node.js through Windows Firewall for private networks if prompted. Do not expose these development ports to the public internet.

Bootstrap login: `admin` / `admin@pass123` unless overridden in `.env`. The first screen forces a password change.

### Vercel deployment
The root `vercel.json` deploys the Next.js web app and Express API as services in one Vercel project. `/api/*` is routed to the API service; all other paths are routed to the web service. Browser API requests use the same-origin `/api` path, so do not set `NEXT_PUBLIC_API_URL` or `NEXT_PUBLIC_SOCKET_URL` to a localhost URL in Vercel.

Set `MONGODB_URI`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET` in the Vercel project's environment variables. Override the bootstrap login credentials for production, and add Razorpay credentials when payments are enabled. Production cookies default to secure; `COOKIE_SECURE` can explicitly override that behavior. `WEB_ORIGIN` may be set to the deployed web origin; same-origin requests are also allowed automatically.

The API is deployed as a Vercel Function. The repository's standalone Socket.IO server is not exposed by the `/api` rewrite, and Vercel Functions do not provide a persistent Socket.IO server; use a separately hosted realtime service if live socket connections are needed.

### Razorpay payment verification
Set `NODE_ENV=development` for local trials. If `NODE_ENV` is unset, the API defaults to production mode. Customer checkout uses Razorpay Orders and the hosted Razorpay Checkout UI (not the on-demand QR Codes API). In development, the signed checkout response is verified against Razorpay's API and the order status endpoint also polls the Razorpay order (`POST /api/v1/payments/:orderId/status`); include the order tracking token in the request body as `trackingToken`. Webhook events are ignored in development. In every non-development environment, settlement is performed only by the signed Razorpay `payment.captured` webhook at `POST /api/v1/webhooks/razorpay`, and API polling is disabled. Configure `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in both environments, and configure `RAZORPAY_WEBHOOK_SECRET` for production.

## First-run flow
1. Super admin logs in and is redirected to `/change-password`.
2. Super admin changes the bootstrap password.
3. Super admin registers a restaurant.
4. Super admin creates restaurant users (owner, manager, cashier, waiter, kitchen).
5. API generates a unique login ID and random temporary password, shown once in the response.
6. New user signs in and is forced to set their own password before any operational route is available.

The super-admin dashboard shows platform and database status, lists all restaurants, and supports separate reversible `BLOCKED` and `SUSPENDED` states. Selecting a restaurant opens its user and operational summary, where the super admin can add users and change account status. Blocked/suspended users and restaurant staff cannot authenticate; restoring a restaurant or user to `ACTIVE` restores access. Owner and staff temporary credentials are displayed only in the creation response and dashboard session. WhatsApp automation is currently a non-functional placeholder.

On first login, staff must set a 12-character-minimum password and may optionally change their login ID. The owner dashboard provides tenant-scoped daily sales/order analytics, the restaurant's reusable menu QR, menu links, live token/KOT/payment status, counter orders, bill edits before settlement, and bill printing. Counter orders are held as pending until staff record a cash, UPI, or card settlement; only then are a token and kitchen tickets created. Unpaid counter bills can be edited; paid bills are immutable. Customer orders are paid through Razorpay Checkout before kitchen confirmation.

The customer menu QR is a static restaurant URL and does not encode a table. Customer details are stored in an HTTP-only browser session for seven hours, so repeat orders from that browser can be grouped into one itemized bill at the counter. Paid orders cannot be edited; create an adjustment/refund workflow before changing paid orders in production.

## VPS deployment outline
- Build web: `npm run build:web`
- Run API and Next.js with PM2 under separate process names.
- Put Nginx in front; proxy `/api` and `/socket.io` to API and web traffic to Next.js.
- Keep MongoDB private; use managed MongoDB or a replica-set-enabled private deployment.
- Configure HTTPS, firewall, off-server backups, log rotation, monitoring and staging.
- Use a process manager and health checks. Do not expose ports 5000 or 27017 publicly.

## Main routes
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/first-login-update`
- `POST /api/v1/orders/customer-session`
- `GET /api/v1/orders/customer-session`
- `GET /api/v1/orders/customer-session/orders`
- `POST /api/v1/super-admin/restaurants`
- `GET /api/v1/super-admin/status`
- `GET /api/v1/super-admin/restaurants/:tenantId`
- `PATCH /api/v1/super-admin/restaurants/:tenantId/status`
- `POST /api/v1/super-admin/restaurants/:tenantId/users`
- `PATCH /api/v1/super-admin/restaurants/:tenantId/users/:userId/status`
- `GET /api/v1/super-admin/restaurants`
- `GET /api/v1/menu`
- `POST /api/v1/orders`
- `GET /api/v1/orders/analytics` (staff)
- `GET /api/v1/orders/operations` (staff)
- `POST /api/v1/orders/bills` (staff)
- `PATCH /api/v1/orders/bills/:id/items` (edit an unpaid counter bill)
- `POST /api/v1/orders/:id/settle` (counter orders)
- `GET /api/v1/menu/admin` (owner/manager)
- `GET /api/v1/orders/:id`
- `GET /api/v1/orders/track/:trackingToken`
- `POST /api/v1/payments/:orderId/checkout`
- `POST /api/v1/payments/:orderId/verify`
- `POST /api/v1/payments/:orderId/qr` (legacy QR Code API)
- `POST /api/v1/payments/:orderId/status` (development only; requires the order's tracking token in the request body)
- `POST /api/v1/webhooks/razorpay`
- `PATCH /api/v1/kitchen/items/:itemId`
- `POST /api/v1/kitchen/orders/:orderId/bump`
- `GET /api/v1/health`

All protected APIs are tenant-scoped. A restaurant user cannot select a tenant by sending an arbitrary request field; tenant context comes from the verified session.

Login attempts are limited to 30 per IP address per 15 minutes. Other API routes, including session lookups and development payment-status polling, do not use rate limiting.
#   R e s t o O S - A . E d i t i o n  
 
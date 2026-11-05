# RestaurantOS RBAC test matrix

## Page access matrix

| Page | Super Admin | Owner | Manager | Cashier | Waiter | Kitchen | Customer |
|---|---:|---:|---:|---:|---:|---:|---:|
| `/super-admin` | Allow | Deny | Deny | Deny | Deny | Deny | Deny |
| `/dashboard` | Deny | Allow | Allow | Deny | Deny | Deny | Deny |
| `/kitchen` | Deny | Read | Read | Deny | Deny | Update | Deny |
| `/waiter` | Deny | Allow | Allow | Deny | Allow | Deny | Deny |
| `/menu-admin` | Deny | Allow | Allow | Deny | Deny | Deny | Deny |
| `/billing` | Deny | Allow | Deny | Allow | Deny | Deny | Deny |
| `/menu` | Public customer route | Public | Public | Public | Public | Public | Public |
| `/track/:trackingToken` | Public customer route | Public | Public | Public | Public | Public | Public |

`Read` means the role can view kitchen tickets but cannot change their item statuses. `Update` means the kitchen role can update preparation statuses.

## API access matrix

| API | Allowed roles |
|---|---|
| `GET /api/v1/auth/me` | Any authenticated staff user |
| `/api/v1/super-admin/*` | `super_admin` |
| `POST /api/v1/menu/categories` | `owner`, `manager` |
| `POST /api/v1/menu/items` | `owner`, `manager` |
| `PATCH /api/v1/menu/items/:id/availability` | `owner`, `manager` |
| `GET /api/v1/kitchen/orders` | `owner`, `manager`, `kitchen` |
| `PATCH /api/v1/kitchen/items/:itemId` | `kitchen` |
| `POST /api/v1/kitchen/orders/:orderId/bump` | `kitchen` |
| `POST /api/v1/orders/manual` | `owner`, `manager`, `waiter` |
| `GET /api/v1/orders/:id` | `owner`, `manager`, `cashier`, `waiter` |

Public customer endpoints remain public by design: menu lookup, customer order creation, tracking by unguessable tracking token, payment QR creation for a pending order, and the signed Razorpay webhook. All authenticated restaurant data remains tenant-scoped from the verified user session.

## Manual test cases

1. Log in with each staff role and confirm the role-specific landing page.
2. Confirm the sidebar and mobile navigation contain only the allowed pages.
3. Paste each denied page URL directly. It should redirect to the role's landing page.
4. Sign in as `waiter` and call `PATCH /api/v1/kitchen/items/:itemId`; expect HTTP `403`.
5. Sign in as `owner` or `manager` and call the same kitchen item update; expect HTTP `403`.
6. Sign in as `kitchen` and update an item; expect success for an authorized tenant item.
7. Sign in as `cashier` and call a menu write endpoint; expect HTTP `403`.
8. Sign in as `manager` and call `GET /api/v1/kitchen/orders`; expect success, but item updates remain forbidden.
9. Sign in as a non-super-admin and call `/api/v1/super-admin/restaurants`; expect HTTP `403`.
10. Open customer `/menu` and `/track/:trackingToken` in a private browser without staff login; verify they remain available.
11. Try a protected page before login; it should redirect to `/login`.
12. Log in with a temporary password; all staff pages should remain blocked until `/change-password` is completed.

"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "../../lib/api";

export default function CustomerMenu() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState("");
  const [menu, setMenu] = useState(null);
  const [quantities, setQuantities] = useState({});
  const [customer, setCustomer] = useState(null);
  const [customerForm, setCustomerForm] = useState({ name: "", phone: "" });
  const [customerOrders, setCustomerOrders] = useState([]);
  const [checkout, setCheckout] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadRazorpayCheckout() {
    if (window.Razorpay) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load Razorpay Checkout. Check your internet connection and try again."));
      document.body.appendChild(script);
    });
    if (!window.Razorpay) throw new Error("Razorpay Checkout did not initialize. Please try again.");
  }

  function openRazorpayCheckout(paymentDetails, activeCustomer = customer) {
    const checkout = new window.Razorpay({
      key: paymentDetails.keyId,
      amount: paymentDetails.amount,
      currency: paymentDetails.currency,
      name: paymentDetails.name,
      description: paymentDetails.description,
      order_id: paymentDetails.orderId,
      prefill: activeCustomer ? { name: activeCustomer.name, contact: activeCustomer.phone } : undefined,
      handler: async response => {
        setBusy(true);
        setError("");
        try {
          const result = await api(`/payments/${paymentDetails.restaurantOrderId}/verify`, {
            method: "POST",
            body: JSON.stringify({ ...response, trackingToken: paymentDetails.trackingToken })
          });
          if (result.paymentStatus === "PAID") {
            router.push(`/track/${paymentDetails.trackingToken}`);
          } else {
            setError("Payment submitted. Waiting for Razorpay to confirm it; this page will update automatically.");
          }
        } catch (e) {
          setError(`Payment verification failed: ${e.message}`);
        } finally {
          setBusy(false);
        }
      },
      modal: { ondismiss: () => setBusy(false) }
    });
    checkout.on("payment.failed", response => {
      setError(response.error?.description || "Payment failed. Please try again.");
    });
    checkout.open();
  }

  const loadMenu = useCallback(async (id) => {
    try {
      setCustomer(null);
      setCustomerOrders([]);
      setCheckout(null);
      setQuantities({});
      const result = await api(`/menu?tenantId=${encodeURIComponent(id)}`);
      setMenu(result);
      setError("");
      const session = await api(`/orders/customer-session?tenantId=${encodeURIComponent(id)}`);
      setCustomer(session.customer);
      if (session.customer) {
        setCustomerForm(session.customer);
        const orderResult = await api(`/orders/customer-session/orders?tenantId=${encodeURIComponent(id)}`);
        setCustomerOrders(orderResult.orders);
      }
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(location.search).get("restaurant");
    if (id) {
      setTenantId(id);
      loadMenu(id);
    }
  }, [loadMenu]);

  useEffect(() => {
    if (!checkout) return undefined;
    let active = true;
    async function checkPayment() {
      try {
        let status;
        if (process.env.NODE_ENV === "development") {
          status = await api(`/payments/${checkout.orderId}/status`, {
            method: "POST", body: JSON.stringify({ trackingToken: checkout.trackingToken })
          });
        } else {
          const result = await api(`/orders/track/${checkout.trackingToken}`);
          status = result.order;
        }
        if (active && status.paymentStatus === "PAID") {
          router.push(`/track/${checkout.trackingToken}`);
        }
      } catch (e) {
        if (active) setError(`Payment status check failed: ${e.message}`);
      }
    }
    checkPayment();
    const timer = setInterval(checkPayment, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [checkout, router]);

  const cartItems = menu?.items.filter(item => quantities[item._id] > 0) || [];
  const totalPaise = cartItems.reduce((sum, item) => {
    const line = item.pricePaise * quantities[item._id];
    return sum + line + Math.round(line * item.gstRate / 100);
  }, 0);

  async function load(e) {
    e?.preventDefault();
    if (tenantId.trim()) await loadMenu(tenantId.trim());
  }

  async function startCheckout(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await loadRazorpayCheckout();
      let activeCustomer = customer;
      if (!activeCustomer) {
        const session = await api("/orders/customer-session", {
          method: "POST",
          body: JSON.stringify({ tenantId: menu.restaurant._id, ...customerForm })
        });
        activeCustomer = session.customer;
        setCustomer(activeCustomer);
      }
      const created = await api("/orders", {
        method: "POST",
        body: JSON.stringify({
          restaurantSlug: menu.restaurant.slug,
          orderType: "TAKEAWAY",
          items: cartItems.map(item => ({ menuItemId: item._id, quantity: quantities[item._id] }))
        })
      });
      const payment = await api(`/payments/${created.order.id}/checkout`, {
        method: "POST", body: JSON.stringify({ trackingToken: created.trackingToken })
      });
      const paymentDetails = {
        ...payment,
        restaurantOrderId: created.order.id,
        trackingToken: created.trackingToken,
        customer: activeCustomer
      };
      setCheckout(paymentDetails);
      setQuantities({});
      const orderResult = await api(`/orders/customer-session/orders?tenantId=${encodeURIComponent(menu.restaurant._id)}`);
      setCustomerOrders(orderResult.orders);
      openRazorpayCheckout(paymentDetails, activeCustomer);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto min-h-screen max-w-4xl p-4 sm:p-6">
    <header className="py-8">
      <p className="text-xs font-black uppercase tracking-widest text-brand">RestaurantOS · Customer menu</p>
      <h1 className="mt-2 text-4xl font-black">{menu?.restaurant?.name || "Explore the menu"}</h1>
      <p className="mt-2 text-slate-500">Scan the restaurant menu QR, choose items, then pay to send your order to the kitchen.</p>
    </header>
    {!menu && <form onSubmit={load} className="flex gap-2">
      <input value={tenantId} onChange={e => setTenantId(e.target.value)} placeholder="Restaurant ID" className="min-w-0 flex-1 rounded-xl border bg-white p-3"/>
      <button className="rounded-xl bg-slate-950 px-5 font-bold text-white">Load menu</button>
    </form>}
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

    {menu && !checkout && <>
      {customer && <div className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">Ordering as {customer.name}. Your details are remembered on this device for up to 7 hours.</div>}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">{menu.items.map(item => <article key={item._id} className="flex items-center justify-between gap-4 rounded-2xl bg-white p-4 shadow-sm">
        <div><h2 className="font-bold">{item.name}</h2><p className="mt-1 text-xs text-slate-500">{item.foodType} · GST {item.gstRate}%</p><strong className="mt-2 block">₹{(item.pricePaise / 100).toFixed(2)}</strong></div>
        <div className="flex items-center gap-3"><button type="button" aria-label={`Remove one ${item.name}`} onClick={() => setQuantities({ ...quantities, [item._id]: Math.max(0, (quantities[item._id] || 0) - 1) })} className="h-9 w-9 rounded-full border font-black">−</button><span className="w-5 text-center font-bold">{quantities[item._id] || 0}</span><button type="button" aria-label={`Add one ${item.name}`} onClick={() => setQuantities({ ...quantities, [item._id]: (quantities[item._id] || 0) + 1 })} className="h-9 w-9 rounded-full bg-slate-950 font-black text-white">+</button></div>
      </article>)}</div>

      {cartItems.length > 0 && <section className="mt-7 rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="text-xl font-black">Checkout</h2>
        {customer ? <p className="mt-2 text-sm text-slate-600">Customer: {customer.name} · {customer.phone}</p> :
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-bold">Your name<input required minLength={2} value={customerForm.name} onChange={e => setCustomerForm({ ...customerForm, name: e.target.value })} className="mt-1 w-full rounded-xl border p-3"/></label>
            <label className="text-sm font-bold">Phone number<input required minLength={10} maxLength={18} type="tel" value={customerForm.phone} onChange={e => setCustomerForm({ ...customerForm, phone: e.target.value })} className="mt-1 w-full rounded-xl border p-3"/></label>
          </div>}
        <div className="mt-4 flex items-center justify-between border-t pt-4"><span className="font-bold">Total incl. GST</span><strong className="text-xl">₹{(totalPaise / 100).toFixed(2)}</strong></div>
        <button disabled={busy} onClick={startCheckout} className="mt-4 w-full rounded-xl bg-brand p-3 font-bold text-white disabled:opacity-50">{busy ? "Preparing secure checkout…" : "Continue to payment"}</button>
        <p className="mt-2 text-xs text-slate-500">Your order is sent to the kitchen only after payment is verified.</p>
      </section>}

      {customerOrders.length > 0 && <section className="mt-7"><h2 className="text-xl font-black">Your recent orders</h2><div className="mt-3 space-y-2">{customerOrders.slice(0, 10).map(order => <div key={order._id} className="flex flex-wrap justify-between gap-2 rounded-xl bg-white p-4 text-sm"><span>Token #{order.tokenNumber || "—"} · {order.createdAt ? new Date(order.createdAt).toLocaleString() : order.orderNumber}</span><span className="font-bold">{order.paymentStatus} · {order.orderStatus.replaceAll("_", " ")}</span></div>)}</div></section>}
    </>}

    {checkout && <section className="mt-6 rounded-2xl bg-white p-6 text-center shadow-sm">
      <h2 className="text-2xl font-black">Pay to place your order</h2>
      <p className="mt-2 text-slate-600">Complete payment in the secure Razorpay checkout window.</p>
      <p className="mt-3 text-xl font-black">₹{(checkout.amount / 100).toFixed(2)}</p>
      <button disabled={busy} onClick={() => openRazorpayCheckout(checkout)} className="mt-5 rounded-xl bg-brand px-6 py-3 font-bold text-white disabled:opacity-50">Open secure payment</button>
      <p className="mt-4 text-sm text-slate-500">Waiting for verified payment. This page checks automatically.</p>
      <Link href={`/track/${checkout.trackingToken}`} className="mt-4 inline-block font-bold text-brand">Open order status</Link>
    </section>}
  </main>;
}

"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../lib/api";

const money = paise => `₹${(Number(paise || 0) / 100).toFixed(2)}`;
const settlementMethods = ["CASH", "UPI", "CARD"];

function Status({ children }) {
  const styles = {
    PAID: "bg-emerald-100 text-emerald-800", CONFIRMED: "bg-sky-100 text-sky-800",
    PREPARING: "bg-amber-100 text-amber-800", READY: "bg-violet-100 text-violet-800",
    PENDING: "bg-amber-100 text-amber-800", PENDING_PAYMENT: "bg-orange-100 text-orange-800"
  };
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${styles[children] || "bg-slate-100 text-slate-700"}`}>{String(children || "UNKNOWN").replaceAll("_", " ")}</span>;
}

export default function RestaurantOperations({ mode = "owner" }) {
  const [user, setUser] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [orders, setOrders] = useState([]);
  const [bills, setBills] = useState([]);
  const [menu, setMenu] = useState([]);
  const [editingOrder, setEditingOrder] = useState(null);
  const [editingBill, setEditingBill] = useState(null);
  const [editLines, setEditLines] = useState([]);
  const [addMenuId, setAddMenuId] = useState("");
  const [methods, setMethods] = useState({});
  const [newOrder, setNewOrder] = useState({ customerName: "", customerPhone: "", orderType: "TAKEAWAY", menuItemId: "", quantity: 1 });
  const [currentBill, setCurrentBill] = useState(null);
  const [lanIpv4, setLanIpv4] = useState("");
  const [lanAddressError, setLanAddressError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !["localhost", "127.0.0.1"].includes(window.location.hostname)) return;
    api("/network")
      .then(result => {
        if (result.lanIpv4) setLanIpv4(result.lanIpv4);
        else setLanAddressError("No private IPv4 address was found on this computer.");
      })
      .catch(e => setLanAddressError(e.message));
  }, []);

  const load = useCallback(async () => {
    try {
      const currentUser = user || (await api("/auth/me")).user;
      if (!user) setUser(currentUser);
      const requests = [
        api("/orders/operations"),
        api("/orders/bills")
      ];
      if (mode === "owner") {
        requests.push(api("/orders/analytics"));
      }
      if (currentUser.tenantId) requests.push(api(`/menu?tenantId=${encodeURIComponent(currentUser.tenantId)}`));
      const responses = await Promise.all(requests);
      setOrders(responses[0].orders);
      setBills(responses[1].bills);
      if (mode === "owner") {
        setAnalytics(responses[2]);
        setMenu(responses[3]?.items || []);
      } else setMenu(responses[2]?.items || []);
      setError("");
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [mode, user]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 7000);
    return () => clearInterval(timer);
  }, [load]);

  const alreadyBilledOrderIds = useMemo(() => new Set(bills.flatMap(bill => bill.orderIds.map(String))), [bills]);
  const billGroups = useMemo(() => {
    const groups = new Map();
    for (const order of orders) {
      const billable = order.paymentStatus === "PAID" || (order.source === "COUNTER" && order.paymentStatus === "PENDING");
      if (!billable || alreadyBilledOrderIds.has(String(order._id))) continue;
      const key = order.customerSessionId ? String(order.customerSessionId) : `single:${order._id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(order);
    }
    return [...groups.entries()];
  }, [orders, alreadyBilledOrderIds]);

  async function settle(order) {
    setError("");
    try {
      await api(`/orders/${order._id}/settle`, { method: "POST", body: JSON.stringify({ method: methods[order._id] || "CASH" }) });
      await load();
    } catch (e) { setError(e.message); }
  }

  function beginEdit(order) {
    setEditingOrder(order);
    setEditingBill(null);
    setEditLines(order.items.map(item => ({ menuItemId: String(item.menuItemId), quantity: item.quantity, label: item.name })));
    setAddMenuId("");
    setError("");
  }

  function beginBillEdit(bill) {
    setEditingOrder(null);
    setEditingBill(bill);
    setEditLines(bill.items.map(item => ({ menuItemId: String(item.menuItemId), quantity: item.quantity, label: item.name })));
    setAddMenuId("");
    setCurrentBill(bill);
    setError("");
  }

  async function saveEdit() {
    const items = editLines.filter(line => Number(line.quantity) > 0).map(line => ({ menuItemId: line.menuItemId, quantity: Number(line.quantity) }));
    if (!items.length) return setError("An order must contain at least one menu item.");
    try {
      if (editingBill) {
        const result = await api(`/orders/bills/${editingBill._id}/items`, { method: "PATCH", body: JSON.stringify({ items }) });
        setCurrentBill(result.bill);
      } else {
        await api(`/orders/${editingOrder._id}/items`, { method: "PATCH", body: JSON.stringify({ items }) });
      }
      setEditingOrder(null);
      setEditingBill(null);
      await load();
    } catch (e) { setError(e.message); }
  }

  function addEditedItem() {
    const item = menu.find(value => value._id === addMenuId);
    if (!item) return;
    const existing = editLines.find(line => line.menuItemId === item._id);
    if (existing) setEditLines(editLines.map(line => line.menuItemId === item._id ? { ...line, quantity: Number(line.quantity) + 1 } : line));
    else setEditLines([...editLines, { menuItemId: item._id, quantity: 1, label: item.name }]);
    setAddMenuId("");
  }

  async function createCounterOrder(e) {
    e.preventDefault();
    if (!newOrder.menuItemId) return setError("Select an item for the counter order.");
    setError("");
    try {
      await api("/orders/manual", {
        method: "POST",
        body: JSON.stringify({
          customerName: newOrder.customerName || undefined,
          customerPhone: newOrder.customerPhone || undefined,
          orderType: newOrder.orderType,
          items: [{ menuItemId: newOrder.menuItemId, quantity: Number(newOrder.quantity) }]
        })
      });
      setNewOrder({ customerName: "", customerPhone: "", orderType: "TAKEAWAY", menuItemId: "", quantity: 1 });
      await load();
    } catch (e) { setError(e.message); }
  }

  async function generateBill(groupedOrders) {
    setError("");
    try {
      const result = await api("/orders/bills", {
        method: "POST",
        body: JSON.stringify({ orderIds: groupedOrders.map(order => order._id) })
      });
      setCurrentBill(result.bill);
      await load();
    } catch (e) { setError(e.message); }
  }

  const menuUrl = (() => {
    if (typeof window === "undefined" || !user?.tenantId) return "";
    const url = new URL(window.location.origin);
    if (["localhost", "127.0.0.1"].includes(url.hostname)) {
      if (!lanIpv4) return "";
      url.hostname = lanIpv4;
    }
    url.pathname = "/menu";
    url.search = `?restaurant=${encodeURIComponent(user.tenantId)}`;
    return url.toString();
  })();
  const printBill = () => window.print();

  return <div>
    {error && <p role="alert" className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}

    {mode === "owner" && <>
      {menuUrl && <section className="mb-6 flex flex-col items-center gap-5 rounded-2xl bg-slate-950 p-6 text-center text-white sm:flex-row sm:text-left">
        <div className="rounded-xl bg-white p-3"><QRCodeSVG value={menuUrl} size={150} level="H"/></div>
        <div><p className="text-xs font-black uppercase tracking-widest text-violet-300">One restaurant QR</p><h2 className="mt-2 text-xl font-black">Share this QR for menu and ordering</h2><p className="mt-2 break-all text-sm text-slate-300">Print URL: {menuUrl}</p><p className="mt-2 text-xs text-slate-400">Customer orders receive a token after verified payment; no table assignment is used.</p></div>
      </section>}
      {user?.tenantId && !menuUrl && <p className="mb-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{lanAddressError || "Finding this computer's LAN IPv4 address before creating the restaurant QR…"}</p>}
      {analytics && <section className="mb-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Today's orders", analytics.today.orders], ["Paid sales today", money(analytics.today.salesPaise)],
          ["Outstanding", money(analytics.today.outstandingPaise)], ["Team / menu", `${analytics.users} / ${analytics.menuItems}`]
        ].map(([label, value]) => <article key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-bold uppercase text-slate-500">{label}</p><p className="mt-2 text-2xl font-black">{value}</p></article>)}
      </section>}
      {analytics && <section className="mb-7 grid gap-5 lg:grid-cols-2">
        <article className="rounded-2xl bg-white p-5 shadow-sm"><h2 className="font-black">Order pipeline</h2><div className="mt-3 flex flex-wrap gap-2">{Object.entries(analytics.statusCounts).map(([status, count]) => <span key={status} className="rounded-lg bg-slate-50 px-3 py-2 text-sm"><b>{count}</b> {status.replaceAll("_", " ").toLowerCase()}</span>)}</div></article>
        <article className="rounded-2xl bg-white p-5 shadow-sm"><h2 className="font-black">Top selling items</h2><div className="mt-3 space-y-2">{analytics.topItems.length ? analytics.topItems.map(item => <div key={item._id} className="flex justify-between text-sm"><span>{item._id} · {item.quantity} sold</span><b>{money(item.salesPaise)}</b></div>) : <p className="text-sm text-slate-500">Sales appear here after paid orders.</p>}</div></article>
      </section>}
      <div className="mb-6 flex flex-wrap gap-3"><Link href="/menu-admin" className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white">Manage menu</Link><Link href="/billing" className="rounded-xl border bg-white px-4 py-3 text-sm font-bold">Open billing counter</Link></div>

    </>}

    <section className="mb-8 rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black">Counter order</h2><p className="mt-1 text-sm text-slate-500">Create an unpaid POS order; edit its items, then record settlement to allocate a token and send it to the kitchen.</p>
      <form onSubmit={createCounterOrder} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <input value={newOrder.customerName} onChange={e => setNewOrder({ ...newOrder, customerName: e.target.value })} placeholder="Customer name (optional)" className="rounded-xl border p-3"/>
        <input value={newOrder.customerPhone} onChange={e => setNewOrder({ ...newOrder, customerPhone: e.target.value })} placeholder="Phone (optional)" className="rounded-xl border p-3"/>
        <select required value={newOrder.menuItemId} onChange={e => setNewOrder({ ...newOrder, menuItemId: e.target.value })} className="rounded-xl border bg-white p-3"><option value="">Select menu item</option>{menu.filter(item => item.isAvailable).map(item => <option key={item._id} value={item._id}>{item.name} · {money(item.pricePaise)}</option>)}</select>
        <input type="number" min="1" max="30" value={newOrder.quantity} onChange={e => setNewOrder({ ...newOrder, quantity: e.target.value })} className="rounded-xl border p-3"/>
        <button className="rounded-xl bg-brand p-3 font-bold text-white">Create unpaid order</button>
      </form>
    </section>

    <section className="mb-8">
      <div className="mb-4 flex items-end justify-between"><div><h2 className="text-xl font-black">Live order and kitchen status</h2><p className="mt-1 text-sm text-slate-500">Refreshes automatically every 7 seconds. This restaurant uses order tokens instead of table tracking.</p></div><button onClick={load} className="rounded-xl border bg-white px-4 py-2 text-sm font-bold">Refresh</button></div>
      {loading ? <p className="rounded-2xl bg-white p-5 text-slate-500">Loading operations…</p> : orders.length === 0 ? <p className="rounded-2xl bg-white p-5 text-slate-500">No orders yet.</p> :
        <div className="space-y-3">{orders.map(order => <article key={order._id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><h3 className="font-black">{order.customer?.name || "Walk-in"} · Token #{order.tokenNumber ?? "Pending"}</h3><Status>{order.paymentStatus}</Status><Status>{order.orderStatus}</Status></div>
              <p className="mt-1 text-xs text-slate-500">{order.orderNumber} · {order.orderType} · {order.customer?.phone || "No phone"} · {new Date(order.createdAt).toLocaleString()}</p>
              <div className="mt-3 space-y-1 text-sm">{order.items.map((item, index) => <p key={`${item.menuItemId}-${index}`} className="flex flex-wrap justify-between gap-2"><span>{item.quantity} × {item.name}</span><span className="text-slate-500">{item.status || "PENDING"}</span></p>)}</div>
              <div className="mt-3 border-t pt-3 text-sm"><p><b>KOTs:</b> {order.kots?.length ? order.kots.map(kot => `${kot.station}: ${kot.status}`).join(" · ") : "Not sent to kitchen"}</p><p className="mt-1"><b>Payment:</b> {order.paymentStatus}{order.paymentMethod ? ` · ${order.paymentMethod}` : ""}</p></div>
            </div>
            <div className="flex min-w-48 flex-col gap-2">
              <p className="text-lg font-black">{money(order.totalPaise)}</p>
              {order.paymentStatus === "PENDING" && order.source === "COUNTER" && <>
                <select value={methods[order._id] || "CASH"} onChange={e => setMethods({ ...methods, [order._id]: e.target.value })} className="rounded-lg border bg-white p-2 text-sm">{settlementMethods.map(method => <option key={method} value={method}>{method}</option>)}</select>
                <button onClick={() => settle(order)} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white">Record settlement & send KOT</button>
                {!alreadyBilledOrderIds.has(String(order._id)) && <button onClick={() => beginEdit(order)} className="rounded-lg border px-3 py-2 text-sm font-bold">Edit unpaid items</button>}
              </>}
            </div>
          </div>
          {editingOrder?._id === order._id && <div className="mt-4 rounded-xl bg-slate-50 p-4">
            <h4 className="font-black">Edit unpaid order · totals recalculate from menu prices</h4>
            <div className="mt-3 space-y-2">{editLines.map((line, index) => <div key={line.menuItemId} className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate">{line.label}</span><input type="number" min="0" max="30" value={line.quantity} onChange={e => setEditLines(editLines.map((value, i) => i === index ? { ...value, quantity: e.target.value } : value))} className="w-20 rounded-lg border p-2"/><button onClick={() => setEditLines(editLines.filter((_, i) => i !== index))} className="rounded-lg border px-3 py-2 text-red-700">Remove</button></div>)}</div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row"><select value={addMenuId} onChange={e => setAddMenuId(e.target.value)} className="min-w-0 flex-1 rounded-lg border bg-white p-2"><option value="">Add an item…</option>{menu.filter(item => item.isAvailable).map(item => <option key={item._id} value={item._id}>{item.name}</option>)}</select><button onClick={addEditedItem} className="rounded-lg border px-3 py-2 font-bold">Add item</button><button onClick={saveEdit} className="rounded-lg bg-brand px-3 py-2 font-bold text-white">Save bill items</button><button onClick={() => setEditingOrder(null)} className="rounded-lg border px-3 py-2">Cancel</button></div>
          </div>}
        </article>)}</div>}
    </section>

    <section className="mb-8">
      <h2 className="text-xl font-black">Customer and counter bills</h2><p className="mt-1 text-sm text-slate-500">Combine paid orders from the same seven-hour customer session. Unpaid counter bills remain editable until settled.</p>
      <div className="mt-3 space-y-3">{billGroups.map(([sessionId, group]) => <article key={sessionId} className="flex flex-col justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm sm:flex-row sm:items-center"><div><b>{group[0].customer?.name || "Customer"}</b><p className="mt-1 text-sm text-slate-500">{group.length} unbilled order(s) · {money(group.reduce((sum, order) => sum + order.totalPaise, 0))}</p></div><button onClick={() => generateBill(group)} className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white">{group.length > 1 ? "Generate combined bill" : "Generate bill"}</button></article>)}</div>
      {bills.slice(0, 5).map(bill => <article key={bill._id} className="mt-3 rounded-2xl bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><b>{bill.invoiceNumber}</b> <Status>{bill.paymentStatus}</Status><p className="text-sm text-slate-500">{bill.customer?.name} · {bill.orderIds.length} order(s) · {new Date(bill.generatedAt).toLocaleString()}</p><p className="mt-1 text-sm">{bill.items.map(item => `${item.quantity}× ${item.name}`).join(", ")}</p></div><div className="text-right"><b>{money(bill.totalPaise)}</b>{bill.paymentStatus === "PENDING" && bill.orderIds.length === 1 && <button onClick={() => beginBillEdit(bill)} className="ml-3 rounded-lg border px-3 py-2 text-sm font-bold print:hidden">Edit unpaid bill</button>}<button onClick={() => { setCurrentBill(bill); setTimeout(printBill, 100); }} className="ml-3 rounded-lg border px-3 py-2 text-sm font-bold print:hidden">Print</button></div></div></article>)}
      {editingBill && <div className="mt-3 rounded-xl bg-white p-4 shadow-sm"><h3 className="font-black">Edit unpaid bill · {editingBill.invoiceNumber}</h3><div className="mt-3 space-y-2">{editLines.map((line, index) => <div key={`${line.menuItemId}-${index}`} className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate">{line.label}</span><input type="number" min="0" max="30" value={line.quantity} onChange={e => setEditLines(editLines.map((value, i) => i === index ? { ...value, quantity: e.target.value } : value))} className="w-20 rounded-lg border p-2"/><button onClick={() => setEditLines(editLines.filter((_, i) => i !== index))} className="rounded-lg border px-3 py-2 text-red-700">Remove</button></div>)}</div><div className="mt-3 flex flex-col gap-2 sm:flex-row"><select value={addMenuId} onChange={e => setAddMenuId(e.target.value)} className="min-w-0 flex-1 rounded-lg border bg-white p-2"><option value="">Add an item…</option>{menu.filter(item => item.isAvailable).map(item => <option key={item._id} value={item._id}>{item.name}</option>)}</select><button onClick={addEditedItem} className="rounded-lg border px-3 py-2 font-bold">Add item</button><button onClick={saveEdit} className="rounded-lg bg-brand px-3 py-2 font-bold text-white">Save bill items</button><button onClick={() => setEditingBill(null)} className="rounded-lg border px-3 py-2">Cancel</button></div></div>}
    </section>
    {currentBill && <section className="rounded-2xl border bg-white p-6"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-slate-500">RestaurantOS · Bill</p><h2 className="mt-1 text-xl font-black">{currentBill.invoiceNumber}</h2></div><button onClick={() => setCurrentBill(null)} className="rounded-lg border px-3 py-2 text-sm font-bold print:hidden">Close bill</button></div><p className="mt-4">{currentBill.customer?.name} · {currentBill.customer?.phone}</p><div className="mt-4 space-y-2 border-y py-4">{currentBill.items.map((item, index) => <div key={`${item.menuItemId}-${index}`} className="flex justify-between"><span>{item.quantity} × {item.name}</span><span>{money(item.totalPaise)}</span></div>)}</div><div className="ml-auto mt-4 max-w-xs space-y-1 text-right text-sm"><p>Subtotal {money(currentBill.subtotalPaise)}</p><p>Tax {money(currentBill.taxPaise)}</p><p className="text-lg font-black">Total {money(currentBill.totalPaise)}</p><p>{currentBill.paymentStatus === "PAID" ? `Paid · ${currentBill.paymentMethods?.join(", ") || "Verified order payment(s)"}` : "Payment due at billing counter"}</p></div></section>}
  </div>;
}

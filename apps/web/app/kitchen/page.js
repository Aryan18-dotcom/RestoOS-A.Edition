"use client";
import { useEffect, useState } from "react";
import Shell from "../../components/Shell";
import { api } from "../../lib/api";
export default function Kitchen() {
 const [orders,setOrders]=useState([]);const [error,setError]=useState("");const [role,setRole]=useState("");
 async function load(){try{const r=await api("/kitchen/orders");setOrders(r.orders||[]);}catch(e){setError(e.message);}}
 useEffect(()=>{api("/auth/me").then(r=>setRole(r.user.role)).catch(()=>{});load();const t=setInterval(load,10000);return()=>clearInterval(t);},[]);
 async function update(itemId,status){await api(`/kitchen/items/${itemId}`,{method:"PATCH",body:JSON.stringify({status})});load();}
 return <Shell title="Kitchen display"><p className="mb-5 text-sm text-slate-500">Paid and confirmed tickets. Refreshes automatically. {role === "kitchen" ? "You can update preparation statuses." : "Read-only view: only kitchen staff can change item statuses."}</p>{error&&<p className="mb-4 text-red-600">{error}</p>}<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{orders.map(o=><article key={o._id} className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="text-2xl font-black">#{String(o.tokenNumber||"—").padStart(2,"0")}</span><span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold">{o.orderStatus}</span></div><p className="mt-1 text-sm text-slate-500">{o.customer?.name} · {o.zone||o.orderType}</p><div className="mt-4 space-y-3">{o.items.map(i=><div key={i._id} className="rounded-xl bg-slate-50 p-3"><div className="font-bold">{i.quantity} × {i.name}</div><div className="mt-1 text-xs text-slate-500">{i.station} · {i.status}</div>{role === "kitchen" && <div className="mt-3 flex flex-wrap gap-2">{["PREPARING","READY"].map(s=><button key={s} onClick={()=>update(i._id,s)} className="rounded-lg border bg-white px-3 py-2 text-xs font-bold">{s}</button>)}</div>}</div>)}</div></article>)}</div></Shell>;
}

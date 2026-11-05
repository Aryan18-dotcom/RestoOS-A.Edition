"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Shell from "../../components/Shell";
import { api } from "../../lib/api";

const initialForm = { name: "", slug: "", email: "", phone: "", timezone: "Asia/Kolkata", ownerName: "", ownerEmail: "" };
const statusActions = [
  { status: "ACTIVE", label: "Activate" },
  { status: "BLOCKED", label: "Block" },
  { status: "SUSPENDED", label: "Suspend" }
];

function StatusBadge({ status }) {
  const styles = {
    ACTIVE: "bg-emerald-100 text-emerald-800",
    BLOCKED: "bg-red-100 text-red-800",
    SUSPENDED: "bg-amber-100 text-amber-800"
  };
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${styles[status] || styles.ACTIVE}`}>{status}</span>;
}

function Credentials({ credentials, user }) {
  if (!credentials) return null;
  return <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
    <h3 className="font-black">Temporary {user?.role === "owner" ? "owner" : "user"} credentials</h3>
    <p className="mt-1 text-sm">Share these securely. The user must change this password at first login.</p>
    <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
      <div><dt className="font-bold">Login ID</dt><dd className="break-all font-mono">{credentials.loginId}</dd></div>
      <div><dt className="font-bold">Temporary password</dt><dd className="break-all font-mono">{credentials.temporaryPassword}</dd></div>
    </dl>
  </div>;
}

export default function SuperAdmin() {
  const [form, setForm] = useState(initialForm);
  const [overview, setOverview] = useState(null);
  const [restaurants, setRestaurants] = useState([]);
  const [credentials, setCredentials] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [status, listing] = await Promise.all([
        api("/super-admin/status"),
        api("/super-admin/restaurants")
      ]);
      setOverview(status);
      setRestaurants(listing.restaurants);
      setError("");
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setCredentials(null);
    setSaving(true);
    try {
      const result = await api("/super-admin/restaurants", { method: "POST", body: JSON.stringify(form) });
      setCredentials({ credentials: result.owner.credentials, user: result.owner.user });
      setForm(initialForm);
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function changeRestaurantStatus(restaurant, status) {
    setError("");
    try {
      await api(`/super-admin/restaurants/${restaurant._id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
    } catch (e) { setError(e.message); }
  }

  const formFields = [
    ["name", "Restaurant name", true],
    ["slug", "Unique URL slug", true],
    ["email", "Restaurant contact email", false],
    ["phone", "Restaurant phone", false],
    ["timezone", "IANA timezone", true],
    ["ownerName", "Owner full name", true],
    ["ownerEmail", "Owner email", false]
  ];

  return <Shell title="Super admin · Platform overview">
    {error && <p role="alert" className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}

    <section aria-label="System status" className="mb-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {[
        ["API", overview?.api || "—"],
        ["Database", overview?.database || "—"],
        ["Restaurants", overview?.counts?.restaurants ?? "—"],
        ["Active restaurants", overview?.counts?.activeRestaurants ?? "—"],
        ["Users / orders", `${overview?.counts?.users ?? "—"} / ${overview?.counts?.orders ?? "—"}`]
      ].map(([label, value]) => <article key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p>
        <p className={`mt-2 text-xl font-black ${["API", "Database"].includes(label) ? (value === "CONNECTED" || value === "OPERATIONAL" ? "text-emerald-700" : "text-amber-700") : ""}`}>{value}</p>
      </article>)}
    </section>
    {overview && <p className="mb-7 text-xs text-slate-500">Environment: {overview.nodeEnv} · API uptime: {Math.floor(overview.uptimeSeconds / 60)} min</p>}

    <section className="rounded-2xl bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-xl font-black">Register a restaurant</h2>
      <p className="mt-1 text-sm text-slate-500">A linked owner account will be created. Its temporary credentials are shown once after registration.</p>
      <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
        {formFields.map(([key, label, required]) => <label key={key} className="text-sm font-semibold">
          {label}
          <input required={required} type={key.toLowerCase().includes("email") ? "email" : "text"} value={form[key]}
            onChange={e => setForm({ ...form, [key]: e.target.value })}
            className="mt-1 w-full rounded-xl border border-slate-200 p-3 outline-none focus:border-brand"/>
        </label>)}
        <button disabled={saving} className="rounded-xl bg-brand p-3 font-bold text-white disabled:opacity-50 sm:col-span-2">
          {saving ? "Registering…" : "Register restaurant and create owner"}
        </button>
      </form>
      <Credentials credentials={credentials?.credentials} user={credentials?.user}/>
    </section>

    <section className="mt-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><h2 className="text-xl font-black">All restaurants</h2><p className="mt-1 text-sm text-slate-500">Select a restaurant to inspect staff and operational data.</p></div>
        <button onClick={load} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold">Refresh</button>
      </div>
      {loading ? <p className="rounded-2xl bg-white p-6 text-slate-500">Loading restaurants…</p> :
        restaurants.length === 0 ? <p className="rounded-2xl bg-white p-6 text-slate-500">No restaurants registered yet.</p> :
          <div className="space-y-3">{restaurants.map(restaurant => <article key={restaurant._id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <Link href={`/super-admin/restaurants/${restaurant._id}`} className="min-w-0 flex-1 hover:text-brand">
                <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-black">{restaurant.name}</h3><StatusBadge status={restaurant.status}/></div>
                <p className="mt-1 text-sm text-slate-500">{restaurant.slug} · {restaurant.userCount} users · {restaurant.ownerCount} owners</p>
                <p className="mt-1 truncate text-xs text-slate-400">{restaurant._id}{restaurant.email ? ` · ${restaurant.email}` : ""}</p>
              </Link>
              <div className="flex flex-wrap gap-2">{statusActions.filter(action => action.status !== restaurant.status).map(action =>
                <button key={action.status} onClick={() => changeRestaurantStatus(restaurant, action.status)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold hover:bg-slate-50">{action.label}</button>
              )}</div>
            </div>
          </article>)}</div>}
    </section>
  </Shell>;
}

"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Shell from "../../../../components/Shell";
import { api } from "../../../../lib/api";

const roles = ["owner", "manager", "cashier", "waiter", "kitchen"];
const statuses = ["ACTIVE", "BLOCKED", "SUSPENDED"];

function StatusBadge({ status }) {
  const styles = { ACTIVE: "bg-emerald-100 text-emerald-800", BLOCKED: "bg-red-100 text-red-800", SUSPENDED: "bg-amber-100 text-amber-800" };
  return <span className={`rounded-full px-3 py-1 text-xs font-black ${styles[status] || styles.ACTIVE}`}>{status}</span>;
}

function CredentialCard({ result }) {
  if (!result) return null;
  return <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
    <h3 className="font-black">Temporary {result.user.role} credentials</h3>
    <p className="mt-1 text-sm">Share securely. The user must change this password at first login.</p>
    <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
      <div><dt className="font-bold">Login ID</dt><dd className="break-all font-mono">{result.credentials.loginId}</dd></div>
      <div><dt className="font-bold">Temporary password</dt><dd className="break-all font-mono">{result.credentials.temporaryPassword}</dd></div>
    </dl>
  </div>;
}

export default function RestaurantDetails() {
  const { tenantId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", role: "manager" });

  const load = useCallback(async () => {
    try {
      const result = await api(`/super-admin/restaurants/${tenantId}`);
      setData(result);
      setError("");
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  async function changeRestaurantStatus(status) {
    setError("");
    try {
      await api(`/super-admin/restaurants/${tenantId}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
    } catch (e) { setError(e.message); }
  }

  async function changeUserStatus(user, status) {
    setError("");
    try {
      await api(`/super-admin/restaurants/${tenantId}/users/${user._id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
    } catch (e) { setError(e.message); }
  }

  async function addUser(e) {
    e.preventDefault();
    setError("");
    setCredentials(null);
    setSaving(true);
    try {
      const result = await api(`/super-admin/restaurants/${tenantId}/users`, { method: "POST", body: JSON.stringify(form) });
      setCredentials(result);
      setForm({ name: "", email: "", role: "manager" });
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  if (loading) return <Shell title="Restaurant details"><p className="rounded-2xl bg-white p-6 text-slate-500">Loading restaurant…</p></Shell>;
  if (!data) return <Shell title="Restaurant details"><p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error || "Restaurant not found"}</p><Link href="/super-admin" className="mt-4 inline-block font-bold text-brand">Back to platform overview</Link></Shell>;

  const { restaurant, users, stats } = data;
  const isActive = restaurant.status === "ACTIVE";
  return <Shell title={`Restaurant · ${restaurant.name}`}>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <Link href="/super-admin" className="font-bold text-brand hover:underline">← All restaurants</Link>
      <StatusBadge status={restaurant.status}/>
    </div>
    {error && <p role="alert" className="mb-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}

    <section className="rounded-2xl bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><h2 className="text-2xl font-black">{restaurant.name}</h2><p className="mt-1 text-slate-500">{restaurant.legalName || "Legal name not provided"}</p></div>
        <div className="flex flex-wrap gap-2">{statuses.filter(status => status !== restaurant.status).map(status =>
          <button key={status} onClick={() => changeRestaurantStatus(status)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold hover:bg-slate-50">
            {status === "ACTIVE" ? "Reactivate" : status === "BLOCKED" ? "Block restaurant" : "Suspend restaurant"}
          </button>
        )}</div>
      </div>
      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {[["Restaurant ID", restaurant._id], ["Slug", restaurant.slug], ["Contact email", restaurant.email], ["Phone", restaurant.phone], ["Address", restaurant.address], ["Timezone", restaurant.timezone], ["Currency", restaurant.currency], ["GSTIN", restaurant.gstin], ["UPI ID", restaurant.upiId], ["Tax enabled", restaurant.settings?.taxEnabled ? "Yes" : "No"], ["Service charge enabled", restaurant.settings?.serviceChargeEnabled ? "Yes" : "No"], ["Created", restaurant.createdAt ? new Date(restaurant.createdAt).toLocaleString() : "—"]].map(([label, value]) =>
          <div key={label}><dt className="font-bold text-slate-500">{label}</dt><dd className="mt-1 break-words font-semibold">{value || "—"}</dd></div>
        )}
      </dl>
    </section>

    <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {[["Total users", stats.userCount], ...roles.map(role => [role, stats.usersByRole[role] || 0]), ["Orders", stats.orders], ["Menu items", stats.menuItems], ["Categories", stats.categories]].map(([label, value]) =>
        <article key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-bold uppercase text-slate-500">{label}</p><p className="mt-2 text-2xl font-black">{value}</p>
        </article>
      )}
    </section>

    <section className="mt-8">
      <div className="mb-4"><h2 className="text-xl font-black">Restaurant users</h2><p className="mt-1 text-sm text-slate-500">Block or suspend access, or reactivate users. Temporary passwords are only shown when created.</p></div>
      <div className="space-y-3">{users.length === 0 ? <p className="rounded-2xl bg-white p-5 text-slate-500">No users found.</p> : users.map(user =>
        <article key={user._id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h3 className="font-black">{user.name}</h3><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold capitalize">{user.role}</span><StatusBadge status={user.status}/></div>
              <p className="mt-1 break-all text-sm text-slate-600">Login ID: <span className="font-mono">{user.loginId}</span>{user.email ? ` · ${user.email}` : ""}</p>
              <p className="mt-1 text-xs text-slate-500">{user.mustChangePassword ? "Password change required at first login" : "Password setup complete"} · Last login: {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"}</p>
            </div>
            <div className="flex flex-wrap gap-2">{statuses.filter(status => status !== user.status).map(status =>
              <button key={status} onClick={() => changeUserStatus(user, status)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold hover:bg-slate-50">
                {status === "ACTIVE" ? "Reactivate" : status === "BLOCKED" ? "Block" : "Suspend"}
              </button>
            )}</div>
          </div>
        </article>
      )}</div>
    </section>

    <section className="mt-8 rounded-2xl bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-xl font-black">Add a restaurant user</h2>
      <p className="mt-1 text-sm text-slate-500">A temporary login ID and password will be generated. They must change the password at first login.</p>
      {!isActive && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Reactivate the restaurant before adding users.</p>}
      <form onSubmit={addUser} className="mt-5 grid gap-4 sm:grid-cols-3">
        <label className="text-sm font-semibold">Full name<input required minLength={2} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-xl border p-3"/></label>
        <label className="text-sm font-semibold">Email (optional)<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="mt-1 w-full rounded-xl border p-3"/></label>
        <label className="text-sm font-semibold">Role<select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-3">{roles.map(role => <option key={role} value={role}>{role[0].toUpperCase() + role.slice(1)}</option>)}</select></label>
        <button disabled={saving || !isActive} className="rounded-xl bg-brand p-3 font-bold text-white disabled:opacity-50 sm:col-span-3">{saving ? "Creating user…" : "Create user"}</button>
      </form>
      <CredentialCard result={credentials}/>
    </section>
  </Shell>;
}

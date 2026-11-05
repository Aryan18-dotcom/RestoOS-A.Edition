"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LayoutDashboard, ChefHat, Users, Store, Receipt, Utensils, LogOut, ShieldCheck, LoaderCircle, MessageCircle } from "lucide-react";
import { api } from "../lib/api";

const ROLE_HOME = {
  super_admin: "/super-admin",
  owner: "/dashboard",
  manager: "/dashboard",
  cashier: "/billing",
  waiter: "/waiter",
  kitchen: "/kitchen",
};
const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, roles: ["owner", "manager"] },
  { href: "/super-admin", label: "Platform admin", icon: Store, roles: ["super_admin"] },
  { href: "/super-admin/whatsapp", label: "WhatsApp automation", icon: MessageCircle, roles: ["super_admin"] },
  { href: "/kitchen", label: "Kitchen display", icon: ChefHat, roles: ["owner", "manager", "kitchen"] },
  { href: "/waiter", label: "Waiter workspace", icon: Users, roles: ["owner", "manager", "waiter"] },
  { href: "/menu-admin", label: "Menu management", icon: Utensils, roles: ["owner", "manager"] },
  { href: "/billing", label: "Billing counter", icon: Receipt, roles: ["owner", "cashier"] },
];
const PAGE_ACCESS = {
  "/dashboard": ["owner", "manager"],
  "/super-admin": ["super_admin"],
  "/kitchen": ["owner", "manager", "kitchen"],
  "/waiter": ["owner", "manager", "waiter"],
  "/menu-admin": ["owner", "manager"],
  "/billing": ["owner", "cashier"],
};

export function getRoleHome(role) { return ROLE_HOME[role] || "/login"; }

export default function Shell({ title, children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const allowedRoles = pathname.startsWith("/super-admin") ? PAGE_ACCESS["/super-admin"] : (PAGE_ACCESS[pathname] || []);
  const allowed = !!user && allowedRoles.includes(user.role);
  const links = useMemo(() => NAV.filter(item => item.roles.includes(user?.role)), [user?.role]);

  useEffect(() => {
    let active = true;
    api("/auth/me").then(data => {
      if (!active) return;
      const current = data.user;
      if (current.mustChangePassword) { router.replace("/change-password"); return; }
      setUser(current);
      if (!allowedRoles.includes(current.role)) router.replace(getRoleHome(current.role));
    }).catch(err => {
      if (!active) return;
      if (err.status === 403 && err.code === "PASSWORD_CHANGE_REQUIRED") router.replace("/change-password");
      else router.replace("/login");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [pathname, router]);

  async function logout() {
    setSigningOut(true);
    try { await api("/auth/logout", { method: "POST" }); }
    finally { router.replace("/login"); router.refresh(); }
  }

  if (loading || !allowed) return <main className="grid min-h-screen place-items-center p-6"><div className="flex flex-col items-center gap-3 text-center"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-950 text-white"><LoaderCircle className="animate-spin" size={22}/></div><p className="text-sm font-semibold text-slate-500">{loading ? "Verifying your workspace access…" : "Redirecting to your authorized workspace…"}</p></div></main>;

  return <div className="min-h-screen md:flex">
    <aside className="hidden w-72 shrink-0 flex-col border-r border-slate-200 bg-white p-5 md:flex">
      <Link href={getRoleHome(user.role)} className="mb-8 flex items-center gap-3 px-2"><span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-950 text-white"><Utensils size={19}/></span><span className="text-xl font-black tracking-tight">Restaurant<span className="text-brand">OS</span></span></Link>
      <div className="mb-3 px-3 text-[10px] font-black uppercase tracking-[.2em] text-slate-400">Your workspace</div>
      <nav className="flex-1 space-y-1">{links.map(({href,label,icon:Icon})=><Link key={href} href={href} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold transition ${pathname===href||(href==="/super-admin"&&pathname.startsWith("/super-admin/"))?"bg-slate-950 text-white shadow-sm":"text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}><Icon size={18}/>{label}</Link>)}</nav>
      <div className="mt-5 rounded-2xl bg-slate-50 p-4"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500"><ShieldCheck size={14}/> Signed in as</div><p className="mt-2 truncate font-black text-slate-900">{user.name}</p><p className="mt-1 text-xs capitalize text-slate-500">{user.role.replaceAll("_"," ")}</p><button onClick={logout} disabled={signingOut} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50"><LogOut size={16}/>{signingOut?"Signing out…":"Sign out"}</button></div>
    </aside>
    <main className="min-w-0 flex-1 p-4 sm:p-6 md:p-9"><div className="mx-auto max-w-7xl">
      <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between md:mb-8 md:border-0 md:bg-transparent md:p-0 md:shadow-none"><div><p className="text-[10px] font-black uppercase tracking-[.22em] text-brand">RestaurantOS workspace</p><h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">{title}</h1></div><div className="flex items-center justify-between gap-3 md:justify-end"><div className="text-right"><p className="text-sm font-extrabold">{user.name}</p><p className="text-xs capitalize text-slate-500">{user.role.replaceAll("_"," ")}</p></div><button onClick={logout} disabled={signingOut} aria-label="Sign out" className="rounded-xl border border-slate-200 bg-white p-3 text-slate-600 hover:bg-slate-100 md:hidden"><LogOut size={18}/></button></div></header>
      <nav className="mb-6 flex gap-2 overflow-x-auto pb-1 md:hidden">{links.map(({href,label,icon:Icon})=><Link key={href} href={href} className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold ${pathname===href||(href==="/super-admin"&&pathname.startsWith("/super-admin/"))?"bg-slate-950 text-white":"border border-slate-200 bg-white text-slate-600"}`}><Icon size={15}/>{label}</Link>)}</nav>
      {children}
    </div></main>
  </div>;
}

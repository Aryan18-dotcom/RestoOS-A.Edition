"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";
import { getRoleHome } from "../../components/Shell";
export default function LoginPage() {
  const [loginId,setLoginId]=useState(""); const [password,setPassword]=useState(""); const [error,setError]=useState(""); const [busy,setBusy]=useState(false); const router=useRouter();
  async function submit(e){e.preventDefault();setBusy(true);setError("");try{const r=await api("/auth/login",{method:"POST",body:JSON.stringify({loginId,password})});router.push(r.user.mustChangePassword?"/change-password":getRoleHome(r.user.role));}catch(x){setError(x.message);}finally{setBusy(false);}}
  return <main className="grid min-h-screen place-items-center p-5"><form onSubmit={submit} className="w-full max-w-md rounded-3xl bg-white p-8 shadow-soft"><p className="text-xs font-black uppercase tracking-widest text-brand">RestaurantOS</p><h1 className="mt-3 text-3xl font-black">Welcome back</h1><p className="mt-2 text-sm text-slate-500">Sign in to your restaurant workspace.</p>{error&&<p className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<label className="mt-6 block text-sm font-bold">Login ID<input value={loginId} onChange={e=>setLoginId(e.target.value)} className="mt-2 w-full rounded-xl border p-3 outline-none focus:border-brand" autoComplete="username" required/></label><label className="mt-4 block text-sm font-bold">Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} className="mt-2 w-full rounded-xl border p-3 outline-none focus:border-brand" autoComplete="current-password" required/></label><button disabled={busy} className="mt-6 w-full rounded-xl bg-slate-950 p-3 font-bold text-white disabled:opacity-50">{busy?"Signing in…":"Sign in"}</button></form></main>;
}

import Link from "next/link";
export default function Home() {
  return <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white">
    <div className="max-w-2xl text-center"><div className="mb-5 text-sm font-bold uppercase tracking-[.35em] text-violet-300">RestaurantOS</div><h1 className="text-5xl font-black tracking-tight md:text-7xl">Every order.<br/><span className="text-violet-300">One control room.</span></h1><p className="mx-auto mt-6 max-w-xl text-slate-300">Token ordering, kitchen operations, billing and restaurant administration in one real-time platform.</p><Link href="/login" className="mt-9 inline-flex rounded-xl bg-violet-500 px-6 py-3 font-bold hover:bg-violet-400">Open workspace</Link></div>
  </main>;
}

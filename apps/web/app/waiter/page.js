import Shell from "../../components/Shell";
export default function Waiter() {
 return <Shell title="Waiter workspace"><div className="grid gap-4 md:grid-cols-3">{[["Active tokens","Monitor orders awaiting pickup or service."],["Tables & zones","Associate a dine-in order with a service area."],["Ready alerts","Receive kitchen-ready notifications."]].map(([a,b])=><div key={a} className="rounded-2xl bg-white p-6 shadow-sm"><h2 className="font-black">{a}</h2><p className="mt-2 text-sm text-slate-500">{b}</p></div>)}</div></Shell>;
}

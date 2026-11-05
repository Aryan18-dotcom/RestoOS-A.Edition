"use client";
import { useCallback, useEffect, useState } from "react";
import Shell from "../../components/Shell";
import { api } from "../../lib/api";

const blankItem = { name: "", description: "", categoryId: "", price: "", gstRate: 5, foodType: "VEG", station: "MAIN", isAvailable: true };

export default function MenuAdmin() {
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [categoryName, setCategoryName] = useState("");
  const [form, setForm] = useState(blankItem);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api("/menu/admin");
      setCategories(result.categories);
      setItems(result.items);
      setError("");
      setForm(current => ({ ...current, categoryId: current.categoryId || result.categories[0]?._id || "" }));
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addCategory(e) {
    e.preventDefault();
    setError(""); setNotice("");
    try {
      const result = await api("/menu/categories", { method: "POST", body: JSON.stringify({ name: categoryName, sortOrder: categories.length }) });
      setCategoryName("");
      setNotice(`Category "${result.category.name}" created.`);
      await load();
    } catch (e) { setError(e.message); }
  }

  async function saveItem(e) {
    e.preventDefault();
    if (!form.categoryId) return setError("Create or select a category first.");
    setSaving(true); setError(""); setNotice("");
    const body = {
      ...form, pricePaise: Math.round(Number(form.price) * 100), gstRate: Number(form.gstRate)
    };
    delete body.price;
    try {
      if (editingId) {
        await api(`/menu/items/${editingId}`, { method: "PATCH", body: JSON.stringify(body) });
        setNotice("Menu item updated.");
      } else {
        await api("/menu/items", { method: "POST", body: JSON.stringify(body) });
        setNotice("Menu item created.");
      }
      setEditingId(null);
      setForm({ ...blankItem, categoryId: categories[0]?._id || "" });
      await load();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  function editItem(item) {
    setEditingId(item._id);
    setForm({
      name: item.name, description: item.description || "", categoryId: item.categoryId,
      price: (item.pricePaise / 100).toFixed(2), gstRate: item.gstRate,
      foodType: item.foodType, station: item.station || "MAIN", isAvailable: item.isAvailable
    });
    setNotice("");
  }

  async function deleteItem(item) {
    if (!window.confirm(`Delete "${item.name}" from the menu? Existing order records remain unchanged.`)) return;
    setError(""); setNotice("");
    try {
      await api(`/menu/items/${item._id}`, { method: "DELETE" });
      if (editingId === item._id) { setEditingId(null); setForm(blankItem); }
      setNotice("Menu item deleted.");
      await load();
    } catch (e) { setError(e.message); }
  }

  return <Shell title="Menu management">
    {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {notice && <p className="mb-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p>}

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <section className="space-y-6">
        <form onSubmit={addCategory} className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black">Add category</h2>
          <div className="mt-4 flex gap-2"><input required minLength={1} maxLength={80} value={categoryName} onChange={e => setCategoryName(e.target.value)} placeholder="e.g. Starters" className="min-w-0 flex-1 rounded-xl border p-3"/><button className="rounded-xl bg-slate-950 px-4 font-bold text-white">Add</button></div>
          <p className="mt-3 text-xs text-slate-500">{categories.length} categories</p>
        </form>

        <form onSubmit={saveItem} className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black">{editingId ? "Update menu item" : "Add menu item"}</h2>
          <div className="mt-4 space-y-3">
            <label className="block text-sm font-bold">Name<input required maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-xl border p-3"/></label>
            <label className="block text-sm font-bold">Description<input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="mt-1 w-full rounded-xl border p-3"/></label>
            <label className="block text-sm font-bold">Category<select required value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-3"><option value="">Select category</option>{categories.map(category => <option key={category._id} value={category._id}>{category.name}</option>)}</select></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm font-bold">Price (₹)<input type="number" min="0" step="0.01" required value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className="mt-1 w-full rounded-xl border p-3"/></label>
              <label className="text-sm font-bold">GST<select value={form.gstRate} onChange={e => setForm({ ...form, gstRate: Number(e.target.value) })} className="mt-1 w-full rounded-xl border bg-white p-3">{[0, 5, 12, 18, 28].map(rate => <option key={rate} value={rate}>{rate}%</option>)}</select></label>
              <label className="text-sm font-bold">Food type<select value={form.foodType} onChange={e => setForm({ ...form, foodType: e.target.value })} className="mt-1 w-full rounded-xl border bg-white p-3">{["VEG", "NON_VEG", "EGG"].map(type => <option key={type}>{type}</option>)}</select></label>
              <label className="text-sm font-bold">Kitchen station<input required value={form.station} onChange={e => setForm({ ...form, station: e.target.value })} className="mt-1 w-full rounded-xl border p-3"/></label>
            </div>
            {editingId && <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.isAvailable} onChange={e => setForm({ ...form, isAvailable: e.target.checked })}/>Available for customer ordering</label>}
            <div className="flex gap-2"><button disabled={saving || !categories.length} className="flex-1 rounded-xl bg-brand p-3 font-bold text-white disabled:opacity-50">{saving ? "Saving…" : editingId ? "Save changes" : "Create item"}</button>{editingId && <button type="button" onClick={() => { setEditingId(null); setForm({ ...blankItem, categoryId: categories[0]?._id || "" }); }} className="rounded-xl border px-4 font-bold">Cancel</button>}</div>
          </div>
        </form>
      </section>

      <section><h2 className="mb-4 text-xl font-black">Current menu · {items.length} items</h2>
        <div className="space-y-3">{items.map(item => <article key={item._id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-black">{item.name}</h3><span className={`rounded-full px-2 py-1 text-[10px] font-black ${item.isAvailable ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>{item.isAvailable ? "AVAILABLE" : "HIDDEN"}</span></div><p className="mt-1 text-sm text-slate-500">₹{(item.pricePaise / 100).toFixed(2)} · GST {item.gstRate}% · {item.foodType} · {item.station}</p><p className="mt-1 text-xs text-slate-400">{categories.find(category => category._id === item.categoryId)?.name || "Category unavailable"}</p></div><div className="flex gap-2"><button onClick={() => editItem(item)} className="rounded-lg border px-3 py-2 text-sm font-bold">Edit</button><button onClick={() => deleteItem(item)} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-red-700">Delete</button></div></div>
        </article>)}</div>
      </section>
    </div>
  </Shell>;
}

"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export default function PricingPage() {
  const [pricePerM2, setPricePerM2] = useState("150.00");
  const [brandingBase, setBrandingBase] = useState("5000.00");
  const [multiplier, setMultiplier] = useState("1.0");
  const [changeRounds, setChangeRounds] = useState("2");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    async function load() {
      const res = await apiFetch("/api/v1/admin/pricing");
      if (res.ok) {
        const data = await res.json();
        setPricePerM2(data.price_per_m2_base);
        setBrandingBase(data.branding_base_price);
        setMultiplier(data.integral_multiplier);
        setChangeRounds(String(data.default_change_rounds));
      }
    }
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    setIsError(false);
    try {
      const res = await apiFetch("/api/v1/admin/pricing", {
        method: "PUT",
        body: JSON.stringify({
          price_per_m2_base: pricePerM2,
          branding_base_price: brandingBase,
          integral_multiplier: multiplier,
          default_change_rounds: parseInt(changeRounds, 10),
        }),
      });
      if (res.ok) {
        setMessage("Configuración de precios actualizada correctamente.");
      } else {
        const data = await res.json().catch(() => ({}));
        setIsError(true);
        setMessage(data.detail || "Error al actualizar");
      }
    } catch {
      setIsError(true);
      setMessage("Error de conexión con el servidor");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="brief-editorial space-y-8">
      <div className="border-b border-stone-900/15 pb-6">
        <p className="type-tech text-stone-500">Tarifario base del estudio</p>
        <h1 className="type-title mt-2 text-3xl text-stone-900 md:text-4xl">
          Configuración de precios
        </h1>
        <p className="type-editorial mt-1.5 text-sm italic text-stone-600">
          Estos parámetros alimentan el cotizador automático de propuestas para
          nuevos leads.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="max-w-3xl space-y-6 rounded-2xl border border-stone-900/15 bg-background p-6 shadow-editorial md:p-8"
      >
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="type-tech text-stone-600">
              Precio base por m² (interiorismo)
            </span>
            <input
              type="number"
              step="0.01"
              value={pricePerM2}
              onChange={(e) => setPricePerM2(e.target.value)}
              className="min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 font-mono text-sm tabular-nums text-stone-900 focus:border-stone-900/45"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="type-tech text-stone-600">
              Precio base branding
            </span>
            <input
              type="number"
              step="0.01"
              value={brandingBase}
              onChange={(e) => setBrandingBase(e.target.value)}
              className="min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 font-mono text-sm tabular-nums text-stone-900 focus:border-stone-900/45"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="type-tech text-stone-600">
              Multiplicador integral
            </span>
            <input
              type="number"
              step="0.01"
              value={multiplier}
              onChange={(e) => setMultiplier(e.target.value)}
              className="min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 font-mono text-sm tabular-nums text-stone-900 focus:border-stone-900/45"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="type-tech text-stone-600">
              Rondas de cambio por defecto
            </span>
            <input
              type="number"
              value={changeRounds}
              onChange={(e) => setChangeRounds(e.target.value)}
              className="min-h-[44px] rounded-lg border border-stone-900/15 bg-background px-3.5 font-mono text-sm tabular-nums text-stone-900 focus:border-stone-900/45"
            />
          </label>
        </div>

        {message && (
          <p
            className={`type-ui rounded-xl border px-4 py-3 text-sm ${
              isError
                ? "border-stone-900/15 bg-surface/75 text-stone-800"
                : "border-[#5F7161]/35 bg-[#EEF2EC]/75 text-[#44544A]"
            }`}
          >
            {message}
          </p>
        )}

        <div className="flex justify-end border-t border-stone-900/10 pt-5">
          <button
            type="submit"
            disabled={saving}
            className="type-ui min-h-[44px] rounded-lg bg-stone-900 px-5 py-2 text-xs text-background transition-colors hover:bg-stone-800 disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar configuración ↗"}
          </button>
        </div>
      </form>
    </section>
  );
}

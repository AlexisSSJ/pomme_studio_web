"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export default function PricingPage() {
  const [pricePerM2, setPricePerM2] = useState("150.00");
  const [brandingBase, setBrandingBase] = useState("5000.00");
  const [multiplier, setMultiplier] = useState("1.0");
  const [changeRounds, setChangeRounds] = useState("2");
  const [message, setMessage] = useState("");

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
    setMessage("");
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
      setMessage("Pricing actualizado");
    } else {
      const data = await res.json().catch(() => ({}));
      setMessage(data.detail || "Error al actualizar");
    }
  }

  return (
    <section>
      <h1 className="text-xl tracking-tightest">Configuración de precios</h1>

      <form onSubmit={handleSubmit} className="mt-4 border border-border bg-surface p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="label-mono">Precio base por m²</span>
            <input
              type="number"
              step="0.01"
              value={pricePerM2}
              onChange={(e) => setPricePerM2(e.target.value)}
              className="min-h-[44px] border border-border bg-background px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-mono">Precio base branding</span>
            <input
              type="number"
              step="0.01"
              value={brandingBase}
              onChange={(e) => setBrandingBase(e.target.value)}
              className="min-h-[44px] border border-border bg-background px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-mono">Multiplicador integral</span>
            <input
              type="number"
              step="0.01"
              value={multiplier}
              onChange={(e) => setMultiplier(e.target.value)}
              className="min-h-[44px] border border-border bg-background px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-mono">Rondas de cambio por defecto</span>
            <input
              type="number"
              value={changeRounds}
              onChange={(e) => setChangeRounds(e.target.value)}
              className="min-h-[44px] border border-border bg-background px-3 text-sm"
            />
          </label>
        </div>
        <button type="submit" className="btn-brutal mt-4">
          Guardar <span className="btn-brutal__arrow" aria-hidden="true">↗</span>
        </button>
        {message && <p className="mt-2 text-sm">{message}</p>}
      </form>
    </section>
  );
}

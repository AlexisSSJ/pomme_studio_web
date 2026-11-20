const services = [
  {
    index: '01',
    title: 'Branding',
    description:
      'Identidad, naming, sistema visual y manuales de marca listos para operar.',
  },
  {
    index: '02',
    title: 'Dirección creativa',
    description:
      'Concepto, narrativa y criterio estético para cada punto de contacto.',
  },
  {
    index: '03',
    title: 'Documentación ejecutiva',
    description:
      'Planos, detalles, fichas técnicas y alcances preparados para construir.',
  },
  {
    index: '04',
    title: 'Especificaciones FF&E',
    description:
      'Selección de mobiliario, materiales e iluminación, con fichas y partidas.',
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1120px] flex-col px-4 pb-10 pt-2 sm:px-6">
      <header className="flex min-h-[56px] flex-wrap items-center justify-between gap-2 border-b border-border py-3">
        <span className="text-[15px] font-semibold tracking-tightest">
          Pomme Studio
        </span>
        <span className="label-mono">Estudio de branding &amp; interiores</span>
      </header>

      {/* Hero: retícula de 1px sobre tinta. */}
      <section
        aria-labelledby="hero-title"
        className="grid-brutal grid-brutal--2 mt-8"
      >
        <div className="flex flex-col justify-between gap-8 p-5 sm:p-8">
          <p className="label-mono">01 / Estudio</p>
          <h1
            id="hero-title"
            className="max-w-[18ch] text-[40px] leading-[0.95] tracking-tightest sm:text-[56px]"
          >
            Diseño de marca y espacios que se habitan.
          </h1>
          <p className="max-w-[46ch] text-sm leading-relaxed">
            Pomme Studio firma proyectos de branding y diseño de interiores:
            del concepto a la documentación ejecutiva, con un sistema visual
            sobrio, preciso y verificable.
          </p>
          <div className="flex flex-wrap items-stretch gap-3">
            <a href="#servicios" className="btn-brutal">
              Ver servicios
              <span className="btn-brutal__arrow" aria-hidden="true">
                ↗
              </span>
            </a>
            <a
              href="/diagnostico"
              className="btn-brutal btn-brutal--surface"
            >
              Hablemos del proyecto
              <span className="btn-brutal__arrow" aria-hidden="true">
                ↗
              </span>
            </a>
          </div>
        </div>

        <div className="flex flex-col">
          <div className="border-b border-border p-5 sm:p-8">
            <p className="label-mono">Alcance</p>
            <p className="mt-3 text-sm leading-relaxed">
              Vendemos diseño, no ejecución de obra. Cada entregable define
              intención, materiales y especificación para que un equipo
              externo lo materialice sin ambigüedades.
            </p>
          </div>

          <dl className="grid flex-1 grid-cols-1 sm:grid-cols-2 gap-px bg-border">
            {[
              ['2026', 'Nueva etapa'],
              ['04', 'Líneas de servicio'],
              ['100%', 'Diseño documentado'],
              ['1:1', 'Acompañamiento'],
            ].map(([value, label]) => (
              <div key={label} className="bg-background p-5 sm:p-6">
                <dt className="label-mono opacity-60">{label}</dt>
                <dd className="mt-2 text-2xl tracking-tightest">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Servicios: grid de 1px, colapsa a 1fr en móvil. */}
      <section id="servicios" aria-labelledby="servicios-title" className="mt-12">
        <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
          <h2 id="servicios-title" className="text-xl tracking-tightest">
            Servicios
          </h2>
          <p className="label-mono">02 / Alcance</p>
        </div>

        <div className="grid-brutal grid-brutal--4 mt-6">
          {services.map((service) => (
            <article
              key={service.index}
              className="flex min-h-[220px] flex-col justify-between gap-6 p-5"
            >
              <p className="label-mono">{service.index}</p>
              <div className="flex flex-col gap-3">
                <h3 className="text-lg leading-tight tracking-tightest">
                  {service.title}
                </h3>
                <p className="text-sm leading-relaxed">{service.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section
        id="contacto"
        aria-labelledby="contacto-title"
        className="mt-12 border border-border bg-surface p-5 sm:p-8"
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-3">
            <p className="label-mono">03 / Contacto</p>
            <h2
              id="contacto-title"
              className="max-w-[22ch] text-[28px] leading-[1.05] tracking-tightest sm:text-[36px]"
            >
              ¿Empezamos con una conversación?
            </h2>
            <p className="max-w-[46ch] text-sm leading-relaxed">
              Cuéntanos el reto. Respondemos con un alcance claro, fases y
              entregables por escrito.
            </p>
          </div>
          <a
            href="mailto:hola@pommestudio.com"
            className="btn-brutal w-full sm:w-auto"
          >
            hola@pommestudio.com
            <span className="btn-brutal__arrow" aria-hidden="true">
              ↗
            </span>
          </a>
        </div>
      </section>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 pb-2">
        <p className="label-mono">Pomme Studio</p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="mailto:hola@pommestudio.com"
            className="label-mono opacity-60 hover:opacity-100"
          >
            hola@pommestudio.com
          </a>
          <p className="label-mono opacity-60">
            Branding · Interiores · FF&amp;E
          </p>
        </div>
      </footer>
    </main>
  );
}

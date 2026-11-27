"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, MessageCircle, Columns3, User } from "lucide-react";
import { Input } from "@/components/ui/input";

interface Resultado {
  id: string;
  name: string;
  phone: string | null;
  pedido: string | null;
}

const enlacePipeline = (r: Resultado) =>
  `/pipeline?contactId=${r.id}&search=${encodeURIComponent(r.name || r.phone || "")}`;

/**
 * Barra de búsqueda superior (27/11: antes solo guardaba el texto). Busca clientes por nombre,
 * celular o N° de pedido y abre su tarjeta del Pipeline, su chat o su ficha.
 */
export function BuscadorGlobal() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [activo, setActivo] = useState(0);
  const cajaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl/⌘ + K enfoca la barra.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (cajaRef.current && !cajaRef.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 2) {
      setResultados([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setCargando(true);
      try {
        const res = await fetch(`/api/buscar?q=${encodeURIComponent(texto)}`, { signal: ctrl.signal });
        const json = (await res.json()) as { resultados?: Resultado[] };
        setResultados(json.resultados ?? []);
        setActivo(0);
        setAbierto(true);
      } catch {
        // búsqueda cancelada o sin red
      } finally {
        setCargando(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const ir = (href: string) => {
    setAbierto(false);
    router.push(href);
  };

  return (
    <div ref={cajaRef} className="relative w-full max-w-[440px]">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <Input
        ref={inputRef}
        placeholder="Buscar cliente, celular o N° de pedido..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => resultados.length && setAbierto(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setAbierto(false);
          if (!resultados.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActivo((a) => Math.min(a + 1, resultados.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActivo((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            ir(enlacePipeline(resultados[activo]));
          }
        }}
        className="pl-9 pr-12 h-9 bg-muted/30 border-transparent hover:bg-muted/50 focus:bg-card focus:border-border focus:ring-2 focus:ring-primary/20 text-[13px] transition-colors"
      />
      <kbd className="hidden sm:inline-flex absolute right-3 top-1/2 -translate-y-1/2 h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
        ⌘K
      </kbd>

      {abierto && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border border-border bg-card shadow-lg overflow-hidden">
          {resultados.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              {cargando ? "Buscando…" : "Sin resultados. Prueba con otra parte del nombre, el celular o el N° de pedido."}
            </p>
          ) : (
            <ul className="max-h-[360px] overflow-y-auto py-1">
              {resultados.map((r, i) => (
                <li
                  key={r.id}
                  className={`flex items-center gap-2 px-3 py-2 ${i === activo ? "bg-muted/70" : "hover:bg-muted/40"}`}
                  onMouseEnter={() => setActivo(i)}
                >
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left cursor-pointer"
                    onClick={() => ir(enlacePipeline(r))}
                    title="Ver su tarjeta en el Pipeline"
                  >
                    <p className="text-[13px] font-medium truncate">{r.name || "Sin nombre"}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {[r.phone, r.pedido].filter(Boolean).join(" · ")}
                    </p>
                  </button>
                  <button type="button" title="Pipeline" onClick={() => ir(enlacePipeline(r))} className="p-1.5 rounded hover:bg-muted cursor-pointer">
                    <Columns3 className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  <button type="button" title="Chat" onClick={() => ir(`/conversations/${r.id}`)} className="p-1.5 rounded hover:bg-muted cursor-pointer">
                    <MessageCircle className="h-3.5 w-3.5 text-emerald-600" />
                  </button>
                  <button type="button" title="Ficha del contacto" onClick={() => ir(`/contacts/${r.id}`)} className="p-1.5 rounded hover:bg-muted cursor-pointer">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

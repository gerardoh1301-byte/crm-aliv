"use client";

import { useEffect, useState } from "react";

/**
 * Rol del miembro de la sesion, para mostrar u ocultar lo de admin en el navegador.
 * Es solo UI: el servidor vuelve a comprobar el rol en cada ruta.
 * null = todavia no se sabe.
 */
// El rol no cambia durante la visita: se recuerda entre paginas para que el menu no
// vuelva a parpadear en cada navegacion.
let rolConocido: boolean | null = null;

export function useEsAdmin(): boolean | null {
  const [esAdmin, setEsAdmin] = useState<boolean | null>(rolConocido);
  useEffect(() => {
    if (rolConocido !== null) return;
    let activo = true;
    fetch("/api/team/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { member?: { role?: string } } | null) => {
        rolConocido = data?.member?.role === "admin";
        if (activo) setEsAdmin(rolConocido);
      })
      .catch(() => {
        if (activo) setEsAdmin(false);
      });
    return () => {
      activo = false;
    };
  }, []);
  return esAdmin;
}

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
// 26/11: las tarjetas del pipeline tambien lo usan; con una consulta compartida no sale
// un pedido a /api/team/me por cada tarjeta mientras el rol todavia no se conoce.
let consulta: Promise<boolean> | null = null;

function consultarRol(): Promise<boolean> {
  if (!consulta) {
    consulta = fetch("/api/team/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { member?: { role?: string } } | null) => {
        rolConocido = data?.member?.role === "admin";
        return rolConocido;
      })
      .catch(() => {
        consulta = null;
        return false;
      });
  }
  return consulta;
}

export function useEsAdmin(): boolean | null {
  const [esAdmin, setEsAdmin] = useState<boolean | null>(rolConocido);
  useEffect(() => {
    if (rolConocido !== null) return;
    let activo = true;
    consultarRol().then((v) => {
      if (activo) setEsAdmin(v);
    });
    return () => {
      activo = false;
    };
  }, []);
  return esAdmin;
}

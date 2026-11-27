"use client";

import { useSyncExternalStore } from "react";

/**
 * Barra lateral oculta o visible en escritorio (27/11). La preferencia queda en el navegador;
 * en el servidor vale «visible» para no romper la hidratación.
 */
const CLAVE = "layout:barraLateralOculta";
const EVENTO = "layout:barra-lateral";

function suscribir(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(EVENTO, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(EVENTO, callback);
  };
}

function leer(): boolean {
  try {
    return window.localStorage.getItem(CLAVE) === "1";
  } catch {
    return false;
  }
}

export function useBarraLateralOculta(): boolean {
  return useSyncExternalStore(suscribir, leer, () => false);
}

export function alternarBarraLateral(): void {
  try {
    window.localStorage.setItem(CLAVE, leer() ? "0" : "1");
  } catch {
    // sin almacenamiento: no se recuerda, pero tampoco falla
  }
  window.dispatchEvent(new Event(EVENTO));
}

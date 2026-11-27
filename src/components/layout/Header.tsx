"use client";

import { useEffect } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { BuscadorGlobal } from "./BuscadorGlobal";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { MobileNav } from "./MobileNav";
import { NotificationBell } from "./NotificationBell";
import { alternarBarraLateral, useBarraLateralOculta } from "@/lib/use-barra-lateral";

export function Header() {
  const oculta = useBarraLateralOculta();

  // Ctrl/⌘ + B oculta o muestra el menú lateral (27/11).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        alternarBarraLateral();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-14 box-content pt-[env(safe-area-inset-top)] items-center gap-3 border-b border-border bg-card/95 backdrop-blur-md shadow-sm px-4 md:px-8">
      <Sheet>
        <SheetTrigger
          render={
            <Button variant="ghost" size="icon" className="md:hidden cursor-pointer h-8 w-8" />
          }
        >
          <Menu className="h-4 w-4" />
        </SheetTrigger>
        <SheetContent side="left" className="w-60 p-0">
          <MobileNav />
        </SheetContent>
      </Sheet>

      <Button
        variant="ghost"
        size="icon"
        onClick={alternarBarraLateral}
        title={oculta ? "Mostrar menú lateral (Ctrl+B)" : "Ocultar menú lateral (Ctrl+B)"}
        aria-label={oculta ? "Mostrar menú lateral" : "Ocultar menú lateral"}
        className="hidden md:inline-flex cursor-pointer h-8 w-8 -ml-2"
      >
        {oculta ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </Button>

      <div className="flex-1 flex items-center gap-3">
        <BuscadorGlobal />
      </div>

      <NotificationBell />
    </header>
  );
}

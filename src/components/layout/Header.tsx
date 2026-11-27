"use client";

import { Menu } from "lucide-react";
import { BuscadorGlobal } from "./BuscadorGlobal";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { MobileNav } from "./MobileNav";
import { NotificationBell } from "./NotificationBell";

export function Header() {
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

      <div className="flex-1 flex items-center gap-3">
        <BuscadorGlobal />
      </div>

      <NotificationBell />
    </header>
  );
}

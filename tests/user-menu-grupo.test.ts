import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { Menu } from "@base-ui/react/menu";

// Regresión 24/11: la etiqueta del menú de usuario sin <Menu.Group> rompía la página al abrirlo
// («This page couldn't load» al querer cerrar sesión).
describe("menú de usuario", () => {
  it("la etiqueta suelta revienta y dentro de un grupo no", () => {
    expect(() => renderToString(React.createElement(Menu.GroupLabel, null, "Gerardo"))).toThrow(/Menu.Group/);
    expect(renderToString(React.createElement(Menu.Group, null, React.createElement(Menu.GroupLabel, null, "Gerardo")))).toContain("Gerardo");
  });
});

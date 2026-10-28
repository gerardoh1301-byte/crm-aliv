import { AuthForm } from "@/components/auth/AuthForm";
import { LocalLoginForm } from "@/components/auth/LocalLoginForm";
import { proveedoresExternos, NOMBRE_PROVEEDOR } from "@/lib/auth-proveedores";
import { modoLocal } from "@/lib/modo-local";

export const metadata = {
  title: "Iniciar sesion | Aliv Store CRM",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  if (modoLocal() || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("supabase.co")) {
    return <LocalLoginForm />;
  }

  const externos = await proveedoresExternos();
  const proveedores = externos.map((id) => ({ id, nombre: NOMBRE_PROVEEDOR[id] }));

  return (
    <>
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight font-heading">
          Bienvenido de vuelta
        </h1>
        <p className="text-sm text-muted-foreground">
          Inicia sesion para gestionar tu pipeline
        </p>
      </div>
      <AuthForm mode="login" proveedores={proveedores} errorInicial={error ?? null} />
    </>
  );
}

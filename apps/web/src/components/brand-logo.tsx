import Image from "next/image";

/** The same original artwork is used on public pages and inside the portal. */
export function BrandLogo({ label, priority = false }: { label: string; priority?: boolean }) {
  return <Image src="/brand/aia-logo.png" alt={label} width={820} height={293} priority={priority}/>;
}

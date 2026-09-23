import { getTranslations } from "next-intl/server";
export async function StatusBadge({ value }: { value: string }) {
  const t = await getTranslations("status");
  return <span className={"badge badge-" + value.toLowerCase()}>{t.has(value) ? t(value) : value}</span>;
}


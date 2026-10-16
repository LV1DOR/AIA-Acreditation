import type {PrismaClient} from "@aia/database";
export async function assertRestrictedDatabaseRuntime(db:Pick<PrismaClient,"$queryRaw">) {
  const rows=await db.$queryRaw<{unsafe:boolean}[]>`SELECT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relowner=r.oid) OR pg_has_role(current_user,'aia_privacy_executor','MEMBER')) AS unsafe FROM pg_roles r WHERE r.rolname=current_user`;
  if(!rows.length || rows[0]!.unsafe)throw new Error("RESTRICTED_RUNTIME_ROLE_REQUIRED");
}

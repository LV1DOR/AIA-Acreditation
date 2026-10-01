import { SetupManagementRoute } from "../setup-view.tsx";

export default async function SetupSectionPage({ params, searchParams }: { params:Promise<{section:string}>; searchParams:Promise<{eventId?:string}> }) {
  const [{ section }, { eventId }] = await Promise.all([params, searchParams]);
  return <SetupManagementRoute section={section} eventId={eventId}/>;
}

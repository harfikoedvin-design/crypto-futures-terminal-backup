import { headers } from "next/headers";
import { NextRequest } from "next/server";

import { viewerAccess } from "@/lib/viewer-auth";
import { getChatGPTUser } from "./chatgpt-auth";
import Dashboard from "./terminal-dashboard";
import ViewerGate from "./viewer-gate";

export const dynamic = "force-dynamic";

export default async function Home() {
  const requestHeaders = await headers();
  const access = await viewerAccess(new NextRequest("https://terminal.local/", { headers: requestHeaders }));
  if (!access.authenticated) return <ViewerGate />;
  const user = await getChatGPTUser();
  return <Dashboard displayName={access.owner ? user?.displayName ?? "Owner" : "Authorized viewer"} readOnlyViewer={!access.owner} />;
}

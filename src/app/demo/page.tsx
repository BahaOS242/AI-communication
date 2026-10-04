import { Suspense } from "react";
import { BrowserDemo } from "@/components/BrowserDemo";

export const metadata = { title: "AgentForge — Live demo" };

export default function DemoPage() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-muted">Starting the team…</p>}>
      <BrowserDemo />
    </Suspense>
  );
}

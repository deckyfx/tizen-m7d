import { MonitorPlay } from "lucide-react";
import { Notice } from "./ui";

/** Tells the viewer the dashboard is running on the TV it controls. */
export function TvBanner({ ip }: { ip: string }) {
  return (
    <Notice tone="info" icon={MonitorPlay} title={`You are controlling this TV from its own browser${ip ? ` (${ip})` : ""}.`}>
      Use the arrow keys and OK. Closing or killing “Browser” closes this page; power off turns this screen off.
    </Notice>
  );
}

import { WifiOff } from "lucide-react";

export function OnlineOnlyNotice({
  text = "Você está offline. Essa ação exige conexão com o servidor."
}: {
  text?: string;
}) {
  return (
    <div
      role="status"
      className="px-3 py-2 rounded-lg border text-xs flex items-center gap-2"
      style={{ backgroundColor: "var(--warn-soft)", borderColor: "var(--warn)", color: "var(--warn)" }}
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

import { Badge } from "@/components/ui/badge";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  want_to_read: { label: "Want to Read", variant: "default" },
  currently_reading: { label: "Reading", variant: "secondary" },
  read: { label: "Read", variant: "outline" },
  did_not_finish: { label: "DNF", variant: "outline" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || { label: status, variant: "outline" as const };

  return (
    <Badge variant={config.variant} data-testid={`badge-status-${status}`}>
      {config.label}
    </Badge>
  );
}

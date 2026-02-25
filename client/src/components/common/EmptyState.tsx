import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center" data-testid="empty-state">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        {icon || <BookOpen className="w-7 h-7 text-muted-foreground" />}
      </div>
      <h3 className="text-lg font-semibold mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-[280px]">{description}</p>
      {actionLabel && (actionHref ? (
        <Link href={actionHref}>
          <Button data-testid="empty-state-action">{actionLabel}</Button>
        </Link>
      ) : (
        <Button onClick={onAction} data-testid="empty-state-action">{actionLabel}</Button>
      ))}
    </div>
  );
}

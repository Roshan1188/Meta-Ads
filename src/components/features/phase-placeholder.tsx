import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Honest stand-in for routes whose feature lands in a later phase. Keeps the
 * navigation complete without implying functionality that isn't there yet.
 */
export function PhasePlaceholder({
  phase,
  children,
}: {
  phase: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-start gap-3 py-10">
        <Badge variant="secondary">{phase}</Badge>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          {children}
        </p>
      </CardContent>
    </Card>
  );
}

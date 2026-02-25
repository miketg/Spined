import { Skeleton } from "@/components/ui/skeleton";

export function BookCardSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="aspect-[2/3] w-full rounded-md" />
      <Skeleton className="h-3.5 w-4/5" />
      <Skeleton className="h-3 w-3/5" />
    </div>
  );
}

export function BookGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 gap-4 px-4">
      {Array.from({ length: count }).map((_, i) => (
        <BookCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function BookListItemSkeleton() {
  return (
    <div className="flex gap-3 p-4">
      <Skeleton className="w-14 h-20 rounded-md flex-shrink-0" />
      <div className="flex-1 flex flex-col gap-2 py-1">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

export function HomePageSkeleton() {
  return (
    <div className="px-4 py-6 space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-6 w-32" />
      <div className="flex gap-3">
        <Skeleton className="h-24 w-24 rounded-xl" />
        <Skeleton className="h-24 w-24 rounded-xl" />
        <Skeleton className="h-24 w-24 rounded-xl" />
      </div>
    </div>
  );
}

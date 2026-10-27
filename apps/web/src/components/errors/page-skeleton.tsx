import { Skeleton } from '@forest/ui';

/** Route-level loading state (personal pages render dynamically and can take a moment). */
export function PageSkeleton({ aside = true }: { aside?: boolean }) {
  return (
    <div
      aria-busy
      className="mx-auto flex max-w-[1440px] flex-wrap gap-2.5 px-3 pb-16 lg:gap-4 lg:px-6 lg:pt-2"
    >
      <div className="flex min-w-0 flex-[3_1_640px] flex-col gap-2.5 lg:gap-4">
        <Skeleton className="h-[200px] rounded-lg bg-panel lg:h-[320px] lg:rounded-xl" />
        <Skeleton className="h-[180px] rounded-lg bg-panel lg:rounded-xl" />
      </div>
      {aside ? (
        <Skeleton className="h-[420px] min-w-0 flex-[2_1_360px] rounded-lg bg-panel lg:rounded-xl" />
      ) : null}
    </div>
  );
}

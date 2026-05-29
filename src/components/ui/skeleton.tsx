export function Skeleton({
  className = "",
}: {
  className?: string;
}) {
  return <div className={`bg-white/2 ${className}`} />;
}

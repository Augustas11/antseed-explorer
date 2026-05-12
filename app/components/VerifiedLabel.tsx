export default function VerifiedLabel({
  displayName,
}: {
  displayName: string | null | undefined;
}) {
  if (!displayName) return null;
  return <span className="pill ml-1 text-xs">{displayName}</span>;
}

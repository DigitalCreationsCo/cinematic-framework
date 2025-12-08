import StatusBadge from '../StatusBadge';

export default function StatusBadgeExample() {
  return (
    <div className="flex flex-wrap gap-2">
      <StatusBadge status="idle" />
      <StatusBadge status="generating" />
      <StatusBadge status="complete" />
      <StatusBadge status="PASS" />
      <StatusBadge status="MINOR_ISSUES" size="sm" />
      <StatusBadge status="failed" />
    </div>
  );
}

type StatCardProps = {
  label: string;
  value: string;
  sublabel?: string;
  accent?: "blue" | "green" | "amber" | "violet";
};

const ACCENTS: Record<NonNullable<StatCardProps["accent"]>, string> = {
  blue: "border-l-blue-500",
  green: "border-l-emerald-500",
  amber: "border-l-amber-500",
  violet: "border-l-violet-500",
};

export function StatCard({ label, value, sublabel, accent = "blue" }: StatCardProps) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm border-l-4 ${ACCENTS[accent]}`}
    >
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
        {value}
      </p>
      {sublabel && <p className="mt-1 text-xs text-slate-400">{sublabel}</p>}
    </div>
  );
}

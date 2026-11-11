import { Link } from "react-router-dom";
import { STATUS_LABEL } from "@/lib/format";

export const Logo = ({ className = "h-7" }) => (
  <Link to="/" data-testid="nav-logo" className="shrink-0 inline-flex items-center">
    <img src="/nxtplay-logo.png" alt="NXTPLAY" className={`${className} w-auto`} />
  </Link>
);

export const PixelBadge = ({ children, className = "" }) => <span className={`pixel-badge ${className}`}>{children}</span>;

const STATUS_STYLE = {
  confirmed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  cancelled: "bg-red-500/15 text-red-300 border-red-500/30",
  payment_failed: "bg-red-500/15 text-red-300 border-red-500/30",
  expired: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  pending_payment: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  initiated: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  processed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  rejected: "bg-red-500/15 text-red-300 border-red-500/30",
  failed: "bg-red-500/15 text-red-300 border-red-500/30",
  captured: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  created: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  inactive: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  settled: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  unsettled: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  checked_in: "bg-sky-500/15 text-sky-300 border-sky-500/30",
};

export const StatusBadge = ({ status, label, testId }) => (
  <span data-testid={testId} className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLE[status] || STATUS_STYLE.created}`}>
    {label || STATUS_LABEL[status] || String(status || "").replace(/_/g, " ")}
  </span>
);

export const EmptyState = ({ title, text, action, testId = "empty-state" }) => (
  <div data-testid={testId} className="surface p-10 text-center">
    <p className="headline text-3xl mb-2">{title}</p>
    {text && <p className="text-muted-foreground text-sm max-w-md mx-auto">{text}</p>}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

export const Stat = ({ label, value, testId, hint }) => (
  <div className="surface p-5" data-testid={testId}>
    <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className="font-display font-bold text-3xl mt-1">{value}</p>
    {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
  </div>
);

export const PageTitle = ({ title, sub, right }) => (
  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
    <div>
      <h1 className="headline text-4xl sm:text-5xl" data-testid="page-title">{title}</h1>
      {sub && <p className="text-muted-foreground text-sm mt-2">{sub}</p>}
    </div>
    {right}
  </div>
);

export const Field = ({ label, children, hint }) => (
  <label className="block space-y-1.5">
    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
    {children}
    {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
  </label>
);

export const NativeSelect = ({ value, onChange, options, placeholder, testId, className = "" }) => (
  <select data-testid={testId} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={`field ${className}`}>
    {placeholder !== undefined && <option value="">{placeholder}</option>}
    {options.map((o) => (
      <option key={o.value} value={o.value}>{o.label}</option>
    ))}
  </select>
);

export const Table = ({ cols, rows, testId, empty = "Nothing here yet." }) => (
  <div className="surface overflow-x-auto" data-testid={testId}>
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
          {cols.map((c) => <th key={c} className="px-4 py-3 whitespace-nowrap font-semibold">{c}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={cols.length} className="px-4 py-8 text-center text-muted-foreground">{empty}</td></tr>
        ) : rows}
      </tbody>
    </table>
  </div>
);

export const Td = ({ children, className = "" }) => <td className={`px-4 py-3 whitespace-nowrap ${className}`}>{children}</td>;

interface LoadingSpinnerProps {
  label?: string;
  size?: "sm" | "md";
  decorative?: boolean;
}

export function LoadingSpinner({
  label = "Carregando",
  size = "sm",
  decorative = false,
}: LoadingSpinnerProps) {
  return (
    <progress
      className={`loading-spinner loading-spinner-${size}`}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
    />
  );
}

interface LoadingButtonContentProps {
  loading: boolean;
  loadingLabel: string;
  idleLabel: string;
}

export function LoadingButtonContent({
  loading,
  loadingLabel,
  idleLabel,
}: LoadingButtonContentProps) {
  return (
    <span className="button-content">
      {loading && <LoadingSpinner size="sm" decorative />}
      <span>{loading ? loadingLabel : idleLabel}</span>
    </span>
  );
}

interface SkeletonBlockProps {
  width?: string;
  height?: string;
  radius?: string;
  className?: string;
}

export function SkeletonBlock({
  width = "100%",
  height = "1rem",
  radius,
  className = "",
}: SkeletonBlockProps) {
  return (
    <span
      className={`skeleton-block ${className}`.trim()}
      aria-hidden="true"
      style={{
        inlineSize: width,
        blockSize: height,
        borderRadius: radius,
      }}
    />
  );
}

interface LoadingIndicatorRowProps {
  label: string;
}

export function LoadingIndicatorRow({ label }: LoadingIndicatorRowProps) {
  return (
    <div className="loading-indicator-row">
      <LoadingSpinner size="sm" label={label} />
      <span>{label}</span>
    </div>
  );
}

interface SkeletonSummaryGridProps {
  count?: number;
  highlightIndex?: number;
  label?: string;
}

export function SkeletonSummaryGrid({
  count = 4,
  highlightIndex = -1,
  label,
}: SkeletonSummaryGridProps) {
  return (
    <div className="skeleton-region" data-testid="skeleton-summary-grid">
      {label && <LoadingIndicatorRow label={label} />}
      <div className="summary-grid" aria-hidden="true">
        {Array.from({ length: count }).map((_, index) => (
          <div
            key={index}
            className={`result-card card skeleton-card ${index === highlightIndex ? "highlight" : ""}`.trim()}
          >
            <SkeletonBlock width="58%" height="0.75rem" />
            <SkeletonBlock width="76%" height="2rem" className="skeleton-mt-sm" />
            <SkeletonBlock width="88%" height="0.8rem" className="skeleton-mt-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}

interface SkeletonCardListProps {
  count?: number;
  label?: string;
}

export function SkeletonCardList({ count = 3, label }: SkeletonCardListProps) {
  return (
    <div className="skeleton-region" data-testid="skeleton-card-list">
      {label && <LoadingIndicatorRow label={label} />}
      <ul className="transactions-list" aria-hidden="true">
        {Array.from({ length: count }).map((_, index) => (
          <li key={index}>
            <div className="transaction-card card skeleton-card">
              <div className="transaction-main">
                <div className="transaction-meta">
                  <SkeletonBlock width="74px" height="1.5rem" radius="999px" />
                  <SkeletonBlock width="112px" height="1.5rem" radius="999px" />
                  <SkeletonBlock width="90px" height="1.5rem" radius="999px" />
                </div>
                <SkeletonBlock width="68%" height="1.35rem" className="skeleton-mt-sm" />
                <SkeletonBlock width="44%" height="0.85rem" className="skeleton-mt-sm" />
              </div>
              <div className="transaction-side">
                <SkeletonBlock width="108px" height="1.5rem" />
                <div className="side-controls">
                  <SkeletonBlock width="92px" height="2.4rem" radius="12px" />
                  <SkeletonBlock width="84px" height="2.4rem" radius="12px" />
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface SkeletonFormGridProps {
  fields?: number;
  tallField?: boolean;
  label?: string;
}

export function SkeletonFormGrid({
  fields = 3,
  tallField = false,
  label,
}: SkeletonFormGridProps) {
  return (
    <div className="skeleton-region" data-testid="skeleton-form">
      {label && <LoadingIndicatorRow label={label} />}
      <div className="stack-md" aria-hidden="true">
        {Array.from({ length: fields }).map((_, index) => (
          <div key={index} className="field">
            <SkeletonBlock width="42%" height="0.85rem" />
            <SkeletonBlock
              width="100%"
              height={tallField && index === 0 ? "6.2rem" : "2.85rem"}
              radius="12px"
            />
          </div>
        ))}
        <SkeletonBlock width="180px" height="3rem" radius="12px" />
      </div>
    </div>
  );
}

interface SkeletonListLinesProps {
  count?: number;
  label?: string;
}

export function SkeletonListLines({ count = 3, label }: SkeletonListLinesProps) {
  return (
    <div className="skeleton-region" data-testid="skeleton-lines">
      {label && <LoadingIndicatorRow label={label} />}
      <div className="plan-list" aria-hidden="true">
        {Array.from({ length: count }).map((_, index) => (
          <div key={index} className="plan-item">
            <SkeletonBlock width="62px" height="1.4rem" radius="999px" />
            <SkeletonBlock width={`${72 - (index % 3) * 12}%`} height="1rem" />
          </div>
        ))}
      </div>
    </div>
  );
}

interface SkeletonAuditGridProps {
  count?: number;
}

export function SkeletonAuditGrid({ count = 2 }: SkeletonAuditGridProps) {
  return (
    <div className="skeleton-region stack-md" aria-hidden="true" data-testid="skeleton-audit">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="audit-grid">
          <div>
            <SkeletonBlock width="45%" height="0.9rem" />
            <SkeletonBlock width="100%" height="7rem" radius="12px" className="skeleton-mt-sm" />
          </div>
          <div>
            <SkeletonBlock width="45%" height="0.9rem" />
            <SkeletonBlock width="100%" height="7rem" radius="12px" className="skeleton-mt-sm" />
          </div>
        </div>
      ))}
    </div>
  );
}

import Link from 'next/link';
import {
  ISAIAH_CASE,
  ELEMENT_LABELS,
} from '@/lib/isaiah-case-package';
import { SignOutButton } from '@/components/SignOutButton';
import { DisclaimerFooter } from '@/components/DisclaimerFooter';

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(dateStr: string): string {
  if (dateStr.length <= 7) {
    // "2020-03" format
    const [year, month] = dateStr.split('-');
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return `${months[parseInt(month, 10) - 1]} ${year}`;
  }
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function ScoreBadge({ score }: { score: 'true' | 'partial' | 'false' }) {
  const styles = {
    true: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    partial: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    false: 'bg-red-500/20 text-red-400 border-red-500/30',
  };
  return (
    <span
      className={`inline-block text-xs font-bold uppercase tracking-wider px-2 py-1 rounded border ${styles[score]}`}
    >
      {score}
    </span>
  );
}

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId: id } = await params;
  const c = ISAIAH_CASE;

  // Only serve the case we have
  if (id !== c.id) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Case Not Found</h1>
          <p className="text-gray-400 mb-4">No case matches this ID.</p>
          <Link href="/cases" className="text-blue-400 hover:text-blue-300">
            Back to Cases
          </Link>
        </div>
      </div>
    );
  }

  const shortId = c.id.slice(0, 4).toUpperCase() + '...' + c.id.slice(-4).toUpperCase();
  const trueCount = Object.values(c.elements).filter(
    (el) => el.score === 'true',
  ).length;
  const totalCount = Object.keys(c.elements).length;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="border-b border-gray-800 px-4 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <span className="text-xl font-bold tracking-tight">WOLF LAW</span>
            <span className="text-sm text-gray-400 hidden sm:inline">
              Attorney Portal
            </span>
          </div>
          <SignOutButton />
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-8 space-y-8">
        {/* ======================================================
         * 1. Header
         * ====================================================== */}
        <section className="flex flex-col sm:flex-row sm:items-center gap-4">
          <Link
            href="/cases"
            className="text-gray-400 hover:text-white transition-colors text-sm flex items-center gap-1"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back to Cases
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Case #{shortId}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="bg-emerald-600 text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-md">
              {c.viability_tier}
            </span>
            <span className="text-lg font-bold text-emerald-400">
              {c.viability_score} / 100
            </span>
          </div>
        </section>

        {/* ======================================================
         * 2. Economic Pitch (most prominent)
         * ====================================================== */}
        <section className="bg-gray-900/80 border border-gray-800 rounded-xl p-6 sm:p-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400 mb-4">
            Case Summary
          </h2>
          <p className="text-xl leading-relaxed text-gray-100">
            {c.economic_pitch}
          </p>
        </section>

        {/* ======================================================
         * 3. Six-Element Scores
         * ====================================================== */}
        <section>
          <h2 className="text-lg font-semibold mb-4">
            Legal Elements &mdash;{' '}
            <span className="text-emerald-400">
              {trueCount}/{totalCount}
            </span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Object.entries(c.elements).map(([key, el]) => (
              <div
                key={key}
                className="bg-gray-900 border border-gray-800 rounded-xl p-5"
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">
                    {ELEMENT_LABELS[key] ?? key}
                  </h3>
                  <ScoreBadge score={el.score} />
                </div>
                <p className="text-sm text-gray-300 mb-3">{el.reasoning}</p>
                <ul className="space-y-1">
                  {el.evidence.map((ev, i) => (
                    <li
                      key={i}
                      className="text-xs text-gray-400 flex items-start gap-1.5"
                    >
                      <span className="text-gray-600 mt-0.5 shrink-0">
                        &bull;
                      </span>
                      {ev}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* ======================================================
         * 4. Damages Breakdown
         * ====================================================== */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Damages Breakdown</h2>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left px-5 py-3 text-gray-400 font-medium">
                    Component
                  </th>
                  <th className="text-right px-5 py-3 text-gray-400 font-medium">
                    Estimate
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-800/50">
                  <td className="px-5 py-3 text-gray-300">Back Pay</td>
                  <td className="px-5 py-3 text-right text-gray-200">
                    {formatCurrency(c.damages.back_pay_estimate)}
                  </td>
                </tr>
                <tr className="border-b border-gray-800/50">
                  <td className="px-5 py-3 text-gray-300">
                    Front Pay (3 years)
                  </td>
                  <td className="px-5 py-3 text-right text-gray-200">
                    {formatCurrency(c.damages.front_pay_estimate)}
                  </td>
                </tr>
                <tr className="border-b border-gray-800/50">
                  <td className="px-5 py-3 text-gray-300">Benefits Value</td>
                  <td className="px-5 py-3 text-right text-gray-200">
                    {formatCurrency(c.damages.benefits_value)}
                  </td>
                </tr>
                <tr className="border-b border-gray-800/50">
                  <td className="px-5 py-3 text-gray-300">
                    Emotional Distress
                  </td>
                  <td className="px-5 py-3 text-right text-gray-200">
                    {c.damages.emotional_distress_range}
                  </td>
                </tr>
                <tr className="border-b border-gray-800/50">
                  <td className="px-5 py-3 text-gray-300">
                    Punitive Damages
                  </td>
                  <td className="px-5 py-3 text-right text-emerald-400">
                    {c.damages.punitive_eligible ? 'Eligible' : 'Not eligible'}
                  </td>
                </tr>
                <tr className="bg-gray-800/30">
                  <td className="px-5 py-4 font-bold text-white">
                    Estimated Total Range
                  </td>
                  <td className="px-5 py-4 text-right font-bold text-emerald-400 text-base">
                    {formatCurrency(c.damages.total_low)} &ndash;{' '}
                    {formatCurrency(c.damages.total_high)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ======================================================
         * 5. Fact Pattern -- Timeline + Narrative
         * ====================================================== */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Fact Pattern</h2>

          {/* Timeline */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 sm:p-6 mb-4">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Timeline
            </h3>
            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-3 top-2 bottom-2 w-px bg-gray-700" />
              <div className="space-y-4">
                {c.fact_pattern.timeline.map((item, i) => (
                  <div key={i} className="flex items-start gap-4 relative">
                    <div className="w-6 h-6 rounded-full bg-gray-800 border-2 border-blue-500 shrink-0 z-10 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0 pb-1">
                      <p className="text-xs font-mono text-blue-400 mb-0.5">
                        {formatDate(item.date)}
                      </p>
                      <p className="text-sm text-gray-200">{item.event}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Narrative */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 sm:p-6">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Narrative
            </h3>
            {c.fact_pattern.narrative.split('\n\n').map((para, i) => (
              <p key={i} className="text-sm text-gray-300 leading-relaxed mb-3 last:mb-0">
                {para}
              </p>
            ))}
          </div>
        </section>

        {/* ======================================================
         * 6. Evidence Inventory
         * ====================================================== */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Evidence Inventory</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* In Hand */}
            <div className="bg-gray-900 border border-emerald-800/50 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                In Hand ({c.evidence.has.length})
              </h3>
              <ul className="space-y-2">
                {c.evidence.has.map((item, i) => (
                  <li key={i} className="text-sm text-gray-300 flex items-start gap-1.5">
                    <span className="text-emerald-500 mt-0.5 shrink-0">&bull;</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Gaps */}
            <div className="bg-gray-900 border border-amber-800/50 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-amber-400 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                Gaps ({c.evidence.missing.length})
              </h3>
              <ul className="space-y-2">
                {c.evidence.missing.map((item, i) => (
                  <li key={i} className="text-sm text-gray-300 flex items-start gap-1.5">
                    <span className="text-amber-500 mt-0.5 shrink-0">&bull;</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Discoverable */}
            <div className="bg-gray-900 border border-blue-800/50 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-blue-400 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                Discoverable ({c.evidence.obtainable.length})
              </h3>
              <ul className="space-y-2">
                {c.evidence.obtainable.map((item, i) => (
                  <li key={i} className="text-sm text-gray-300 flex items-start gap-1.5">
                    <span className="text-blue-500 mt-0.5 shrink-0">&bull;</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ======================================================
         * 7. Statutes & Filing Strategy
         * ====================================================== */}
        <section>
          <h2 className="text-lg font-semibold mb-4">
            Statutes &amp; Filing Strategy
          </h2>

          {/* Statutes table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-5 py-3 text-gray-400 font-medium">
                      Statute
                    </th>
                    <th className="text-left px-5 py-3 text-gray-400 font-medium">
                      Citation
                    </th>
                    <th className="text-left px-5 py-3 text-gray-400 font-medium">
                      Filing Deadline
                    </th>
                    <th className="text-left px-5 py-3 text-gray-400 font-medium">
                      Venue
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {c.statutes.map((s, i) => {
                    const deadline = new Date(s.filing_deadline);
                    const now = new Date();
                    const daysUntil = Math.ceil(
                      (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
                    );
                    const urgent = daysUntil <= 30;

                    return (
                      <tr
                        key={i}
                        className="border-b border-gray-800/50 last:border-0"
                      >
                        <td className="px-5 py-3 text-gray-200 font-medium">
                          {s.name}
                        </td>
                        <td className="px-5 py-3 text-gray-400 font-mono text-xs">
                          {s.citation}
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={
                              urgent
                                ? 'text-red-400 font-medium'
                                : 'text-gray-300'
                            }
                          >
                            {formatDate(s.filing_deadline)}
                            {urgent && (
                              <span className="ml-1 text-xs text-red-500">
                                ({daysUntil}d)
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-gray-400 text-xs">
                          {s.venue}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Filing strategy card */}
          <div className="bg-gray-900 border border-blue-800/40 rounded-xl p-5 sm:p-6">
            <h3 className="text-sm font-semibold text-blue-400 uppercase tracking-wider mb-3">
              Recommended Filing Strategy
            </h3>
            <p className="text-sm text-gray-200 font-medium mb-2">
              {c.filing_strategy.recommended_venue}
            </p>
            <p className="text-sm text-gray-300 mb-3">
              {c.filing_strategy.reasoning}
            </p>
            <div className="flex flex-wrap gap-4 text-xs text-gray-400">
              <span>
                <span className="text-gray-500">Key deadline:</span>{' '}
                <span className="text-amber-400 font-medium">
                  {formatDate(c.filing_strategy.deadline)}
                </span>
              </span>
              <span>
                <span className="text-gray-500">Alt venues:</span>{' '}
                {c.filing_strategy.alternative_venues.join(', ')}
              </span>
            </div>
          </div>
        </section>

        {/* ======================================================
         * 8. Anticipated Defenses
         * ====================================================== */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Anticipated Defenses</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {c.employer_defenses.map((def, i) => (
              <div key={i} className="flex flex-col gap-3">
                {/* Employer defense */}
                <div className="bg-gray-900 border border-red-800/40 rounded-xl p-5">
                  <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2">
                    Employer Will Argue
                  </h3>
                  <p className="text-sm text-gray-300">{def}</p>
                </div>
                {/* Our counter */}
                <div className="bg-gray-900 border border-emerald-800/40 rounded-xl p-5">
                  <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">
                    Our Response
                  </h3>
                  <p className="text-sm text-gray-300">
                    {c.counter_defenses[i]}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ======================================================
         * 9. Plaintiff Profile (redacted)
         * ====================================================== */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Plaintiff Profile</h2>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 sm:p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <p className="text-xs text-gray-500 mb-1">Identity</p>
                <p className="text-sm font-medium text-gray-200">
                  {c.plaintiff.display_name}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Income Range</p>
                <p className="text-sm font-medium text-gray-200">
                  {c.plaintiff.annual_income_range}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Tenure</p>
                <p className="text-sm font-medium text-gray-200">
                  {c.plaintiff.tenure_years} years
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Role</p>
                <p className="text-sm font-medium text-gray-200">
                  {c.plaintiff.employment_type}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Income Source</p>
                <p className="text-sm font-medium text-gray-200">
                  {c.plaintiff.income_source}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Employer</p>
                <p className="text-sm font-medium text-gray-200">
                  {c.employer.name}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Employer Size</p>
                <p className="text-sm font-medium text-gray-200">
                  {c.employer.size}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Public Company</p>
                <p className="text-sm font-medium text-gray-200">
                  {c.employer.publicly_traded ? 'Yes' : 'No'} &mdash;{' '}
                  {c.employer.industry}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ======================================================
         * 10. Actions (placeholder)
         * ====================================================== */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <button
              disabled
              className="flex-1 bg-emerald-600/50 text-white/50 px-6 py-3 rounded-lg font-medium cursor-not-allowed"
            >
              I&apos;m Interested
            </button>
            <button
              disabled
              className="flex-1 bg-gray-700/50 text-white/50 px-6 py-3 rounded-lg font-medium cursor-not-allowed"
            >
              Pass
            </button>
          </div>
          <p className="text-xs text-gray-500 text-center">
            Contact Wolf Law at (630) 716-9319 to discuss this case.
          </p>
        </section>
      </main>

      <DisclaimerFooter />
    </div>
  );
}

import Link from 'next/link';
import {
  ISAIAH_CASE,
  STATUTE_ABBREVIATIONS,
} from '@/lib/isaiah-case-package';
import { SignOutButton } from '@/components/SignOutButton';
import { DisclaimerFooter } from '@/components/DisclaimerFooter';

export default function CasesListPage() {
  const c = ISAIAH_CASE;
  const trueCount = Object.values(c.elements).filter(
    (el) => el.score === 'true',
  ).length;
  const totalCount = Object.keys(c.elements).length;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="border-b border-gray-800 px-4 sm:px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <span className="text-xl font-bold tracking-tight">WOLF LAW</span>
            <span className="text-sm text-gray-400 hidden sm:inline">
              Attorney Portal
            </span>
          </div>
          <SignOutButton />
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 py-8">
        {/* Section header */}
        <div className="flex items-center gap-3 mb-6">
          <h2 className="text-lg font-semibold">New Cases</h2>
          <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
            1
          </span>
        </div>

        {/* Case card */}
        <Link href={`/cases/${c.id}`} className="block group">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 sm:p-6 hover:border-gray-600 transition-colors">
            <div className="flex flex-col lg:flex-row lg:items-start gap-4">
              {/* Left: tier badge */}
              <div className="shrink-0">
                <span className="inline-block bg-emerald-600 text-white text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-md">
                  {c.viability_tier}
                </span>
              </div>

              {/* Center: title, pitch, damages */}
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold mb-1">
                  Whistleblower Retaliation &mdash; Manufacturing
                </h3>
                <p className="text-sm text-gray-400 line-clamp-2 mb-3">
                  {c.economic_pitch.split('.')[0]}.
                </p>
                <p className="text-base font-medium text-emerald-400">
                  ${(c.damages.total_low / 1000).toFixed(0)}K &ndash; $
                  {(c.damages.total_high / 1000).toFixed(0)}K estimated damages
                </p>
              </div>

              {/* Right: statute pills */}
              <div className="flex flex-wrap gap-1.5 lg:max-w-[220px]">
                {c.statutes.map((s) => {
                  const abbr =
                    STATUTE_ABBREVIATIONS[s.name] ?? s.name.slice(0, 8);
                  return (
                    <span
                      key={s.citation}
                      className="bg-blue-500/20 text-blue-300 text-xs font-medium px-2 py-1 rounded"
                    >
                      {abbr}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Bottom row */}
            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-800">
              <span className="bg-emerald-500/20 text-emerald-400 text-xs font-medium px-2 py-1 rounded">
                {trueCount}/{totalCount} Elements
              </span>
              <span className="text-xs text-gray-500">
                Score: {c.viability_score}/100
              </span>
              <span className="ml-auto text-sm text-blue-400 group-hover:text-blue-300 font-medium transition-colors">
                View Case &rarr;
              </span>
            </div>
          </div>
        </Link>
      </main>

      <DisclaimerFooter />
    </div>
  );
}

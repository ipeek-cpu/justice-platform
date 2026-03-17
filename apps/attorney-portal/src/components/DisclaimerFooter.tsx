/**
 * Disclaimer footer — ALWAYS visible, cannot be dismissed.
 * Required on every page per compliance rules.
 */
export function DisclaimerFooter() {
  return (
    <footer className="border-t border-gray-800 px-6 py-4 mt-8">
      <p className="text-xs text-gray-500 text-center max-w-2xl mx-auto">
        This assessment is educational only and does not constitute legal advice.
        Only a licensed attorney can determine whether a claim is viable.
        Case data shown is for attorney review purposes only and must not be shared
        with unauthorized parties.
      </p>
    </footer>
  );
}

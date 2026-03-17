import { DisclaimerFooter } from '@/components/DisclaimerFooter';

export default function DocumentsPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-xl font-bold">Documents</h1>
          <p className="text-sm text-gray-400">Centralized document portal for case-related uploads</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
          <p className="text-gray-400 mb-4">No documents uploaded yet.</p>
          <p className="text-sm text-gray-500">
            Documents uploaded by callers through the intake form will appear here for attorney review.
          </p>
        </div>
      </main>

      <DisclaimerFooter />
    </div>
  );
}

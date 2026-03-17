import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold mb-4">Attorney Portal</h1>
      <p className="text-gray-400 mb-8 text-center max-w-md">
        Secure case review and management for subscribed attorneys in the Justice Network.
      </p>
      <Link
        href="/login"
        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition-colors"
      >
        Sign In
      </Link>
    </main>
  );
}

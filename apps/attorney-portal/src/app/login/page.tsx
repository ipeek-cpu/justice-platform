'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Integrate with NextAuth magic link
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold mb-4">Check Your Email</h1>
          <p className="text-gray-400">
            We sent a sign-in link to <span className="text-white font-medium">{email}</span>.
            Click the link to access your dashboard.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold mb-2">Attorney Sign In</h1>
        <p className="text-gray-400 mb-6">Enter your email to receive a secure sign-in link.</p>
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@lawfirm.com"
            required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 mb-4 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-lg font-medium transition-colors"
          >
            Send Sign-In Link
          </button>
        </form>
      </div>
    </main>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { verifyPassword } from './actions';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await verifyPassword(password);
    if (result.success) {
      router.push('/dashboard');
    } else {
      setError('Invalid password');
    }
    setLoading(false);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 max-w-sm w-full">
        <h1 className="text-2xl font-bold mb-2">Demo Portal</h1>
        <p className="text-gray-400 mb-6 text-sm">Internal use only — Isaiah + Scott</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(''); }}
            placeholder="Enter password"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 mb-4 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white px-4 py-3 rounded-lg font-medium transition-colors"
          >
            {loading ? 'Checking...' : 'Enter'}
          </button>
        </form>
      </div>
    </main>
  );
}

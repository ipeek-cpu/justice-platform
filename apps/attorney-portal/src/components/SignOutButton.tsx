'use client';

import { useRouter } from 'next/navigation';
import { signOut } from '@/app/actions';

export function SignOutButton() {
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  return (
    <button
      onClick={handleSignOut}
      className="text-sm text-gray-400 hover:text-white transition-colors"
    >
      Sign Out
    </button>
  );
}

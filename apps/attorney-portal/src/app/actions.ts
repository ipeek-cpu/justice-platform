'use server';

import { cookies } from 'next/headers';

export async function verifyPassword(
  password: string,
): Promise<{ success: boolean }> {
  const expected = process.env.DEMO_PORTAL_PASSWORD ?? 'demo';
  if (password === expected) {
    const cookieStore = await cookies();
    cookieStore.set('attorney-auth', 'true', {
      httpOnly: true,
      secure: false, // localhost only
      sameSite: 'lax',
      maxAge: 60 * 60 * 8, // 8 hours
    });
    return { success: true };
  }
  return { success: false };
}

export async function signOut(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete('attorney-auth');
}

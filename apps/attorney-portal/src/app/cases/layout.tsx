import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function CasesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const auth = cookieStore.get('attorney-auth');

  if (!auth || auth.value !== 'true') {
    redirect('/');
  }

  return <>{children}</>;
}

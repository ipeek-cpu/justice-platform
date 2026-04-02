import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  if (cookieStore.get('demo-auth')?.value !== 'true') {
    redirect('/');
  }
  return <>{children}</>;
}

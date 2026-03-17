import cron from 'node-cron';
import { runProactiveChecks } from './proactive-agent';

export function startCronJobs(): void {
  // 8am every morning, Mac Mini local time
  cron.schedule('0 8 * * *', async () => {
    console.log('[cron] Running proactive checks...');
    await runProactiveChecks().catch(err =>
      console.error('[cron] Proactive check failed:', err)
    );
  });

  console.log('[cron] Proactive agent scheduled: 8am daily');
}

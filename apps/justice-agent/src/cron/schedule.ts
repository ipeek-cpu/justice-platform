import cron from 'node-cron';
import { runProactiveChecks, readState, updateState } from './proactive-agent';

export function startCronJobs(): void {
  // 8am every morning, Mac Mini local time
  cron.schedule('0 8 * * *', async () => {
    console.log('[cron] Running proactive checks...');
    await runProactiveChecks().catch(err =>
      console.error('[cron] Proactive check failed:', err)
    );
  });

  // 7am daily — morning summary backup (only fires if an overnight run completed)
  cron.schedule('0 7 * * *', async () => {
    console.log('[cron] Running morning summary check...');
    const state = readState();
    if (state.overnightRunComplete) {
      // Already sent via runOvernightSession — clear the flag
      updateState('overnightRunComplete', '');
    }
  }, { timezone: 'America/Chicago' });

  console.log('[cron] Proactive agent scheduled: 8am daily');
  console.log('[cron] Morning summary check scheduled: 7am CT daily');
}

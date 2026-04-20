import cron from 'node-cron';
import { runProactiveChecks, readState, updateState } from './proactive-agent';
import { sendIMessage } from '@justice/messaging';

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

  // Weekly Sunday prep — 8:00 PM Chicago time every Sunday
  cron.schedule('0 20 * * 0', async () => {
    console.log('[cron] Sending Sunday weekly prep...');
    try {
      const now = new Date();
      const tz = process.env.JUSTICE_TIMEZONE ?? 'America/Chicago';
      const todayStr = now.toLocaleDateString('en-CA', { timeZone: tz });
      const todayBase = new Date(todayStr + 'T12:00:00');
      const monday = new Date(todayBase.getTime() + 86_400_000);
      const sunday = new Date(monday.getTime() + 6 * 86_400_000);

      const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const weekRange = `${fmt(monday)} \u2013 ${fmt(sunday)}`;

      const message = [
        `Weekly Prep \u2014 Week of ${weekRange}`,
        ``,
        `Budgeting`,
        `  \u2022 Review last week's spending`,
        `  \u2022 Check runway (Wronged.ai + personal)`,
        `  \u2022 Any outstanding invoices or subscriptions to review?`,
        ``,
        `Planning`,
        `  \u2022 What are the 3 most important things this week?`,
        `  \u2022 Justice/Wronged.ai: any blockers to clear?`,
        `  \u2022 HLSTC: any PRs to review or merge?`,
        `  \u2022 Any job apps or outreach to prioritize?`,
        ``,
        `Health`,
        `  \u2022 Gym schedule set for the week?`,
        `  \u2022 Meal prep needed?`,
        ``,
        `Reflection`,
        `  \u2022 One win from last week`,
        `  \u2022 One thing to do differently`,
        ``,
        `Reply with anything you want me to schedule, track, or follow up on.`,
      ].join('\n');

      await sendIMessage(process.env.APPROVED_NUMBER_ISAIAH!, message);
      console.log('[cron] Sunday weekly prep sent');
    } catch (err) {
      console.error('[cron] Sunday weekly prep failed:', err);
    }
  }, { timezone: 'America/Chicago' });

  console.log('[cron] Proactive agent scheduled: 8am daily');
  console.log('[cron] Morning summary check scheduled: 7am CT daily');
  console.log('[cron] Sunday weekly prep scheduled: 8pm CT Sundays');
}

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Send iMessage via AppleScript on Mac Mini.
 * Callers NEVER see Wronged.ai or Justice branding.
 */
export async function sendIMessage(
  phoneNumber: string,
  message: string
): Promise<{ success: boolean; error?: string }> {
  const sanitizedPhone = phoneNumber.replace(/[^0-9+]/g, '');
  const sanitizedMessage = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

  const script = `
    tell application "Messages"
      set targetService to 1st service whose service type = iMessage
      set targetBuddy to buddy "${sanitizedPhone}" of targetService
      send "${sanitizedMessage}" to targetBuddy
    end tell
  `;

  try {
    await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('iMessage send failed:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

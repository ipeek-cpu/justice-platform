/*
 * Justice iMessage Listener — stable FDA wrapper
 *
 * Purpose: macOS Full Disk Access (FDA) is granted per-binary (path + cdhash).
 * Granting it directly to /opt/homebrew/bin/node breaks every time `brew
 * upgrade node` changes the Cellar path/signature. This tiny wrapper lives at a
 * FIXED path and is the binary you grant FDA to once. It SPAWNS the current
 * node as a child (it does not exec-replace itself), so it remains the
 * launchd job's main/"responsible" process — and its FDA grant propagates to
 * node and the sqlite3 child that reads chat.db. Upgrading node never changes
 * this wrapper, so the grant survives.
 *
 * Build (see scripts/build-listener-wrapper.sh):
 *   clang -O2 -o ~/.local/bin/justice-imessage-listener \
 *         scripts/justice-imessage-listener-wrapper.c
 *   codesign -s - --force ~/.local/bin/justice-imessage-listener
 *
 * Then point the LaunchAgent ProgramArguments at the wrapper and grant FDA to
 * ~/.local/bin/justice-imessage-listener in System Settings.
 */
#include <unistd.h>
#include <stdlib.h>
#include <sys/wait.h>

#define NODE_BIN  "/opt/homebrew/bin/node"
#define LISTENER  "/Users/justicewolf/Developer/justice-repo/scripts/justice-imessage-listener.js"
#define WORKDIR   "/Users/justicewolf/Developer/justice-repo"

int main(void) {
    char *const argv[] = { (char *)NODE_BIN, (char *)LISTENER, NULL };

    pid_t pid = fork();
    if (pid == 0) {
        /* child: run from the repo so Doppler resolves config, then exec node */
        if (chdir(WORKDIR) != 0) {
            _exit(126);
        }
        execv(NODE_BIN, argv);
        _exit(127); /* execv only returns on failure */
    }
    if (pid < 0) {
        return 1; /* fork failed */
    }

    int status = 0;
    waitpid(pid, &status, 0);
    return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}

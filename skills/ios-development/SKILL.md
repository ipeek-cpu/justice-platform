# iOS Development

## Setup
1. Read the relevant Notion page for task context
2. Clone or pull the latest from the iOS repo
3. Check deployment target and Swift version
4. Check for deprecated APIs in the codebase
5. Run `bd ready` and create a feature branch

## Before Writing Swift/Objective-C
- Read patterns: `bd list --label pattern --limit 5`
- Check for deprecated APIs: search for `@available` and `#available`
- Review existing code style and conventions in the file you're modifying

## Phase Structure
1. **Read** — Read all relevant source files, understand the architecture
2. **Implement** — Write the code changes
3. **Build Check** — Verify the build succeeds
4. **PR Draft** — Prepare branch and PR draft for review

## Build Verification
```bash
xcodebuild build \
  -project YourProject.xcodeproj \
  -scheme YourScheme \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -quiet
```

## Rules
- Never commit to main — always use feature branches
- Always build before requesting a push
- Always check deployment target compatibility before using new APIs
- Log build results to Notion before pinging Isaiah

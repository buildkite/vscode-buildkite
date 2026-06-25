# Contributing to the Buildkite VS Code Extension

A prior knowledge of TypeScript is not required, but it is recommended that you have some familiarity with it or JavaScript. See the [useful resources](#useful-resources) to read more about TypeScript.

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Running the Extension in Debug Mode

The extension can be run in VS Code's Extension Development Host:

1. Open this project in VS Code
2. Press `F5` or go to **Run > Start Debugging**
3. VS Code will then use the launch configuration in `.vscode/launch.json` to start the extension
4. This will:
   - Compile the TypeScript code
   - Open a new VS Code window (Extension Development Host) with your extension loaded
   - Allow you to set breakpoints and debug

Alternatively, you can use the watch mode to automatically recompile on changes:

```bash
npm run watch
```

Then press `F5` to launch the Extension Development Host.

### 3. Testing the Extension

Once running in the Extension Development Host:

1. Open the Command Palette (`Cmd+Shift+P` on Mac, `Ctrl+Shift+P` on Windows/Linux)
2. Sign in by running "Buildkite: Sign In", which opens your browser for OAuth,
   or "Buildkite: Set API Token" if you'd rather paste an API token
3. Try other commands like "Buildkite: List Pipelines"

## Project Structure

```txt
src/
├── api/
│   ├── auth.ts               # Auth manager (OAuth via vscode.authentication + PAT fallback)
│   ├── client.ts             # Buildkite API client (already built)
├── job/
│   └── jobCommands.ts        # Commands related to Buildkite jobs
├── pipeline/
│   └── pipelineCommands.ts   # Commands related to Buildkite pipelines
├── build/
│   └── buildCommands.ts      # Commands related to Buildkite builds
└── extension.ts              # Extension entry point and command registration
```

## Architecture Overview

### API Client (`src/api/client.ts`)

The `BuildkiteClient` class is **already built** and provides:

- `get<T>(endpoint: string)`: Generic GET request method
- `getOrganization()`: Fetches and caches the user's organization
- Automatic authentication via `AuthManager`
- Error handling for common API issues

**Example usage:**

```typescript
const client = new BuildkiteClient();
const org = await client.getOrganization();
const pipelines = await client.get(`/organizations/${org.slug}/pipelines`);
```

### Authentication (`src/api/auth.ts`)

`AuthManager` hides whether the active session came from OAuth or a stored
PAT behind a single `AuthSession` handle, so callers don't need to care
which is in use. It handles:

- OAuth sign in via the browser (PKCE + loopback redirect), with refresh
  token rotation and cross-window session adoption in `BuildkiteAuthProvider`
- PAT fallback for users who'd rather paste a token
- Scope-keyed in-flight dedup so concurrent sign in requests don't open
  two browser tabs
- 401 recovery for both sources, with user-facing prompts to update,
  clear or re-authenticate
- `onDidChangeCredential` events so the UI refreshes when the credential
  changes
- Secure storage via VS Code's `SecretStorage` API

### Command Structure

Commands follow this pattern:

1. **Define the command** in `package.json` under `contributes.commands`
2. **Implement the command function** in the appropriate file (e.g., `pipelineCommands.ts`)
3. **Register the command** in `extension.ts` using `vscode.commands.registerCommand`

**Example:** See `src/pipeline/pipelineCommands.ts:4` for the `listPipelines` implementation.

## Adding a New Command

1. **Add to `package.json`:**

   ```json
   {
     "command": "buildkite.myNewCommand",
     "title": "Buildkite: My New Command"
   }
   ```

2. **Implement the command function:**

   ```typescript
   // src/pipeline/pipelineCommands.ts (or appropriate file)
   export async function myNewCommand() {
     try {
       const client = new BuildkiteClient();
       // Your implementation here
     } catch (error) {
       if (error instanceof Error) {
         vscode.window.showErrorMessage(error.message);
       }
     }
   }
   ```

3. **Register in `extension.ts`:**

   ```typescript
   context.subscriptions.push(
     vscode.commands.registerCommand("buildkite.myNewCommand", myNewCommand)
   );
   ```

## Using the Buildkite API

Refer to the [Buildkite REST API Documentation](https://buildkite.com/docs/apis/rest-api) for available endpoints.

The `BuildkiteClient` automatically:

- Adds authentication headers
- Prefixes endpoints with the base URL (`https://api.buildkite.com/v2`)
- Handles errors and prompts for authentication if needed

## Development Tips

- **Use TypeScript interfaces** for API responses to get better type safety
- **Handle errors gracefully** using try-catch and `vscode.window.showErrorMessage`
- **Test thoroughly** in the Extension Development Host before committing
- **Follow VS Code's UX patterns** for consistency (see [VS Code Extension UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/overview))

## Analytics Build Key

Product analytics are compiled in at build time. `npm run compile` (and `npm run watch`) first run `scripts/generate-analytics-config.ts`, which reads the `POSTHOG_API_KEY` environment variable and writes the gitignored `src/analytics/posthogConfig.generated.ts`. With no key set, an empty key is baked in and analytics are disabled, which is the expected default for local development and open-source builds.

To build with analytics enabled, set the key before compiling:

```bash
POSTHOG_API_KEY=phc_... npm run compile
```

Release builds must set `POSTHOG_API_KEY` in the publishing environment; otherwise the published extension ships with analytics disabled.

When testing analytics in the Extension Development Host, note that pressing `F5` runs the `npm: watch` pre-launch task, which regenerates the config in VS Code's own environment. A key you set in a separate terminal (`POSTHOG_API_KEY=phc_... npm run compile`) is overwritten the moment you launch, so the running extension sees an empty key. To test with a key, launch VS Code from a shell where the variable is already exported:

```bash
export POSTHOG_API_KEY=phc_...
code .
```

The watch task inherits that environment, so `F5` bakes the key into each rebuild.

## Useful Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Buildkite REST API](https://buildkite.com/docs/apis/rest-api)
- [VS Code Extension Samples](https://github.com/microsoft/vscode-extension-samples)

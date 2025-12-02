# Buildkite VS Code Extension

A VS Code extension we are building, with the goal of providing a seamless integration between Buildkite and VS Code. We aim to solve 90% of the common use cases for Buildkite users currently performed in the UI.

A prior knowledge of TypeScript is not required, but it is recommended that you have some familiarity with it or JavaScript. See the [useful resources](#useful-resources) to read more about TypeScript.

## Getting Started

### 1. Install Dependencies

```bash
yarn
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
yarn watch
```

Then press `F5` to launch the Extension Development Host.

### 3. Testing the Extension

Once running in the Extension Development Host:

1. Open the Command Palette (`Cmd+Shift+P` on Mac, `Ctrl+Shift+P` on Windows/Linux)
2. Type "Buildkite: Set API Token" and enter your token
3. Try other commands like "Buildkite: List Pipelines"

## Project Structure

```txt
src/
├── api/
│   ├── auth.ts               # Authentication management using VS Code's SecretStorage
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

The `AuthManager` class is **already built** and handles:

- Secure token storage using VS Code's `SecretStorage` API
- Token retrieval with automatic prompting if missing
- Token clearing

### Command Structure

Commands follow this pattern:

1. **Define the command** in `package.json` under `contributes.commands`
2. **Implement the command function** in the appropriate file (e.g., `pipelineCommands.ts`)
3. **Register the command** in `extension.ts` using `vscode.commands.registerCommand`

**Example:** See `src/pipeline/pipelineCommands.ts:4` for the `listPipelines` implementation.

## Contributing

### Adding a New Command

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

### Using the Buildkite API

Refer to the [Buildkite REST API Documentation](https://buildkite.com/docs/apis/rest-api) for available endpoints.

The `BuildkiteClient` automatically:

- Adds authentication headers
- Prefixes endpoints with the base URL (`https://api.buildkite.com/v2`)
- Handles errors and prompts for authentication if needed

### Development Tips

- **Use TypeScript interfaces** for API responses to get better type safety
- **Handle errors gracefully** using try-catch and `vscode.window.showErrorMessage`
- **Test thoroughly** in the Extension Development Host before committing
- **Follow VS Code's UX patterns** for consistency (see [VS Code Extension UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/overview))

## Useful Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Buildkite REST API](https://buildkite.com/docs/apis/rest-api)
- [VS Code Extension Samples](https://github.com/microsoft/vscode-extension-samples)

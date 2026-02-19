import * as vscode from 'vscode';

/**
 * Singleton logger for the Buildkite extension.
 * Provides centralized logging to the VS Code Output panel.
 */
export class Logger {
    private static instance: Logger | null;
    private outputChannel: vscode.OutputChannel;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Buildkite');
    }

    /**
     * Gets the singleton instance of the Logger.
     */
    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * Logs an informational message.
     */
    info(message: string): void {
        this.log('INFO', message);
    }

    /**
     * Logs a warning message.
     */
    warn(message: string): void {
        this.log('WARN', message);
    }

    /**
     * Logs an error message with optional error details.
     */
    error(message: string, error?: Error): void {
        this.log('ERROR', message);
        if (error) {
            this.outputChannel.appendLine(`  ${error.message}`);
            if (error.stack) {
                this.outputChannel.appendLine(`  ${error.stack}`);
            }
        }
    }

    /**
     * Logs a debug message.
     */
    debug(message: string): void {
        this.log('DEBUG', message);
    }

    private log(level: string, message: string): void {
        const timestamp = new Date().toLocaleTimeString();
        this.outputChannel.appendLine(`[${timestamp}] [${level}] ${message}`);
    }

    /**
     * Shows the output channel in the UI.
     */
    show(): void {
        this.outputChannel.show();
    }

    /**
     * Clears all messages from the output channel.
     */
    clear(): void {
        this.outputChannel.clear();
    }

    /**
     * Disposes the output channel.
     */
    dispose(): void {
        this.outputChannel.dispose();
    }
}
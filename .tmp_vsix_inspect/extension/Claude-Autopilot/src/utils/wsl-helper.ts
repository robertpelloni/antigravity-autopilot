/**
 * WSL helper utilities for Windows command execution
 * On Windows, all commands should be executed through WSL for consistency
 */

/**
 * Wraps a command to run through WSL on Windows platforms
 * @param command The command to execute
 * @param args The arguments for the command
 * @returns Object with the wrapped command and args for spawn/spawnSync
 */
export function wrapCommandForWSL(command: string, args: string[] = []): { command: string; args: string[] } {
    if (process.platform === 'win32') {
        // On Windows, run everything through WSL
        return {
            command: 'wsl',
            args: [command, ...args]
        };
    } else {
        // On other platforms, use the command directly
        return {
            command,
            args
        };
    }
}

/**
 * Converts a Windows path to WSL path format
 * @param windowsPath The Windows path to convert
 * @returns WSL-compatible path
 */
export function convertToWSLPath(windowsPath: string): string {
    if (process.platform !== 'win32') {
        return windowsPath;
    }
    
    let wslPath = windowsPath;
    
    // Convert drive letter (e.g., C: -> /mnt/c, D: -> /mnt/d)
    wslPath = wslPath.replace(/^([A-Za-z]):/, (match, driveLetter) => {
        return `/mnt/${driveLetter.toLowerCase()}`;
    });
    
    // Convert backslashes to forward slashes
    wslPath = wslPath.replace(/\\/g, '/');
    
    return wslPath;
}

/**
 * Checks if WSL is available on Windows
 * @returns Promise<boolean> indicating WSL availability
 */
export async function isWSLAvailable(): Promise<boolean> {
    if (process.platform !== 'win32') {
        return true; // Not needed on non-Windows platforms
    }
    
    const { spawnSync } = await import('child_process');
    
    try {
        const { error, status } = spawnSync('wsl', ['--status'], {
            stdio: 'pipe',
            encoding: 'utf8',
            timeout: 3000
        });
        
        return !error && status === 0;
    } catch {
        return false;
    }
}
import { MobileInterface } from './core/MobileInterface.js';
import { FileExplorer } from './explorer/FileExplorer.js';
import { GitChanges } from './git/GitChanges.js';


// Initialize all components
const mobileInterface = new MobileInterface();
const fileExplorer = new FileExplorer();
const gitChanges = new GitChanges();

// Export for debugging if needed
window.mobileInterface = mobileInterface;
window.fileExplorer = fileExplorer;
window.gitChanges = gitChanges;
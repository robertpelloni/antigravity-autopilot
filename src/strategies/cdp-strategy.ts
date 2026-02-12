import * as vscode from 'vscode';
import { BlindBumpHandler } from './blind-bump-handler';

export class CDPStrategy {
    private blindBumpHandler: BlindBumpHandler;
    constructor() { this.blindBumpHandler = new BlindBumpHandler(null as any); }
}

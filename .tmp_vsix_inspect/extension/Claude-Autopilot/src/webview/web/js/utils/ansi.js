import { escapeHtml } from './html.js';

// ANSI Color palette for 256-color mode
export function getAnsiColors() {
    return {
    // Standard colors (0-15)
        0: '#000000', 1: '#cd0000', 2: '#00cd00', 3: '#cdcd00', 4: '#0000ee', 5: '#cd00cd', 6: '#00cdcd', 7: '#e5e5e5',
        8: '#7f7f7f', 9: '#ff0000', 10: '#00ff00', 11: '#ffff00', 12: '#5c5cff', 13: '#ff00ff', 14: '#00ffff', 15: '#ffffff',
        // More colors including common Claude colors
        52: '#5f0000', 88: '#870000', 124: '#af0000', 160: '#d70000', 196: '#ff0000',
        114: '#87d787', 118: '#87ff00', 148: '#afd700', 154: '#afff00', 190: '#d7ff00',
        174: '#d787af', 175: '#d787d7', 176: '#d787ff', 177: '#d7af5f', 178: '#d7af87',
        179: '#d7afaf', 180: '#d7afd7', 181: '#d7afff', 182: '#d7d75f', 183: '#d7d787',
        184: '#d7d7af', 185: '#d7d7d7', 186: '#d7d7ff', 187: '#d7ff5f', 188: '#d7ff87',
        189: '#d7ffaf', 190: '#d7ffd7', 191: '#d7ffff', 192: '#ff5f5f', 193: '#ff5f87',
        194: '#ff5faf', 195: '#ff5fd7', 196: '#ff5fff', 197: '#ff875f', 198: '#ff8787',
        199: '#ff87af', 200: '#ff87d7', 201: '#ff87ff', 202: '#ffaf5f', 203: '#ffaf87',
        204: '#ffafaf', 205: '#ffafd7', 206: '#ffafff', 207: '#ffd75f', 208: '#ffd787',
        209: '#ffd7af', 210: '#ffd7d7', 211: '#ffd7ff', 212: '#ffff5f', 213: '#ffff87',
        214: '#ffffaf', 215: '#ffffd7', 216: '#ffffff',
        // Claude specific colors
        220: '#ffd700', 231: '#ffffff', 244: '#808080', 246: '#949494',
        // Grays and commonly used colors
        232: '#080808', 233: '#121212', 234: '#1c1c1c', 235: '#262626', 236: '#303030', 237: '#3a3a3a',
        238: '#444444', 239: '#4e4e4e', 240: '#585858', 241: '#626262', 242: '#6c6c6c', 243: '#767676',
        244: '#808080', 245: '#8a8a8a', 246: '#949494', 247: '#9e9e9e', 248: '#a8a8a8', 249: '#b2b2b2',
        250: '#bcbcbc', 251: '#c6c6c6', 252: '#d0d0d0', 253: '#dadada', 254: '#e4e4e4', 255: '#eeeeee'
    };
}

export function processAnsiInText(text) {
    let html = '';
    let currentStyles = {
        color: null,
        bold: false,
        italic: false,
        dim: false,
        reverse: false
    };

    const ansiColors = getAnsiColors();

    // Split text into parts: text and ANSI escape sequences
    const parts = text.split(/(\x1b\[[0-9;]*m)/);

    for (let part of parts) {
        if (part.startsWith('\x1b[') && part.endsWith('m')) {
            // This is an ANSI color/style code
            const codes = part.slice(2, -1).split(';').filter(c => c !== '').map(Number);

            for (const code of codes) {
                if (code === 0 || code === 39) {
                    // Reset or default foreground color
                    currentStyles.color = null;
                    currentStyles.bold = false;
                    currentStyles.italic = false;
                    currentStyles.dim = false;
                    currentStyles.reverse = false;
                } else if (code === 1) {
                    currentStyles.bold = true;
                } else if (code === 22) {
                    currentStyles.bold = false;
                    currentStyles.dim = false;
                } else if (code === 2) {
                    currentStyles.dim = true;
                } else if (code === 3) {
                    currentStyles.italic = true;
                } else if (code === 23) {
                    currentStyles.italic = false;
                } else if (code === 7) {
                    currentStyles.reverse = true;
                } else if (code === 27) {
                    currentStyles.reverse = false;
                }
            }

            // Handle 256-color mode (38;5;n)
            for (let j = 0; j < codes.length - 2; j++) {
                if (codes[j] === 38 && codes[j + 1] === 5) {
                    const colorCode = codes[j + 2];
                    currentStyles.color = ansiColors[colorCode] || '#ffffff';
                    break;
                }
            }
        } else if (part.length > 0) {
            // This is actual text content - sanitize it
            let style = '';
            if (currentStyles.color) style += `color: ${currentStyles.color};`;
            if (currentStyles.bold) style += 'font-weight: bold;';
            if (currentStyles.italic) style += 'font-style: italic;';
            if (currentStyles.dim) style += 'opacity: 0.6;';
            if (currentStyles.reverse) style += 'background-color: #ffffff; color: #000000;';

            // Sanitize HTML characters
            const escapedText = escapeHtml(part);

            if (style) {
                html += `<span style="${style}">${escapedText}</span>`;
            } else {
                html += escapedText;
            }
        }
    }

    return html;
}

export function parseAnsiToHtml(text) {
    // Remove cursor control sequences that don't affect display
    text = text.replace(/\x1b\[\?25[lh]/g, ''); // Show/hide cursor
    text = text.replace(/\x1b\[\?2004[lh]/g, ''); // Bracketed paste mode
    text = text.replace(/\x1b\[\?1004[lh]/g, ''); // Focus reporting
    // Don't remove clear screen codes - let performClaudeRender detect them
    // text = text.replace(/\x1b\[[2-3]J/g, ''); // Clear screen codes
    text = text.replace(/\x1b\[H/g, ''); // Move cursor to home

    // Process the text line by line to handle carriage returns properly
    const lines = text.split('\n');
    const processedLines = [];

    for (let lineText of lines) {
    // Handle carriage returns within the line
        const parts = lineText.split('\r');
        let finalLine = '';

        for (let i = 0; i < parts.length; i++) {
            if (i === parts.length - 1) {
                // Last part - append normally
                finalLine += processAnsiInText(parts[i]);
            } else {
                // Not the last part - this will be overwritten by the next part
                finalLine = processAnsiInText(parts[i]);
            }
        }

        processedLines.push(finalLine);
    }

    return processedLines.join('\n');
}
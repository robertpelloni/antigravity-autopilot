// ANSI escape sequence parsing utilities
import { ansiColors } from '../core/state.js';
import { sanitizeHtml } from '../security/validation.js';

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

export function processAnsiInText(text) {
  let html = '';
  let currentStyles = {
    color: null,
    bold: false,
    italic: false,
    dim: false,
    reverse: false
  };

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
      const escapedText = sanitizeHtml(part);

      if (style) {
        html += `<span style="${style}">${escapedText}</span>`;
      } else {
        html += escapedText;
      }
    }
  }

  return html;
}
// Web interface management
import { webServerStatus, updateWebServerStatus } from '../core/state.js';
import { 
  sendStartWebInterface, 
  sendStopWebInterface, 
  sendShowWebInterfaceQR, 
  sendOpenWebInterface,
  sendGetWebServerStatus 
} from '../communication/vscode-api.js';

export function startWebInterface() {
  sendStartWebInterface();
}

export function stopWebInterface() {
  sendStopWebInterface();
}

export function showWebInterfaceQR() {
  sendShowWebInterfaceQR();
}

export function openWebInterface() {
  sendOpenWebInterface();
}

export function updateWebServerStatusFromMessage(status) {
  updateWebServerStatus(status);
    
  const statusIndicator = document.getElementById('webStatusIndicator');
  const statusText = document.getElementById('webStatusText');
  const serverDetails = document.getElementById('webServerDetails');
  const serverUrl = document.getElementById('webServerUrl');
  const serverType = document.getElementById('webServerType');
  const serverSecurity = document.getElementById('webServerSecurity');
    
  const startBtn = document.getElementById('startWebBtn');
  const stopBtn = document.getElementById('stopWebBtn');
  const showQRBtn = document.getElementById('showQRBtn');
  const openWebBtn = document.getElementById('openWebBtn');
    
  if (status.running) {
    // Update status indicator
    if (statusIndicator) {
      statusIndicator.innerHTML = '<div class="pulse-dot-success"></div><span id="webStatusText">Web server is running</span>';
    }
        
    // Show server details
    if (serverDetails) {
      serverDetails.style.display = 'block';
    }
    if (serverUrl) {
      serverUrl.textContent = status.url || 'Unknown';
    }
    if (serverType) {
      serverType.textContent = status.isExternal ? 'External (ngrok)' : 'Local network';
    }
    if (serverSecurity) {
      let securityText = status.hasPassword ? 'Password protected' : 'No password';
      if (status.blockedIPs > 0) {
        securityText += ` (${status.blockedIPs} blocked IPs)`;
      }
      serverSecurity.textContent = securityText;
    }
        
    // Update buttons
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;
    if (showQRBtn) showQRBtn.disabled = false;
    if (openWebBtn) openWebBtn.disabled = false;
  } else {
    // Update status indicator
    if (statusIndicator) {
      statusIndicator.innerHTML = '<div class="pulse-dot-grey"></div><span id="webStatusText">Web server is stopped</span>';
    }
        
    // Hide server details
    if (serverDetails) {
      serverDetails.style.display = 'none';
    }
        
    // Update buttons
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    if (showQRBtn) showQRBtn.disabled = true;
    if (openWebBtn) openWebBtn.disabled = true;
  }
}

export function requestWebServerStatus() {
  sendGetWebServerStatus();
}

// Periodically check web server status to keep buttons in sync
export function startWebServerStatusPolling() {
  // Check every 5 seconds
  setInterval(() => {
    sendGetWebServerStatus();
  }, 5000);
}
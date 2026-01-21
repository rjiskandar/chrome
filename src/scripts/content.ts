/*
 * Content Script
 * Runs in isolated context, bridges Inpage Script <-> Background
 */

// 1. Inject inpage.js
const injectScript = () => {
    try {
        const container = document.head || document.documentElement;
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('inpage.js');
        script.type = 'module';
        script.async = false; // Ensure synchronous load if possible
        container.insertBefore(script, container.children[0]);
        // container.removeChild(script); // JANGAN DIHAPUS DULU
        console.log("[Lumen] Content script injected inpage.js from:", script.src);
    } catch (e) {
        console.error("[Lumen] Injection failed", e);
    }
};

injectScript();

// 2. Listen for messages from Inpage Script (Webpage)
window.addEventListener("message", (event) => {
    // Only accept messages from same window
    if (event.source !== window) return;

    if (event.data?.type === "LUMEN_WALLET_REQUEST") {
        // Forward to Background
        console.log("[Lumen-CS] Forwarding request to background:", event.data);

        chrome.runtime.sendMessage(event.data, (response) => {
            // Send response back to Inpage
            window.postMessage({
                type: "LUMEN_WALLET_RESPONSE",
                id: event.data.id,
                error: chrome.runtime.lastError ? chrome.runtime.lastError.message : (response?.error),
                result: response?.result
            }, "*");
        });
    }
});

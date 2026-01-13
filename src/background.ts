/* Background Service Worker */
import { Buffer } from 'buffer';

// Keep the side panel behavior
chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch((error) => console.error(error));

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'openSidePanel',
        title: 'Open Side Panel',
        contexts: ['all']
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'openSidePanel' && tab?.windowId) {
        chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
    }
});

/* --- Wallet Provider Logic --- */

interface WebRequestPayload {
    method: string;
    params?: any[];
}

interface PublicSession {
    address: string;
    pubKey: string;
    algo: string;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "LUMEN_WALLET_REQUEST") {
        handleRequest(message, sender, sendResponse);
        return true; // Keep channel open for async response
    }
});

async function handleRequest(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) {
    const { id, payload } = message;
    const { method, params } = payload as WebRequestPayload;
    const origin = sender.url ? new URL(sender.url).origin : "unknown";

    console.log(`[Lumen-BG] Request ${id} from ${origin}: ${method}`, params);

    try {
        let result: any;

        switch (method) {
            case "enable":
                /* 
                 * TODO: Check if origin is trusted. Use Storage.
                 * For MVP: Auto-approve to verify connectivity.
                 */
                // await requestApproval(origin);
                result = true;
                break;

            case "getKey":
                const pubKeyData = await getPublicKeyFromStorage();
                if (!pubKeyData) {
                    throw new Error("Wallet is locked or not initialized.");
                }

                result = {
                    name: "Lumen User",
                    algo: "secp256k1",
                    pubKey: new Uint8Array(Buffer.from(pubKeyData.pubKey, 'hex')),
                    address: new Uint8Array(Buffer.from(pubKeyData.address, 'hex')),
                    bech32Address: pubKeyData.address,
                    isNanoLedger: false
                };
                break;

            case "signDirect":
                // Trigger Popup for Signing
                throw new Error("UI for signing not implemented yet.");

            case "signAmino":
                throw new Error("Amino signing not supported yet.");

            default:
                throw new Error("Unknown method: " + method);
        }

        sendResponse({ result });

    } catch (e: any) {
        console.error("[Lumen-BG] Error:", e);
        sendResponse({ error: e.message });
    }
}

async function getPublicKeyFromStorage(): Promise<PublicSession | null> {
    const session = await chrome.storage.local.get('lumen_public_session');
    // @ts-ignore
    return session?.lumen_public_session as PublicSession || null;
}

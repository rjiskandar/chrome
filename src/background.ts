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

interface ChainInfo {
    chainId: string;
    chainName: string;
    rpc: string;
    rest: string;
    bip44: { coinType: number };
    bech32Config: Record<string, string>;
    currencies: any[];
    feeCurrencies: any[];
    stakeCurrency: any;
    features: any[];
}

type ChainRegistry = Record<string, ChainInfo>;

/* --- Pending Connection Requests --- */

interface PendingRequest {
    id: string;
    origin: string;
    chainId: string;
    timestamp: number;
    resolve?: (value: any) => void;
    reject?: (error: Error) => void;
}

const pendingRequests = new Map<string, PendingRequest>();

function generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Lumen Chain Configuration
const LUMEN_CHAIN_INFO = {
    chainId: "lumen",
    chainName: "Lumen Mainnet",
    rpc: "https://rpc-lumen.winnode.xyz",
    rest: "https://api-lumen.winnode.xyz",
    bip44: {
        coinType: 118,
    },
    bech32Config: {
        bech32PrefixAccAddr: "lmn1",
        bech32PrefixAccPub: "lmnpub",
        bech32PrefixValAddr: "lmnvaloper",
        bech32PrefixValPub: "lmnvaloperpub",
        bech32PrefixConsAddr: "lmnvalcons",
        bech32PrefixConsPub: "lmnvalconspub"
    },
    currencies: [
        {
            coinDenom: "LMN",
            coinMinimalDenom: "ulmn",
            coinDecimals: 6,
        }
    ],
    feeCurrencies: [
        {
            coinDenom: "LMN",
            coinMinimalDenom: "ulmn",
            coinDecimals: 6,
        }
    ],
    stakeCurrency: {
        coinDenom: "LMN",
        coinMinimalDenom: "ulmn",
        coinDecimals: 6,
    },
    features: []
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "LUMEN_WALLET_REQUEST") {
        handleRequest(message, sender, sendResponse);
        return true; // Keep channel open for async response
    }

    // Handle approval from popup UI
    if (message?.type === "APPROVE_CONNECTION") {
        console.log("[Lumen-BG] ✅ Connection approved for request:", message.requestId);
        const request = pendingRequests.get(message.requestId);
        if (request) {
            request.resolve?.(request.chainId);
            pendingRequests.delete(message.requestId);
            sendResponse({ success: true });
        } else {
            sendResponse({ success: false, error: "Request not found" });
        }
        return true;
    }

    // Handle rejection from popup UI
    if (message?.type === "REJECT_CONNECTION") {
        console.log("[Lumen-BG] ❌ Connection rejected for request:", message.requestId);
        const request = pendingRequests.get(message.requestId);
        if (request) {
            request.reject?.(new Error("User rejected the connection request"));
            pendingRequests.delete(message.requestId);
            sendResponse({ success: true });
        } else {
            sendResponse({ success: false, error: "Request not found" });
        }
        return true;
    }

    // Get pending requests (for popup UI)
    if (message?.type === "GET_PENDING_REQUESTS") {
        const requests = Array.from(pendingRequests.values()).map(req => ({
            id: req.id,
            origin: req.origin,
            chainId: req.chainId,
            timestamp: req.timestamp
        }));
        console.log("[Lumen-BG] 📋 Returning pending requests:", requests.length);
        sendResponse({ requests });
        return true;
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
                 * Auto-suggest Lumen chain if not already configured
                 * This prevents "no modular chain info" error
                 */
                console.log("[Lumen-BG] 🟢 Enable method called");
                const chainId = params?.[0] || "lumen";

                // Auto-inject Lumen chain config on first enable
                if (chainId === "lumen") {
                    console.log("[Lumen-BG] Auto-suggesting Lumen chain...");
                    await autoSuggestLumenChain();
                }

                // Create pending request IMMEDIATELY so it exists when UI checks for it
                const requestId = generateRequestId();
                console.log("[Lumen-BG] 🔐 Creating pending request:", requestId);

                const approval = new Promise<string>(async (resolve, reject) => {
                    // Register request
                    pendingRequests.set(requestId, {
                        id: requestId,
                        origin: origin,
                        chainId: chainId,
                        timestamp: Date.now(),
                        resolve: (val) => {
                            // Clear timeout if valid
                            resolve(val);
                        },
                        reject
                    });

                    // Auto-cleanup after 5 minutes
                    setTimeout(() => {
                        if (pendingRequests.has(requestId)) {
                            pendingRequests.delete(requestId);
                            reject(new Error("Connection request timeout"));
                        }
                    }, 300000);

                    // Check if wallet is unlocked
                    const initialPubKeyData = await getPublicKeyFromStorage();
                    const isUnlocked = initialPubKeyData !== null && initialPubKeyData.address && initialPubKeyData.pubKey;

                    if (!isUnlocked) {
                        console.log("[Lumen-BG] 🔒 Wallet is locked - opening unlock screen first");

                        // Open popup at unlock screen (normal flow)
                        await openExtensionPopup();

                        // Wait for wallet to be unlocked
                        const unlockWaiter = new Promise<void>((resolveUnlock, rejectUnlock) => {
                            let attempts = 0;
                            const maxAttempts = 120; // 2 minutes

                            const checkInterval = setInterval(async () => {
                                attempts++;
                                const newPubKeyData = await getPublicKeyFromStorage();

                                if (newPubKeyData !== null && newPubKeyData.address) {
                                    console.log("[Lumen-BG] ✅ Wallet unlocked!");
                                    clearInterval(checkInterval);
                                    resolveUnlock();
                                } else if (attempts >= maxAttempts) {
                                    clearInterval(checkInterval);
                                    rejectUnlock(new Error("Unlock timeout - user did not unlock wallet"));
                                }
                            }, 1000);
                        });

                        try {
                            await unlockWaiter;
                        } catch (error: any) {
                            console.error("[Lumen-BG] Unlock failed:", error);
                            pendingRequests.delete(requestId);
                            reject(new Error(error.message || "User must unlock wallet to connect"));
                            return;
                        }
                    }

                    console.log("[Lumen-BG] 🔓 Wallet is unlocked - proceeding with approval");

                    // Open/focus popup for approval screen
                    // If wallet was just unlocked, popup is already open, just need to trigger re-render
                    console.log("[Lumen-BG] 🪟 Opening/focusing popup for approval...");
                    await openExtensionPopup();
                });

                // Open/focus popup for approval screen
                // If wallet was just unlocked, popup is already open, just need to trigger re-render
                console.log("[Lumen-BG] 🪟 Opening/focusing popup for approval...");
                await openExtensionPopup();

                // Wait for user decision
                console.log("[Lumen-BG] ⏳ Waiting for user approval...");
                result = await approval;
                console.log("[Lumen-BG] ✅ Enable completed, returning:", result);
                break;

            case "experimentalSuggestChain":
                /* 
                 * Store chain configuration suggested by dApp
                 * For now, just accept it
                 */
                const chainInfo = params?.[0];
                console.log("[Lumen-BG] Chain suggested:", chainInfo);

                // Store in local storage for future reference
                if (chainInfo?.chainId) {
                    const chains = await chrome.storage.local.get('lumen_chains');
                    const existingChains = (chains.lumen_chains || {}) as ChainRegistry;
                    existingChains[chainInfo.chainId] = chainInfo;
                    await chrome.storage.local.set({ lumen_chains: existingChains });
                }

                result = undefined; // Keplr returns void
                break;

            case "getKey":
                const pubKeyData = await getPublicKeyFromStorage();
                if (!pubKeyData) {
                    throw new Error("Wallet is locked or not initialized.");
                }

                // Validate data before creating Buffers
                if (!pubKeyData.pubKey || !pubKeyData.address) {
                    console.error("[Lumen-BG] Invalid public key data:", pubKeyData);
                    throw new Error("Wallet public key data is incomplete. Please unlock your wallet.");
                }

                try {
                    result = {
                        name: "Lumen User",
                        algo: "secp256k1",
                        pubKey: new Uint8Array(Buffer.from(pubKeyData.pubKey, 'hex')),
                        address: new Uint8Array(Buffer.from(pubKeyData.address, 'hex')),
                        bech32Address: pubKeyData.address,
                        isNanoLedger: false
                    };
                } catch (error) {
                    console.error("[Lumen-BG] Error creating key response:", error);
                    throw new Error("Failed to format wallet key data. Please unlock your wallet and try again.");
                }
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

async function autoSuggestLumenChain() {
    // Store Lumen chain config so dApp can find it
    const chains = await chrome.storage.local.get('lumen_chains');
    const existingChains = (chains.lumen_chains || {}) as ChainRegistry;

    if (!existingChains['lumen']) {
        existingChains['lumen'] = LUMEN_CHAIN_INFO;
        await chrome.storage.local.set({ lumen_chains: existingChains });
        console.log("[Lumen-BG] Auto-injected Lumen chain config");
    }
}

async function openExtensionPopup() {
    try {
        console.log("[Lumen-BG] 🪟 openExtensionPopup called");

        // Check if popup is already open
        const existingWindows = await chrome.windows.getAll({ populate: true });
        console.log("[Lumen-BG] Existing windows:", existingWindows.length);

        const popupExists = existingWindows.some(
            w => w.type === 'popup' && w.tabs?.some(t => t.url?.includes(chrome.runtime.id))
        );

        if (popupExists) {
            console.log("[Lumen-BG] Extension popup already open");
            return;
        }

        // Get current screen size dynamically
        const currentWindow = await chrome.windows.getCurrent();
        const screenWidth = currentWindow.width || 1920;
        const screenHeight = currentWindow.height || 1080;
        const popupWidth = 400;
        const popupHeight = 600;

        console.log("[Lumen-BG] Creating popup window...");

        const popup = await chrome.windows.create({
            url: chrome.runtime.getURL('index.html'),
            type: 'popup',
            width: popupWidth,
            height: popupHeight,
            left: Math.round((screenWidth - popupWidth) / 2),
            top: Math.round((screenHeight - popupHeight) / 2),
            focused: true
        });

        console.log("[Lumen-BG] ✅ Extension popup opened, window ID:", popup?.id);
    } catch (error) {
        console.error("[Lumen-BG] ❌ Failed to open popup window:", error);
        console.error("[Lumen-BG] Error details:", error instanceof Error ? error.message : String(error));

        // Fallback: try to open the default popup
        try {
            console.log("[Lumen-BG] Trying fallback: chrome.action.openPopup()");
            await chrome.action.openPopup();
            console.log("[Lumen-BG] ✅ Opened default popup");
        } catch (fallbackError) {
            console.error("[Lumen-BG] ❌ Fallback also failed:", fallbackError);
        }
    }
}

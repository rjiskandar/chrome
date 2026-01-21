/* 
 * Inpage Script
 * Injected by content.ts into the webpage context.
 * Exposes window.lumen and window.keplr APIs.
 */

console.log("[Lumen Wallet] Inpage Script Loaded");

class LumenProvider {
    version = "1.0.0";
    mode = "extension";

    async enable(chainId: string) {
        console.log("[Lumen] Enable requested for chain:", chainId);
        return this.request({ method: "enable", params: [chainId] });
    }

    async experimentalSuggestChain(chainInfo: any) {
        console.log("[Lumen] experimentalSuggestChain called (not implemented):", chainInfo);
        // For now, just accept any chain suggestion
        return Promise.resolve();
    }

    async getKey(chainId: string) {
        return this.request({ method: "getKey", params: [chainId] });
    }

    async getOfflineSigner(chainId: string) {
        // Return a dummy signer that delegates to request()
        return {
            getAccounts: async () => {
                const key = await this.getKey(chainId);
                return [{
                    address: key.bech32Address,
                    algo: "secp256k1", // TODO: Support Dilithium algo ID if needed
                    pubkey: new Uint8Array(Buffer.from(key.pubKey, 'hex'))
                }];
            },
            signDirect: async (signerAddress: string, signDoc: any) => {
                return this.request({
                    method: "signDirect",
                    params: [chainId, signerAddress, signDoc]
                });
            },
            signAmino: async (signerAddress: string, signDoc: any) => {
                return this.request({
                    method: "signAmino",
                    params: [chainId, signerAddress, signDoc]
                });
            }
        };
    }

    async getOfflineSignerAuto(chainId: string) {
        return this.getOfflineSigner(chainId);
    }

    async getOfflineSignerOnlyAmino(chainId: string) {
        return this.getOfflineSigner(chainId);
    }

    // Generic Request Handler
    private request(args: { method: string, params?: any[] }): Promise<any> {
        return new Promise((resolve, reject) => {
            const id = Date.now().toString() + Math.random().toString();

            // Listen for response
            const listener = (event: MessageEvent) => {
                if (event.data?.type === "LUMEN_WALLET_RESPONSE" && event.data.id === id) {
                    window.removeEventListener("message", listener);
                    if (event.data.error) {
                        reject(new Error(event.data.error));
                    } else {
                        resolve(event.data.result);
                    }
                }
            };
            window.addEventListener("message", listener);

            // Send to Content Script
            window.postMessage({
                type: "LUMEN_WALLET_REQUEST",
                id,
                payload: args
            }, "*");
        });
    }
}

const provider = new LumenProvider();

// Inject API
// @ts-ignore
window.lumen = provider;
// @ts-ignore
window.keplr = provider; // Compatibility Mode

console.log("[Lumen] Provider injected as window.lumen & window.keplr");

// Announce wallet availability to dApps (Cosmos Kit detection)
// Announce wallet availability to dApps (Cosmos Kit detection)
// Dispatch immediately for dApps that are already listening or check on load
window.dispatchEvent(new Event('keplr_keystorechange'));
window.dispatchEvent(new Event('lumen_keystorechange'));

// Also dispatch on window load to ensure dApps initialized
window.addEventListener('load', () => {
    window.dispatchEvent(new Event('keplr_keystorechange'));
    window.dispatchEvent(new Event('lumen_keystorechange'));
    console.log("[Lumen] Re-dispatched keystore change events on load");
});

console.log("[Lumen] Dispatched 'keplr_keystorechange' event");


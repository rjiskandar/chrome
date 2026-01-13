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

// Inject API
// @ts-ignore
window.lumen = new LumenProvider();
// @ts-ignore
window.keplr = window.lumen; // Compatibility Mode

console.log("[Lumen] Provider injected as window.lumen & window.keplr");

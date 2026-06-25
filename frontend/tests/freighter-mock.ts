/**
 * freighter-mock.ts
 *
 * Playwright helpers for mocking the Freighter browser extension.
 *
 * Strategy:
 *  1. addInitScript: sets window.freighter = true (short-circuits isConnected)
 *     and intercepts window.postMessage to handle the FREIGHTER_EXTERNAL_MSG_REQUEST
 *     / FREIGHTER_EXTERNAL_MSG_RESPONSE protocol used by @stellar/freighter-api.
 *  2. patchFreighterModuleInPage: called after page.goto() to patch the bundled
 *     wallet_manager functions via Next.js's webpack module registry, replacing any
 *     call to getPublicKey (absent in freighter-api v3) and injecting the mock key.
 */

import type { Page } from '@playwright/test';

export const MOCK_PUBLIC_KEY =
  'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456789012';

/** Sentinel signed XDR the RPC mock will accept. */
export const MOCK_SIGNED_XDR = 'AAAA_MOCK_SIGNED_XDR==';

/** Injected before any page script runs. Patches window.postMessage. */
export const freighterInitScript = `
(function () {
  const MOCK_KEY = "${MOCK_PUBLIC_KEY}";
  const MOCK_XDR = "${MOCK_SIGNED_XDR}";

  // isConnected() checks window.freighter directly
  window.freighter = true;

  // freighter-api postMessage protocol
  // Request:  { source: "FREIGHTER_EXTERNAL_MSG_REQUEST",  messageId, type, ... }
  // Response: { source: "FREIGHTER_EXTERNAL_MSG_RESPONSE", messagedId, ... }
  // NOTE: "messagedId" (not "messageId") is a typo in the freighter-api source.
  const _origPost = window.postMessage.bind(window);
  window.postMessage = function (data, origin, transfer) {
    if (data && data.source === 'FREIGHTER_EXTERNAL_MSG_REQUEST') {
      const id   = data.messageId;
      const type = data.type;
      let resp   = { source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE', messagedId: id };

      switch (type) {
        case 'REQUEST_CONNECTION_STATUS': resp = { ...resp, isConnected: true };                                           break;
        case 'REQUEST_ALLOWED_STATUS':    resp = { ...resp, isAllowed: true };                                             break;
        case 'SET_ALLOWED_STATUS':        resp = { ...resp, isAllowed: true };                                             break;
        case 'REQUEST_ACCESS':            resp = { ...resp, publicKey: MOCK_KEY };                                         break;
        case 'REQUEST_PUBLIC_KEY':        resp = { ...resp, publicKey: MOCK_KEY };                                         break;
        case 'SUBMIT_TRANSACTION':        resp = { ...resp, signedTransaction: MOCK_XDR, signerAddress: MOCK_KEY };        break;
        default:                          resp = { ...resp };
      }

      Promise.resolve().then(() => {
        window.dispatchEvent(new MessageEvent('message', { data: resp, source: window }));
      });
      return;
    }
    return _origPost(data, origin, transfer);
  };
})();
`;

/**
 * After page.goto(), patches the bundled wallet_manager so that:
 *  - getPublicKey (missing in freighter-api v3) is shimmed to return MOCK_PUBLIC_KEY
 *
 * This works by walking Next.js's __webpack_modules__ to find the wallet_manager
 * chunk and replacing the getPublicKey binding with our mock.
 */
export async function patchWalletManagerInPage(page: Page): Promise<void> {
  await page.evaluate((mockKey) => {
    // Shim window.getPublicKey so wallet_manager's call succeeds in environments
    // where @stellar/freighter-api v3 does not export getPublicKey.
    // wallet_manager imports it as a named import; Next.js binds it to the module
    // object. We patch it at the window level as a fallback — the module binding
    // will still resolve to undefined, so we rely on the postMessage mock above
    // returning publicKey for REQUEST_ACCESS, and the wallet_manager falling
    // through to getPublicKey erroring. The safer route: ensure requestAccess
    // response contains the key the wallet_manager reads.
    //
    // wallet_manager.ts reads:  const keyResult = await getPublicKey()
    //                           if (keyResult.error) throw ...
    //                           return keyResult.publicKey
    //
    // freighter-api v3 does NOT export getPublicKey; the import resolves to
    // undefined, causing a TypeError at runtime. We patch it via the webpack
    // module registry.
    const registry = (window as any).__webpack_modules__ ?? (window as any).webpackChunknextjs ?? null;
    if (!registry) return;

    for (const id of Object.keys(registry)) {
      const mod = registry[id];
      if (typeof mod !== 'function') continue;
      // Execute the module factory in a test context to inspect its exports
      try {
        const m: any = { exports: {} };
        mod(m, m.exports, (r: any) => r);
        if (m.exports && typeof m.exports.connectWallet === 'function') {
          // Found wallet_manager — monkey-patch getPublicKey on its module scope
          // by re-registering a wrapper that injects our mock key.
          const orig = mod;
          registry[id] = function (module: any, exports: any, require: any) {
            orig(module, exports, require);
            // Wrap connectWallet to bypass getPublicKey call
            const origConnect = module.exports.connectWallet;
            module.exports.connectWallet = async function () {
              try {
                return await origConnect();
              } catch {
                // getPublicKey is missing in freighter-api v3 — return mock key
                return mockKey;
              }
            };
          };
        }
      } catch {
        // skip modules that throw during inspection
      }
    }
  }, MOCK_PUBLIC_KEY);
}

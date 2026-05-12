export const metadata = { title: "Privacy Policy — Morning Edge" };

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-12 max-w-2xl mx-auto text-slate-800">
      <a href="/" className="text-sm text-slate-500 underline">← Back</a>
      <h1 className="text-3xl font-bold mt-6 mb-2">Privacy Policy</h1>
      <p className="text-sm text-slate-500 mb-8">Last updated: May 12, 2026</p>

      <div className="space-y-5 leading-relaxed">
        <p>
          <strong>Overview.</strong> Morning Edge is a personal markets and wellness companion built by Tarun Prasad. We collect as little personal information as possible and never sell your data. This policy explains, in plain English, exactly what we do and do not do with the information you provide.
        </p>

        <p>
          <strong>No account required.</strong> You can use Morning Edge without signing up, logging in, or providing your name, email, or any personal identifier. Optional fields (such as your first name) are used only to personalize the brief you see on your own device.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-1">What we store on your device</h2>
        <p>
          The following are kept only in your browser&apos;s local storage on the device you&apos;re using. They are not synced to a server or to any other device:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Your name (if you entered one)</li>
          <li>Your watchlist tickers and uploaded portfolio holdings (symbol, share quantity, cost basis, broker label)</li>
          <li>Your routine completion history, decision history, and other in-app preferences</li>
          <li>Briefs from the past 30 days, cached so the app loads fast</li>
        </ul>
        <p>
          You can clear all of this at any time by clearing your browser&apos;s site data, or by deleting and reinstalling the app.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-1">What we send to our servers when you generate a brief</h2>
        <p>
          To generate a personalized morning brief, the app sends the following to our backend on Vercel:
        </p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Your portfolio holdings (ticker, share quantity, cost basis, percent gain, optional account label)</li>
          <li>Your watchlist tickers</li>
          <li>Your first name, if you entered one</li>
          <li>The current date</li>
        </ul>
        <p>
          We use this data to construct the prompts sent to Anthropic&apos;s Claude API. We cache the generated brief on our servers (via Upstash Redis) for up to 30 hours so reloads return instantly. The cache is keyed to a hash of your holdings — it is not associated with any name, email, IP address, or other identifier.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-1">Third-party services we use</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            <strong>Anthropic (Claude API):</strong> We send each brief-generation request to the Anthropic Claude API. Anthropic processes the prompt to return the brief content. See <a className="underline" href="https://www.anthropic.com/legal/privacy">anthropic.com/legal/privacy</a>.
          </li>
          <li>
            <strong>Vercel:</strong> Our hosting provider. Vercel automatically records access logs (IP, user-agent, URL) for the live site. See <a className="underline" href="https://vercel.com/legal/privacy-policy">vercel.com/legal/privacy-policy</a>.
          </li>
          <li>
            <strong>Upstash (Redis):</strong> Used to cache generated briefs server-side. Cached entries are keyed to a hash of your holdings, not to your identity, and expire automatically. See <a className="underline" href="https://upstash.com/trust/privacy.pdf">upstash.com/trust/privacy</a>.
          </li>
          <li>
            <strong>Yahoo Finance (yahoo-finance2):</strong> Used to fetch live stock prices for the ticker tape and in-chat questions. Only ticker symbols are sent — no personal information.
          </li>
        </ul>

        <h2 className="text-xl font-semibold mt-6 mb-1">What we do not do</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>We do not sell, rent, or share your data with advertisers or data brokers.</li>
          <li>We do not track you across other apps or websites.</li>
          <li>We do not use analytics services that profile you (no Google Analytics, no Meta Pixel, no Mixpanel).</li>
          <li>We do not request, store, or transmit your brokerage login credentials. Portfolio data only enters Morning Edge if you choose to upload a CSV that you exported yourself.</li>
          <li>We do not make any trades, place any orders, or execute any transactions on your behalf.</li>
        </ul>

        <h2 className="text-xl font-semibold mt-6 mb-1">Not financial advice</h2>
        <p>
          Morning Edge is an informational and educational tool. It is not a brokerage, an investment advisor, or a registered financial service. AI-generated content can be inaccurate or out of date. Nothing in the app should be treated as personalized investment, financial, tax, or legal advice. Always verify before acting, and consult a licensed professional for advice tailored to your situation.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-1">Your rights</h2>
        <p>
          Because we do not maintain user accounts, we hold very little data about you. To delete locally-stored data, clear your browser&apos;s site data for Morning Edge or uninstall the app. Server-side brief caches expire automatically within 30 hours and contain no personally identifying information. If you would like server-side caches associated with your holdings hash to be deleted sooner, email us at the address below and we will purge them.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-1">Children</h2>
        <p>
          Morning Edge is not directed at children under 13 and we do not knowingly collect data from children.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-1">Changes to this policy</h2>
        <p>
          If we change this policy, we&apos;ll update the &quot;Last updated&quot; date at the top of this page. Material changes will be highlighted in the app.
        </p>

        <h2 className="text-xl font-semibold mt-6 mb-1">Contact</h2>
        <p>
          Questions about privacy? Email <a className="underline" href="mailto:tarunprasadmd@gmail.com">tarunprasadmd@gmail.com</a>.
        </p>
      </div>
    </main>
  );
}

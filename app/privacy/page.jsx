export const metadata = { title: "Privacy Policy — Morning Edge" };

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-12 max-w-2xl mx-auto text-slate-800">
      <a href="/" className="text-sm text-slate-500 underline">← Back</a>
      <h1 className="text-3xl font-bold mt-6 mb-2">Privacy Policy</h1>
      <p className="text-sm text-slate-500 mb-8">Last updated: May 10, 2026</p>
      <div className="space-y-4 leading-relaxed">
        <p><strong>Overview.</strong> Morning Edge is a personal markets and wellness companion. We respect your privacy.</p>
        <p><strong>Data we collect.</strong> No account required. Portfolio data you upload (CSV) is processed in your browser and stored locally on your device. We do not transmit your holdings to our servers.</p>
        <p><strong>AI-generated content.</strong> The app uses the Anthropic Claude API for market briefs. Prompts may include market context and your preferences, not your full portfolio. See anthropic.com/legal/privacy.</p>
        <p><strong>Third parties.</strong> Hosted on Vercel. No personal data is sold to third parties.</p>
        <p><strong>Your rights.</strong> Clear browser/app storage to delete local data. No server-side data to delete.</p>
        <p><strong>Contact.</strong> <a href="mailto:tarunprasadmd@gmail.com" className="underline">tarunprasadmd@gmail.com</a></p>
      </div>
    </main>
  );
}

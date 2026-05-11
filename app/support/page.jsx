export const metadata = { title: "Support — Morning Edge" };

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-12 max-w-2xl mx-auto text-slate-800">
      <a href="/" className="text-sm text-slate-500 underline">← Back</a>
      <h1 className="text-3xl font-bold mt-6 mb-2">Support</h1>
      <p className="text-sm text-slate-500 mb-8">We're here to help.</p>
      <div className="space-y-4 leading-relaxed">
        <p><strong>Contact.</strong> Questions, bug reports, or feedback? Email <a href="mailto:tarunprasadmd@gmail.com" className="underline">tarunprasadmd@gmail.com</a> and we'll respond within 2 business days.</p>
        <p><strong>About the app.</strong> Morning Edge is a personal markets and wellness companion built by a 20-year senior clinical healthcare professional. Read our <a href="/about" className="underline">founder story and mission</a>.</p>
        <p><strong>Data &amp; privacy.</strong> Your portfolio data is processed in your browser and stored locally on your device. See our <a href="/privacy" className="underline">Privacy Policy</a> for full details.</p>
        <p><strong>Terms.</strong> Use of the app is subject to our <a href="/terms" className="underline">Terms of Service</a>.</p>
        <p><strong>Common questions.</strong></p>
        <ul className="list-disc pl-6 space-y-2">
          <li>CSV upload not working? Make sure you're using a Fidelity-exported positions CSV.</li>
          <li>Brief not generating? Check that your internet connection is active.</li>
          <li>Want to clear your data? Clear your browser's storage for this site.</li>
          <li>What's the "SIGNED" badge in the footer? It's a cryptographic stamp confirming the build is authentic. More detail on our <a href="/about" className="underline">About page</a>.</li>
        </ul>
      </div>
    </main>
  );
}

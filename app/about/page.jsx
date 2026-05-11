export const metadata = { title: "About — Morning Edge" };

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-white px-6 py-12 max-w-2xl mx-auto text-slate-800">
      <a href="/" className="text-sm text-slate-500 underline">← Back</a>
      <h1 className="text-3xl font-bold mt-6 mb-2">About Morning Edge</h1>
      <p className="text-sm text-slate-500 mb-8">Built with intention, for the disciplined investor.</p>

      <div className="space-y-6 leading-relaxed">
        <section>
          <h2 className="text-xl font-semibold mb-2">Why this app exists</h2>
          <p>Morning Edge began as a personal tool. After 20+ years as a clinical specialist in cardiac rhythm management — supporting cardiologists during pacemaker and defibrillator procedures — I learned that the best outcomes come from disciplined preparation, not reactive panic. The same is true of investing and wellness. This app is the morning ritual I wished I had: clear, calm, and grounded in real data.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">Who built this</h2>
          <p>Morning Edge is built by Tarun Prasad, MBBS — a clinical specialist with two decades of experience in healthcare. The discipline of clinical work, where patient outcomes depend on calm and methodical preparation, shapes how this app approaches markets and personal wellness.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">Our mission</h2>
          <p>A portion of proceeds from Morning Edge supports U.S. charities helping children and adults with disabilities, and the families who care for them. The bronze medallion at the heart of this app is a relief of my father holding his sister, who lives with disabilities. She is the reason this app exists.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">The signature</h2>
          <p>Each build of Morning Edge carries a cryptographic signature (visible as the "SIGNED" badge). It's our commitment that the version you're using is the one we built and shipped — not modified or tampered with. This is real, this is ours, and we stand behind it.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-2">Get in touch</h2>
          <p>Questions, feedback, or thoughts? Email <a href="mailto:tarunprasadmd@gmail.com" className="underline">tarunprasadmd@gmail.com</a>.</p>
        </section>
      </div>
    </main>
  );
}

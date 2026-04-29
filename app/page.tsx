"use client";

import dynamic from "next/dynamic";

// Load the main component client-side only since it uses localStorage
const MorningEdge = dynamic(() => import("./MorningEdge"), { ssr: false });

export default function Page() {
  return <MorningEdge />;
}

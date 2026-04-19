import { Features } from "@/components/features";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { Navbar } from "@/components/navbar";
import { PricingCard } from "@/components/pricing-card";

export default function LandingPage() {
  return (
    <div className="bg-black text-white">
      <Navbar />
      <main>
        <Hero />
        <Features />
        <PricingCard />
      </main>
      <Footer />
    </div>
  );
}

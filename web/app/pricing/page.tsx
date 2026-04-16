import { Footer } from "@/components/footer";
import { Navbar } from "@/components/navbar";
import { PricingCard } from "@/components/pricing-card";

export default function PricingPage() {
  return (
    <>
      <Navbar />
      <main className="bg-surface-subtle">
        <PricingCard />
      </main>
      <Footer />
    </>
  );
}

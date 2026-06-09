import HeroSection from "@/components/home/HeroSection";
import WhoWeAre from "@/components/home/WhoWeAre";
import StatsCounters from "@/components/home/StatsCounters";
import WhyChooseUs from "@/components/home/WhyChooseUs";
import BrowseByCities from "@/components/home/BrowseByCities";
import ScreenCards from "@/components/home/ScreenCards";
import GoogleMapsEmbed from "@/components/home/GoogleMapsEmbed";

export default function Home() {
  return (
    <div className="relative w-full bg-base">
      <HeroSection />
      <WhoWeAre />
      <StatsCounters />
      <WhyChooseUs />
      <BrowseByCities />
      <ScreenCards />
      <GoogleMapsEmbed
        title="Our Screen Locations"
        description="Explore all available digital screens across major cities. Click on any marker to view detailed information and book your campaign."
        mapId="1nmvPRNvI2rFnUkQ9QqHJPBmOXj-2hg0"
        height="600"
      />
    </div>
  );
}

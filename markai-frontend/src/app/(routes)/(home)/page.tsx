import HeroSection from "@/components/home/HeroSection";
import BrowseByCities from "@/components/home/BrowseByCities";
import ScreenCards from "@/components/home/ScreenCards";
import HomeHowItWorks from "@/components/home/HomeHowItWorks";
import GoogleMapsEmbed from "@/components/home/GoogleMapsEmbed";

export default function Home() {
  return (
    <div className="relative w-full">
      <HeroSection />
      <BrowseByCities />
      <ScreenCards />
      <HomeHowItWorks />
      <GoogleMapsEmbed
        title="Our Screen Locations"
        description="Explore all available digital screens across major cities. Click on any marker to view detailed information and book your campaign."
        mapId="1nmvPRNvI2rFnUkQ9QqHJPBmOXj-2hg0"
        height="600"
      />
    </div>
  );
}

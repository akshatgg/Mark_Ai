"use client";
import React from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpRight, MapPin } from "lucide-react";

type City = {
  name: string;
  tagline: string;
  image: string;
  status: "live" | "coming-soon";
  screens?: string;
  locations?: string;
};

const cities: City[] = [
  {
    name: "Bengaluru",
    tagline: "Silicon Valley of India",
    image: "/cities/beng.jpg",
    status: "live",
    screens: "50+",
    locations: "25+",
  },
  {
    name: "Mumbai",
    tagline: "City of Dreams",
    image: "/cities/mumbai.avif",
    status: "coming-soon",
  },
  {
    name: "Delhi",
    tagline: "Heart of the Nation",
    image: "/cities/delhi.webp",
    status: "coming-soon",
  },
  {
    name: "Hyderabad",
    tagline: "City of Pearls",
    image: "/cities/hyd.jpg",
    status: "coming-soon",
  },
  {
    name: "Chennai",
    tagline: "Gateway to South India",
    image: "/cities/chennai.png",
    status: "coming-soon",
  },
];

const BrowseByCities = () => {
  return (
    <section className="relative w-full bg-base py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-subtle">
              Coverage
            </div>
            <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-base md:text-5xl">
              Operating across{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 100%)",
                }}
              >
                India&apos;s biggest markets
              </span>
              .
            </h2>
            <p className="mt-4 text-lg text-muted">
              Live in Bengaluru today. Mumbai, Delhi and Hyderabad rolling out
              next — get on the early-access list.
            </p>
          </div>
          <Link
            href="/browse-screens"
            className="inline-flex items-center gap-2 rounded-full border border-base bg-surface px-5 py-2.5 text-sm font-semibold text-base transition hover:bg-elev"
          >
            View all screens
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {cities.map((city, i) => (
            <CityCard key={city.name} city={city} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
};

const CityCard = ({ city, index }: { city: City; index: number }) => {
  const live = city.status === "live";
  const Wrapper: React.ElementType = live ? Link : "div";
  const wrapperProps = live
    ? { href: `/browse-screens?city=${city.name}` }
    : {};

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, delay: index * 0.05 }}
      className={
        live
          ? "sm:col-span-2 lg:row-span-2 lg:col-span-2"
          : ""
      }
    >
      <Wrapper
        {...wrapperProps}
        className={`group block h-full overflow-hidden rounded-3xl ring-base transition ${
          live
            ? "shadow-xl hover:-translate-y-1 hover:shadow-2xl"
            : "shadow-sm hover:shadow-md"
        }`}
      >
        <div
          className={`relative w-full overflow-hidden ${
            live ? "aspect-[4/3] lg:aspect-auto lg:h-full lg:min-h-[460px]" : "aspect-[4/3]"
          }`}
        >
          <Image
            src={city.image}
            alt={city.name}
            fill
            className={`object-cover transition duration-700 ${
              live ? "group-hover:scale-105" : "scale-100 brightness-95 group-hover:brightness-100"
            }`}
          />

          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

          <div className="absolute top-4 left-4">
            {live ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white shadow"
                style={{
                  background:
                    "linear-gradient(120deg, var(--brand-blue) 0%, var(--brand-cyan) 100%)",
                }}
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                </span>
                Live now
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-gray-700 backdrop-blur">
                Coming soon
              </span>
            )}
          </div>

          <div className="absolute bottom-0 left-0 right-0 p-5 md:p-6">
            <div className="flex items-end justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-white">
                  <MapPin className="h-4 w-4 opacity-80" />
                  <span className="text-xs uppercase tracking-wider opacity-80">
                    {city.tagline}
                  </span>
                </div>
                <h3
                  className={`mt-1 font-bold text-white ${
                    live ? "text-3xl md:text-5xl" : "text-2xl md:text-3xl"
                  }`}
                >
                  {city.name}
                </h3>
              </div>
              {live && (
                <ArrowUpRight className="h-7 w-7 shrink-0 text-white transition group-hover:rotate-12" />
              )}
            </div>

            {live && (
              <div className="mt-5 flex flex-wrap gap-2">
                <Stat label="Screens" value={city.screens!} />
                <Stat label="Prime locations" value={city.locations!} />
                <Stat label="Live campaigns" value="24/7" />
              </div>
            )}
          </div>
        </div>
      </Wrapper>
    </motion.div>
  );
};

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-white/15 bg-white/10 px-3 py-1.5 text-white backdrop-blur-md">
    <span className="text-sm font-bold">{value}</span>
    <span className="ml-1.5 text-xs opacity-80">{label}</span>
  </div>
);

export default BrowseByCities;

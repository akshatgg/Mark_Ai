export type ScreenVariant = {
  label: string;
  spec: string;
  value: string;
  price: number;
};

export type ScreenFrequency = {
  label: string;
  value: string;
  savings: string;
};

export type ScreenMetrics = {
  footfall: string;
  dwell: string;
  audience: string;
};

export type ScreenVenueSnapshot = {
  hours: string;
  dailyVisitors: string;
  screenPosition: string;
  environment: string;
};

export type ScreenDetail = {
  id: string;
  name: string;
  location: string;
  city: string;
  state?: string;
  country?: string;
  basePrice: number;
  priceUnit: string;
  rating: number;
  reviews: number;
  hero: string;
  gallery: string[];
  priceNote: string;
  description: string;
  highlights: string[];
  categories: string[];
  variants: ScreenVariant[];
  frequencies: ScreenFrequency[];
  metrics: ScreenMetrics;
  venue: ScreenVenueSnapshot;
};

export const screens: ScreenDetail[] = [
  {
    id: "1",
    name: "MG Road Cafe Digital Display",
    location: "MG Road, Bengaluru, Karnataka",
    city: "Bengaluru",
    basePrice: 850,
    priceUnit: "/hour",
    rating: 4.8,
    reviews: 44,
    hero: "/screen_in_blr/screen1.jpg",
    gallery: [
      "/screen_in_blr/screen1.jpg",
      "/screen_in_blr/screen2.webp",
      "/screen_in_blr/screen3.webp",
      "/screen_in_blr/screen1.jpg",
    ],
    priceNote: "Starting ₹15,500 / week",
    description:
      "Premium LED display nestled inside a high-footfall specialty cafe. Perfect for premium product launches, lifestyle brands, and experiential campaigns that demand attention at close range.",
    highlights: [
      "100% viewability with 12ft x 8ft LED wall",
      "Lifestyle-forward audience with high dwell time",
      "Plug & play content support with onsite staff",
    ],
    categories: [
      "Brand Awareness",
      "Product Promotion",
      "Seasonal Launches",
      "Experiential",
    ],
    variants: [
      {
        label: "Full Wrap",
        spec: "12ft x 8ft LED · Prime seating view",
        value: "full",
        price: 15500,
      },
      {
        label: "Bar Takeover",
        spec: "10ft ribbon display · Entry spotlight",
        value: "bar",
        price: 13200,
      },
      {
        label: "Mini Loop",
        spec: "5ft pillar LED · Table clusters",
        value: "mini",
        price: 9800,
      },
    ],
    frequencies: [
      { label: "One Time Run", value: "once", savings: "₹19,500" },
      { label: "4-Week Pulse · Save 15%", value: "monthly", savings: "₹66,375" },
      {
        label: "12-Week Always on · Save 25%",
        value: "quarter",
        savings: "₹155,750",
      },
    ],
    metrics: {
      footfall: "18,200 avg. weekly",
      dwell: "22 min average",
      audience: "Premium Gen-Z & millennials",
    },
    venue: {
      hours: "8AM – 1AM · 7 days",
      dailyVisitors: "3 min, 10 secs Loop",
      screenPosition: "Prime seating view",
      environment: "Indoor, well-lit, dwell time 22 min average",
    },
  },
  {
    id: "2",
    name: "MG Road Club LED Screen",
    location: "MG Road, Bengaluru, Karnataka",
    city: "Bengaluru",
    basePrice: 900,
    priceUnit: "/hour",
    rating: 4.7,
    reviews: 38,
    hero: "/screen_in_blr/screen2.webp",
    gallery: [
      "/screen_in_blr/screen2.webp",
      "/screen_in_blr/screen1.jpg",
      "/screen_in_blr/screen3.webp",
    ],
    priceNote: "Starting ₹19,000 / week",
    description:
      "Immersive LED wall at a premium members-only club with curated nightlife programming. Ideal for luxury, fintech, and lifestyle brands looking to command attention after dark.",
    highlights: [
      "16ft panoramic LED with synchronized audio",
      "Nightlife audience with high disposable income",
      "On-site creative concierge & live content switching",
    ],
    categories: ["Awareness", "Launch Spotlight", "Nightlife Activations"],
    variants: [
      {
        label: "Prime Night Loop",
        spec: "40s loop · 8PM - 1AM",
        value: "prime",
        price: 19000,
      },
      {
        label: "Weekend Takeover",
        spec: "Fri - Sun · 6 hours / day",
        value: "weekend",
        price: 25800,
      },
    ],
    frequencies: [
      { label: "Single Weekend Burst", value: "weekend", savings: "₹28,700" },
      { label: "Monthly Residency · Save 18%", value: "monthly", savings: "₹125,400" },
      { label: "Seasonal Run · Save 25%", value: "season", savings: "₹288,000" },
    ],
    metrics: {
      footfall: "11,400 avg. weekly",
      dwell: "38 min average",
      audience: "Club members & guests",
    },
    venue: {
      hours: "5PM – 2AM · Thu to Sun",
      dailyVisitors: "4–5 per table",
      screenPosition: "Panoramic wall view",
      environment: "Indoor nightlife, dwell time 38 min average",
    },
  },
  {
    id: "3",
    name: "Brigade Road Restaurant Billboard",
    location: "Brigade Road, Bengaluru, Karnataka",
    city: "Bengaluru",
    basePrice: 800,
    priceUnit: "/hour",
    rating: 4.6,
    reviews: 29,
    hero: "/screen_in_blr/screen3.webp",
    gallery: [
      "/screen_in_blr/screen3.webp",
      "/screen_in_blr/screen1.jpg",
      "/screen_in_blr/screen2.webp",
    ],
    priceNote: "Starting ₹14,200 / week",
    description:
      "Exterior LED banner spanning the façade of a cult-favorite Brigade Road bistro. Targets tourists and shoppers on foot with bright, cinematic creatives.",
    highlights: [
      "Street-level visibility with 160° viewing cone",
      "Rush-hour pulse targeting built in",
      "Weather-resistant 4K HDR screen",
    ],
    categories: [
      "Retail Promotions",
      "City Launches",
      "Product Spotlights",
      "Tourist Targeting",
    ],
    variants: [
      {
        label: "Full Motion Banner",
        spec: "20s loop · 6AM - 11PM",
        value: "motion",
        price: 14200,
      },
      {
        label: "Static Showcase",
        spec: "10s slot · 90 sec rotation",
        value: "static",
        price: 11200,
      },
    ],
    frequencies: [
      { label: "Weekly Flight", value: "weekly", savings: "₹14,200" },
      { label: "Monthly Pulse · Save 10%", value: "monthly", savings: "₹51,120" },
      { label: "Quarterly Presence · Save 18%", value: "quarter", savings: "₹139,560" },
    ],
    metrics: {
      footfall: "26,000 avg. weekly",
      dwell: "18 sec average",
      audience: "Tourists & retail shoppers",
    },
    venue: {
      hours: "6AM – 11PM · Daily",
      dailyVisitors: "26,000 avg. weekly passers",
      screenPosition: "Street-level façade",
      environment: "Outdoor, high visibility, 18 sec average dwell",
    },
  },
  {
    id: "4",
    name: "Phoenix Market City Mall Digital Display",
    location: "Whitefield, Bengaluru, Karnataka",
    city: "Bengaluru",
    basePrice: 950,
    priceUnit: "/hour",
    rating: 4.9,
    reviews: 52,
    hero: "/screen_in_blr/screen1.jpg",
    gallery: [
      "/screen_in_blr/screen1.jpg",
      "/screen_in_blr/screen3.webp",
      "/screen_in_blr/screen2.webp",
    ],
    priceNote: "Starting ₹22,800 / week",
    description:
      "Atrium dominating LED canvas right above the central concierge of Phoenix Market City. Captures shoppers across fashion, electronics, and lifestyle zones.",
    highlights: [
      "Atrium visibility across four floors",
      "Families & young professionals · 45% repeat",
      "Interactive QR + NFC add-ons supported",
    ],
    categories: [
      "Mall Activations",
      "Product Launches",
      "Family Campaigns",
      "Interactive",
    ],
    variants: [
      {
        label: "Atrium Takeover",
        spec: "30s loop · 10AM - 10PM",
        value: "atrium",
        price: 22800,
      },
      {
        label: "Weekend Splash",
        spec: "Fri - Sun · 12 hours",
        value: "weekend",
        price: 26500,
      },
      {
        label: "Static Feature",
        spec: "15s slot · 60 sec rotation",
        value: "static",
        price: 18700,
      },
    ],
    frequencies: [
      { label: "Single Week Run", value: "week", savings: "₹22,800" },
      { label: "Monthly Pulse · Save 15%", value: "month", savings: "₹77,610" },
      { label: "Seasonal Domination · Save 28%", value: "season", savings: "₹237,120" },
    ],
    metrics: {
      footfall: "42,000 avg. weekly",
      dwell: "32 min average",
      audience: "Families & shoppers",
    },
    venue: {
      hours: "10AM – 10PM · Daily",
      dailyVisitors: "3–4 per group",
      screenPosition: "Atrium central view",
      environment: "Indoor mall, dwell time 32 min average",
    },
  },
  {
    id: "5",
    name: "Koramangala Cafe LED Screen",
    location: "Koramangala, Bengaluru, Karnataka",
    city: "Bengaluru",
    basePrice: 850,
    priceUnit: "/hour",
    rating: 4.5,
    reviews: 34,
    hero: "/screen_in_blr/screen2.webp",
    gallery: [
      "/screen_in_blr/screen2.webp",
      "/screen_in_blr/screen1.jpg",
      "/screen_in_blr/screen3.webp",
    ],
    priceNote: "Starting ₹16,000 / week",
    description:
      "Neighborhood-favorite co-working cafe with an LED feature wall that doubles as a community announcement board. Perfect for startup launches and product betas.",
    highlights: [
      "Day-long exposure with remote content swaps",
      "Creator & startup-heavy audience",
      "Optional sampling kiosk nearby",
    ],
    categories: ["Product Promotion", "Startup Launches", "Community Drops"],
    variants: [
      {
        label: "All-day Loop",
        spec: "7AM - 11PM · 30s loop",
        value: "day",
        price: 16000,
      },
      {
        label: "Prime Slots",
        spec: "9AM - 1PM · 4PM - 8PM",
        value: "prime",
        price: 14200,
      },
    ],
    frequencies: [
      { label: "Weekly Sprint", value: "weekly", savings: "₹16,000" },
      { label: "Monthly Residency · Save 12%", value: "monthly", savings: "₹56,320" },
      { label: "Quarter Boost · Save 22%", value: "quarter", savings: "₹149,600" },
    ],
    metrics: {
      footfall: "13,600 avg. weekly",
      dwell: "48 min average",
      audience: "Founders & creators",
    },
    venue: {
      hours: "7AM – 11PM · Daily",
      dailyVisitors: "2–3 per pod",
      screenPosition: "Feature wall view",
      environment: "Indoor co-working, dwell time 48 min average",
    },
  },
];

export const getScreenById = (id?: string | null) =>
  screens.find((screen) => screen.id === id);


export interface LegalSection {
  id: string;
  title: string;
  content: string | string[];
  subsections?: LegalSection[];
}

export interface LegalDocument {
  title: string;
  lastUpdated: string;
  introduction?: string;
  sections: LegalSection[];
  contactInfo?: {
    company: string;
    email: string;
    phone: string;
    address: string;
    website: string;
  };
}

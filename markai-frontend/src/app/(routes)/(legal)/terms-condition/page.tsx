"use client";
import LegalDocument from '@/components/legal/LegalDocument';
import { termsConditionsData } from '@/data/legal';

const TermsConditionPage = () => {
  return <LegalDocument document={termsConditionsData} />;
}

export default TermsConditionPage;
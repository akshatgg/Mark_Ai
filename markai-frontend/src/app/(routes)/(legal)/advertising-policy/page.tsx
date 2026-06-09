"use client";
import LegalDocument from '@/components/legal/LegalDocument';
import { advertisingPolicyData } from '@/data/legal';

const AdvertisingPolicyPage = () => {
  return <LegalDocument document={advertisingPolicyData} />;
}

export default AdvertisingPolicyPage;

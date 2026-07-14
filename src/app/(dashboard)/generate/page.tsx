import type { Metadata } from "next";

import { PageHeader } from "@/components/features/page-header";
import { GenerateWizard } from "@/components/features/generate/wizard";

export const metadata: Metadata = { title: "Generate" };

export default function GeneratePage() {
  return (
    <>
      <PageHeader
        title="Generate"
        description="A website URL, a daily budget, and a goal — in, a complete ad draft out."
      />
      <GenerateWizard />
    </>
  );
}

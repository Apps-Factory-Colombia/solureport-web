import { CompanySettings } from "@/lib/types";
import { dataRequest } from "../client";

export async function getConfiguracion(): Promise<CompanySettings> { return dataRequest<CompanySettings>("config.get"); }
export async function updateConfiguracion(settings: Partial<CompanySettings>): Promise<CompanySettings> { return dataRequest<CompanySettings>("config.update", settings); }
